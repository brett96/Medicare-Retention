from __future__ import annotations

import json
import os
from typing import Any, List, Optional, Tuple, Union

import psycopg2
import requests
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST
from pgvector.psycopg2 import register_vector


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip()


def _require_env(name: str) -> str:
    v = _env(name)
    if not v:
        raise RuntimeError(f"Missing required env var: {name}")
    return v


def _normalize_base_url(u: str) -> str:
    return (u or "").strip().rstrip("/")


def _http_timeout() -> Union[float, Tuple[float, float]]:
    connect = float(_env("RAG_HTTP_CONNECT_TIMEOUT_S", "10") or "10")
    read = float(_env("RAG_HTTP_READ_TIMEOUT_S", "60") or "60")
    return (connect, read)


def _ollama_base_url() -> str:
    # Prefer server-only env var; fall back to EXPO_PUBLIC_... for convenience in local dev.
    return _normalize_base_url(_env("OLLAMA_BASE_URL") or _env("EXPO_PUBLIC_OLLAMA_BASE_URL") or "")


def _embed_model() -> str:
    return (_env("OLLAMA_EMBED_MODEL", "nomic-embed-text") or "nomic-embed-text").strip()


def _chat_model() -> str:
    return (_env("OLLAMA_CHAT_MODEL", _env("EXPO_PUBLIC_OLLAMA_MODEL", "llama3:8b")) or "llama3:8b").strip()


def _knowledge_table() -> str:
    return (_env("RAG_TABLE", "medicare_knowledge") or "medicare_knowledge").strip()


def _top_k() -> int:
    raw = _env("RAG_TOP_K", "3") or "3"
    try:
        v = int(raw)
    except ValueError:
        v = 3
    return max(1, min(20, v))


def _system_prompt(context: str) -> str:
    return (
        "You are an expert Medicare Retention Specialist.\n"
        "Answer the user's question using ONLY the factual context provided below.\n"
        'If the answer is not in the context, say "I don\'t have enough information to answer that."\n\n'
        "CONTEXT:\n"
        f"{context}"
    )


def _embed_question(question: str, *, ollama_url: str) -> List[float]:
    resp = requests.post(
        f"{ollama_url}/api/embeddings",
        json={"model": _embed_model(), "prompt": question},
        timeout=_http_timeout(),
    )
    resp.raise_for_status()
    data: Any = resp.json()
    emb = data.get("embedding") if isinstance(data, dict) else None
    if not isinstance(emb, list) or not emb:
        raise RuntimeError("Ollama embeddings response missing 'embedding'.")
    # Ensure JSON-serializable numeric list
    out: List[float] = []
    for x in emb:
        try:
            out.append(float(x))
        except Exception as e:
            raise RuntimeError("Ollama embeddings returned non-numeric values.") from e
    return out


def _fetch_relevant_chunks(question_vec: List[float], *, db_url: str) -> List[str]:
    table = _knowledge_table()
    k = _top_k()
    conn = psycopg2.connect(db_url)
    try:
        register_vector(conn)
        with conn.cursor() as cur:
            # NOTE: table name cannot be parameterized. Keep it env-controlled and default-safe.
            cur.execute(
                f"""
                SELECT content
                FROM {table}
                ORDER BY embedding <=> %s::vector
                LIMIT %s
                """,
                (question_vec, k),
            )
            rows = cur.fetchall() or []
            out: List[str] = []
            for r in rows:
                if not r:
                    continue
                s = r[0]
                if isinstance(s, str) and s.strip():
                    out.append(s.strip())
            return out
    finally:
        try:
            conn.close()
        except Exception:
            pass


def _ask_llm(*, question: str, context_chunks: List[str], ollama_url: str) -> str:
    context_string = "\n\n".join(context_chunks).strip()
    resp = requests.post(
        f"{ollama_url}/api/chat",
        json={
            "model": _chat_model(),
            "messages": [
                {"role": "system", "content": _system_prompt(context_string)},
                {"role": "user", "content": question},
            ],
            "stream": False,
        },
        timeout=_http_timeout(),
    )
    resp.raise_for_status()
    data: Any = resp.json()
    content = None
    if isinstance(data, dict):
        msg = data.get("message")
        if isinstance(msg, dict):
            content = msg.get("content")
    if not isinstance(content, str) or not content.strip():
        raise RuntimeError("Ollama chat response missing message.content")
    return content.strip()


@csrf_exempt
@require_POST
def rag_ask(request: HttpRequest) -> HttpResponse:
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except ValueError:
        return JsonResponse({"error": "invalid_json"}, status=400)

    q = body.get("question") or body.get("q") or body.get("prompt")
    if not isinstance(q, str) or not q.strip():
        return JsonResponse({"error": "missing_question"}, status=400)
    question = q.strip()

    try:
        db_url = _require_env("DATABASE_URL")
    except Exception as e:
        return JsonResponse({"error": "db_not_configured", "detail": str(e)}, status=500)

    ollama_url = _ollama_base_url()
    if not ollama_url:
        return JsonResponse(
            {"error": "ollama_not_configured", "detail": "Set OLLAMA_BASE_URL (or EXPO_PUBLIC_OLLAMA_BASE_URL)."},
            status=500,
        )

    try:
        vec = _embed_question(question, ollama_url=ollama_url)
        chunks = _fetch_relevant_chunks(vec, db_url=db_url)
        answer = _ask_llm(question=question, context_chunks=chunks, ollama_url=ollama_url)
    except requests.RequestException as e:
        return JsonResponse({"error": "upstream_request_failed", "detail": str(e)}, status=502)
    except psycopg2.Error as e:
        return JsonResponse({"error": "db_query_failed", "detail": str(e)}, status=502)
    except Exception as e:
        return JsonResponse({"error": "rag_failed", "detail": str(e)}, status=500)

    include_chunks = str(body.get("include_chunks") or body.get("debug") or "").strip() in ("1", "true", "True")
    payload: dict[str, Any] = {"answer": answer}
    if include_chunks:
        payload["chunks"] = chunks
        payload["meta"] = {"top_k": _top_k(), "table": _knowledge_table(), "embed_model": _embed_model(), "chat_model": _chat_model()}
    return JsonResponse(payload, status=200)

