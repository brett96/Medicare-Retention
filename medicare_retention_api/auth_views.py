from __future__ import annotations

import base64
import hashlib
import html
import json
import os
import secrets
import urllib.parse
from datetime import timedelta
from typing import Any, Dict, Optional, Tuple, Union

import requests
from cryptography.fernet import Fernet
from django.http import HttpRequest, HttpResponse, JsonResponse
from django.shortcuts import redirect
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from gateway.models import PkceSession, TokenExchangeCode
from medicare_retention_api.payers import (
    PLANNED_PAYER_ROWS,
    PayerConfig,
    build_oauth_authorize_query_string,
    get_payer_config,
    list_picker_payer_rows,
)


def _http_timeout() -> Union[float, Tuple[float, float]]:
    legacy = _env("ELEVANCE_HTTP_TIMEOUT_S") or _env("FHIR_HTTP_TIMEOUT_S")
    if legacy:
        return float(legacy)
    connect = float(_env("FHIR_HTTP_CONNECT_TIMEOUT_S", "20") or _env("ELEVANCE_HTTP_CONNECT_TIMEOUT_S", "20") or "20")
    read = float(_env("FHIR_HTTP_READ_TIMEOUT_S", "90") or _env("ELEVANCE_HTTP_READ_TIMEOUT_S", "90") or "90")
    return (connect, read)


class ConfigError(RuntimeError):
    pass


def _env(name: str, default: Optional[str] = None) -> Optional[str]:
    v = os.environ.get(name)
    if v is None or v.strip() == "":
        return default
    return v.strip()


def _require_env(name: str) -> str:
    v = _env(name)
    if not v:
        raise ConfigError(f"Missing required env var: {name}")
    return v


def _pkce_pair() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(os.urandom(32)).rstrip(b"=").decode("utf-8")
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("utf-8")).digest()).rstrip(
        b"="
    ).decode("utf-8")
    return verifier, challenge


def _fernet() -> Fernet:
    key = _require_env("TOKEN_ENCRYPTION_KEY").encode("utf-8")
    try:
        return Fernet(key)
    except Exception as e:
        raise ConfigError("TOKEN_ENCRYPTION_KEY is invalid for Fernet.") from e


def _http_redirect(location: str) -> HttpResponse:
    r = HttpResponse(status=302)
    r["Location"] = location
    return r


def _planned_payer_picker_items() -> list[str]:
    """HTML <li> fragments for payers we plan to support (not yet integrated)."""
    out: list[str] = []
    for _pid, label, docs_url in PLANNED_PAYER_ROWS:
        safe_label = html.escape(label)
        hint_inner = "Coming soon — SMART / OAuth integration is not available yet."
        if docs_url:
            u = html.escape(docs_url, quote=True)
            hint_inner += (
                f' <a class="inline-link" href="{u}" target="_blank" rel="noopener noreferrer">'
                "Program overview (opens in new tab)</a>"
            )
        title = html.escape(
            "Planned integration — not connected.",
            quote=True,
        )
        out.append(
            f'<li class="payer-row-planned"><span class="btn btn-planned" title="{title}">{safe_label}</span>'
            f'<p class="setup-hint">{hint_inner}</p></li>'
        )
    return out


def _html_authorize_picker(request: HttpRequest) -> HttpResponse:
    """Browser landing at /authorize: choose payer, then GET /api/auth/<id>/authorize/."""
    picker_rows = list_picker_payer_rows()
    rows: list[str] = []
    for pid, label, configured, setup_hint in picker_rows:
        safe_label = html.escape(label)
        payer_class = (
            " btn-cigna"
            if pid == "cigna"
            else (" btn-aetna" if pid == "aetna" else "")
        )
        if configured:
            path = f"/api/auth/{urllib.parse.quote(pid)}/authorize/"
            href = request.build_absolute_uri(path)
            rows.append(
                f'<li><a class="btn{payer_class}" href="{html.escape(href, quote=True)}">{safe_label}</a></li>'
            )
        else:
            hint = html.escape(setup_hint or "Configure environment variables for this payer.")
            rows.append(
                f'<li class="payer-row-disabled"><span class="btn btn-disabled{payer_class}" '
                f'title="{hint}">{safe_label}</span>'
                f'<p class="setup-hint">{hint}</p></li>'
            )
    chunks: list[str] = []
    if rows:
        chunks.append('<ul class="payers">\n' + "\n".join(rows) + "\n</ul>")
    else:
        chunks.append(
            "<p class=\"muted\">No payers are fully configured yet. "
            "Set the environment variables for at least one payer (see <code>payers.py</code> / deployment docs).</p>"
        )
    planned = _planned_payer_picker_items()
    if planned:
        chunks.append(
            '<h2 class="subhead">Coming soon</h2>\n<ul class="payers payers-planned">\n'
            + "\n".join(planned)
            + "\n</ul>"
        )
    list_html = "\n".join(chunks)

    body = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Sign in — choose payer</title>
  <style>
    :root {{ font-family: system-ui, Segoe UI, Roboto, sans-serif; }}
    body {{ margin: 0; padding: 2rem; background: #f4f6f8; color: #111; }}
    main {{ max-width: 28rem; margin: 0 auto; background: #fff; border-radius: 12px;
            padding: 1.75rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
    h1 {{ font-size: 1.35rem; margin: 0 0 0.5rem; }}
    p.lead {{ margin: 0 0 1.25rem; color: #555; font-size: 0.95rem; line-height: 1.45; }}
    h2.subhead {{ font-size: 0.95rem; font-weight: 700; margin: 1.35rem 0 0.5rem; color: #444; }}
    ul.payers {{ list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.65rem; }}
    ul.payers-planned {{ margin-top: 0; }}
    a.btn {{
      display: block; text-align: center; text-decoration: none;
      padding: 0.85rem 1rem; border-radius: 10px; background: #111; color: #fff;
      font-weight: 600; font-size: 1rem;
    }}
    a.btn:hover {{ background: #333; }}
    a.btn.btn-cigna {{ background: #0a6a92; }}
    a.btn.btn-cigna:hover {{ background: #084a6b; }}
    a.btn.btn-aetna {{ background: #6d1a7a; }}
    a.btn.btn-aetna:hover {{ background: #4d1256; }}
    span.btn-disabled {{
      display: block; text-align: center; padding: 0.85rem 1rem; border-radius: 10px;
      background: #ccc; color: #555; font-weight: 600; font-size: 1rem; cursor: not-allowed;
    }}
    span.btn-disabled.btn-cigna {{ background: #a8c5d4; color: #3d5a66; }}
    span.btn-disabled.btn-aetna {{ background: #c9b0cf; color: #4a3550; }}
    span.btn-planned {{
      display: block; text-align: center; padding: 0.85rem 1rem; border-radius: 10px;
      background: #eceef1; color: #5a5f66; font-weight: 600; font-size: 1rem; cursor: default;
      border: 1px dashed #b8c0cc;
    }}
    a.inline-link {{ color: #0a5cad; }}
    a.inline-link:hover {{ text-decoration: underline; }}
    p.setup-hint {{ margin: 0.35rem 0 0; font-size: 0.8rem; color: #777; line-height: 1.35; }}
    p.muted {{ color: #666; font-size: 0.9rem; line-height: 1.5; }}
    code {{ font-size: 0.85em; }}
  </style>
</head>
<body>
  <main>
    <h1>Sign in</h1>
    <p class="lead">Choose your health plan to continue with SMART on FHIR (OAuth).</p>
    {list_html}
  </main>
</body>
</html>"""
    return HttpResponse(body, content_type="text/html; charset=utf-8")


def _html_handoff_to_app(deeplink: str) -> HttpResponse:
    safe_href = html.escape(deeplink, quote=True)
    js_url = json.dumps(deeplink)
    body = f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign-in complete</title></head><body>
<p>Redirecting to the app…</p>
<p>If nothing happens, <a href="{safe_href}">open the app</a>.</p>
<script>window.location.replace({js_url});</script>
</body></html>"""
    return HttpResponse(body, content_type="text/html; charset=utf-8")


def _exchange_authorization_code(cfg: PayerConfig, *, code: str, code_verifier: str) -> requests.Response:
    token_payload: Dict[str, Any] = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": cfg.redirect_uri,
        "client_id": cfg.client_id,
        "code_verifier": code_verifier,
    }
    if cfg.client_secret:
        token_payload["client_secret"] = cfg.client_secret

    headers = {"Content-Type": "application/x-www-form-urlencoded"}
    if cfg.client_secret:
        return requests.post(
            cfg.token_url,
            data=token_payload,
            auth=requests.auth.HTTPBasicAuth(cfg.client_id, cfg.client_secret),
            headers=headers,
            timeout=_http_timeout(),
        )
    return requests.post(cfg.token_url, data=token_payload, headers=headers, timeout=_http_timeout())


def _patient_id_from_access_token_jwt(access_token: str) -> Optional[str]:
    """Decode JWT payload (no signature verify) for SMART `patient` / fhirUser claims (e.g. Aetna)."""
    parts = access_token.split(".")
    if len(parts) < 2:
        return None
    payload_b64 = parts[1]
    pad = (-len(payload_b64)) % 4
    if pad:
        payload_b64 += "=" * pad
    try:
        raw = base64.urlsafe_b64decode(payload_b64.encode("ascii"))
        data = json.loads(raw.decode("utf-8"))
    except (ValueError, json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(data, dict):
        return None
    return _patient_id_from_userinfo(data)


def _patient_id_from_userinfo(data: Dict[str, Any]) -> Optional[str]:
    p = data.get("patient")
    if p is not None and str(p).strip():
        return str(p).strip()
    for key in ("fhirUser", "fhir_user"):
        fu = data.get(key)
        if isinstance(fu, str) and fu.strip():
            s = fu.strip()
            if "/" in s:
                return s.rsplit("/", 1)[-1]
            return s
    sub = data.get("sub")
    if sub is not None and str(sub).strip():
        return str(sub).strip()
    return None


def _discover_patient_id(token: Dict[str, Any], cfg: PayerConfig) -> Optional[str]:
    if not cfg.requires_userinfo:
        raw = token.get("patient") if token.get("patient") is not None else token.get("patient_id")
        if raw is not None:
            s = str(raw).strip()
            if s:
                return s
        at = token.get("access_token")
        if isinstance(at, str) and at.strip():
            jid = _patient_id_from_access_token_jwt(at.strip())
            if jid:
                return jid
        return None
    if not cfg.userinfo_url:
        return None
    access = token.get("access_token")
    if not access or not isinstance(access, str):
        return None
    try:
        resp = requests.get(
            cfg.userinfo_url,
            headers={"Authorization": f"Bearer {access}", "Accept": "application/json"},
            timeout=_http_timeout(),
        )
    except requests.RequestException:
        return None
    try:
        body: Any = resp.json()
    except ValueError:
        return None
    if resp.status_code != 200 or not isinstance(body, dict):
        return None
    return _patient_id_from_userinfo(body)


def _handoff_payload(token: Dict[str, Any], cfg: PayerConfig) -> Dict[str, Any]:
    patient_id = _discover_patient_id(token, cfg)
    out: Dict[str, Any] = dict(token)
    out["payer_id"] = cfg.payer_id
    out["patient_id"] = patient_id
    if patient_id:
        out.setdefault("patient", patient_id)
    return out


def _normalize_fhir_resource_type(segment: str) -> str:
    s = (segment or "").strip().lower()
    aliases = {
        "eob": "explanationofbenefit",
        "explanation-of-benefit": "explanationofbenefit",
        # Prescriptions / meds (FHIR R4 names; see https://hl7.org/fhir/medicationrequest.html )
        "rx": "medicationrequest",
        "med": "medicationrequest",
        "prescription": "medicationrequest",
        "meds": "medicationrequest",
        "medication": "medicationrequest",
    }
    return aliases.get(s, s)


def _fhir_search_extra_query() -> str:
    """Optional &_count= for compartment searches (set FHIR_DEFAULT_SEARCH_COUNT, e.g. 100)."""
    n = _env("FHIR_DEFAULT_SEARCH_COUNT")
    if not n or not str(n).isdigit():
        return ""
    v = int(n)
    if v < 1 or v > 500:
        return ""
    return f"&_count={v}"


def _fhir_resource_url(cfg: PayerConfig, resource_type: str, patient_id: str) -> str:
    base = cfg.fhir_base_url.rstrip("/")
    pid = urllib.parse.quote(patient_id)
    sq = _fhir_search_extra_query()
    rt = _normalize_fhir_resource_type(resource_type)
    if rt == "patient":
        if cfg.patient_lookup_mode == "id_search":
            return f"{base}/Patient?_id={pid}{sq}"
        return f"{base}/Patient/{pid}"
    if rt == "coverage":
        return f"{base}/Coverage?patient={pid}{sq}"
    if rt == "encounter":
        return f"{base}/Encounter?patient={pid}{sq}"
    if rt == "explanationofbenefit":
        return f"{base}/ExplanationOfBenefit?patient={pid}{sq}"
    # Patient-compartment medication & related claim data (Elevance payer-access FHIR exposes
    # a subset per their CapabilityStatement; search may return empty Bundle if not supported.)
    if rt == "medicationrequest":
        return f"{base}/MedicationRequest?patient={pid}{sq}"
    if rt == "medicationstatement":
        return f"{base}/MedicationStatement?patient={pid}{sq}"
    if rt == "medicationdispense":
        return f"{base}/MedicationDispense?patient={pid}{sq}"
    if rt == "claim":
        return f"{base}/Claim?patient={pid}{sq}"
    if rt == "claimresponse":
        return f"{base}/ClaimResponse?patient={pid}{sq}"
    raise ValueError(f"Unsupported resource type: {resource_type!r}")


def _fhir_bundle_next_url(bundle: dict[str, Any]) -> Optional[str]:
    links = bundle.get("link")
    if not isinstance(links, list):
        return None
    for item in links:
        if not isinstance(item, dict):
            continue
        if (item.get("relation") or "").strip().lower() != "next":
            continue
        u = item.get("url")
        if isinstance(u, str) and u.strip():
            return u.strip()
    return None


def _fhir_next_url_allowed(cfg: PayerConfig, url: str) -> bool:
    try:
        expect = urllib.parse.urlparse(cfg.fhir_base_url)
        got = urllib.parse.urlparse(url)
        if not got.scheme or not got.netloc:
            return False
        return expect.scheme == got.scheme and expect.netloc.lower() == got.netloc.lower()
    except Exception:
        return False


def _fhir_resolve_next_url(cfg: PayerConfig, next_raw: str) -> Optional[str]:
    n = next_raw.strip()
    if not n:
        return None
    base_root = cfg.fhir_base_url.rstrip("/") + "/"
    if n.startswith("http://") or n.startswith("https://"):
        resolved = n
    else:
        resolved = urllib.parse.urljoin(base_root, n.lstrip("/"))
    return resolved if _fhir_next_url_allowed(cfg, resolved) else None


def _fhir_follow_bundle_next_pages(
    cfg: PayerConfig,
    first_bundle: dict[str, Any],
    *,
    headers: dict[str, str],
    timeout: Union[float, Tuple[float, float]],
) -> dict[str, Any]:
    """
    Merge FHIR searchset pages by following Bundle.link relation \"next\".
    Payers (e.g. Cigna) often return only the first page unless clients paginate.
    """
    if _env("FHIR_PROXY_FOLLOW_BUNDLE_NEXT", "1") != "1":
        return first_bundle

    first_entries = first_bundle.get("entry")
    if not isinstance(first_entries, list):
        return first_bundle

    next_raw = _fhir_bundle_next_url(first_bundle)
    if not next_raw:
        return first_bundle

    max_pages_raw = _env("FHIR_PROXY_MAX_PAGES", "50")
    try:
        max_extra = max(0, int(max_pages_raw) - 1)
    except ValueError:
        max_extra = 49

    merged: dict[str, Any] = dict(first_bundle)
    entries: list[Any] = list(first_entries)
    pages_fetched = 0
    while next_raw and pages_fetched < max_extra:
        next_url = _fhir_resolve_next_url(cfg, next_raw)
        if not next_url:
            break
        try:
            resp = requests.get(next_url, headers=headers, timeout=timeout)
        except requests.RequestException:
            break
        if resp.status_code != 200:
            break
        try:
            body: Any = resp.json()
        except ValueError:
            break
        if not isinstance(body, dict) or body.get("resourceType") != "Bundle":
            break
        chunk = body.get("entry")
        if isinstance(chunk, list):
            entries.extend(chunk)
        next_raw = _fhir_bundle_next_url(body)
        pages_fetched += 1

    merged["entry"] = entries
    if "total" not in merged or merged.get("total") is None:
        merged["total"] = len(entries)
    links_out: list[dict[str, Any]] = []
    for item in merged.get("link") or []:
        if isinstance(item, dict) and (item.get("relation") or "").strip().lower() == "next":
            continue
        if isinstance(item, dict):
            links_out.append(item)
    merged["link"] = links_out
    if pages_fetched > 0:
        meta = merged.get("meta")
        if not isinstance(meta, dict):
            meta = {}
            merged["meta"] = meta
        tlist = meta.get("tag")
        tags = list(tlist) if isinstance(tlist, list) else []
        tags.append(
            {
                "system": "https://medicare-retention.local/fhir-proxy",
                "code": "merged-pages",
                "display": (
                    f"Proxy merged {pages_fetched + 1} Bundle page(s). "
                    "FHIR_PROXY_FOLLOW_BUNDLE_NEXT=0 disables; FHIR_PROXY_MAX_PAGES caps pages."
                ),
            }
        )
        meta["tag"] = tags
    return merged


def _fhir_should_follow_bundle_next(resource_type: str) -> bool:
    if _env("FHIR_PROXY_FOLLOW_BUNDLE_NEXT", "1") != "1":
        return False
    rt = _normalize_fhir_resource_type(resource_type)
    return rt != "patient"


def _bundle_entry_dedupe_key(entry: Any) -> Optional[str]:
    if not isinstance(entry, dict):
        return None
    r = entry.get("resource")
    if isinstance(r, dict):
        rid, rt = r.get("id"), r.get("resourceType")
        if isinstance(rid, str) and rid.strip() and isinstance(rt, str) and rt.strip():
            return f"{rt.strip()}/{rid.strip()}"
    fu = entry.get("fullUrl")
    if isinstance(fu, str) and fu.strip():
        return fu.strip()
    return None


def _fhir_merge_cigna_dual_patient_bundles(primary: dict[str, Any], secondary: dict[str, Any]) -> dict[str, Any]:
    """
    Cigna may return pharmacy EOB (CARIN-BB pharmacy profile) and some Rx data only when
    searching by the token/member id (e.g. A000...), while other compartment reads need
    Patient.id (gov-*/esi-*). Merge entries; dedupe by resource type+id or fullUrl.
    """
    out = dict(primary)
    e1 = primary.get("entry") if isinstance(primary.get("entry"), list) else []
    e2 = secondary.get("entry") if isinstance(secondary.get("entry"), list) else []
    seen: set[str] = set()
    merged_list: list[Any] = []
    for e in e1:
        k = _bundle_entry_dedupe_key(e)
        if k:
            seen.add(k)
        merged_list.append(e)
    for e in e2:
        k = _bundle_entry_dedupe_key(e)
        if k and k in seen:
            continue
        if k:
            seen.add(k)
        merged_list.append(e)
    out["entry"] = merged_list
    out["total"] = len(merged_list)
    links_out: list[dict[str, Any]] = []
    for item in primary.get("link") or []:
        if isinstance(item, dict) and (item.get("relation") or "").strip().lower() != "next":
            links_out.append(item)
    out["link"] = links_out
    meta = out.get("meta")
    if not isinstance(meta, dict):
        meta = {}
        out["meta"] = meta
    tlist = meta.get("tag")
    tags = list(tlist) if isinstance(tlist, list) else []
    tags.append(
        {
            "system": "https://medicare-retention.local/fhir-proxy",
            "code": "cigna-dual-patient-merge",
            "display": "Merged ExplanationOfBenefit or MedicationRequest for Cigna FHIR patient id and token member id.",
        }
    )
    meta["tag"] = tags
    return out


@require_GET
def oauth_authorize(request: HttpRequest, payer_id: str) -> HttpResponse:
    try:
        cfg = get_payer_config(payer_id)
    except KeyError:
        return JsonResponse({"error": "unknown_payer", "payer_id": payer_id}, status=400)
    except Exception as e:
        return JsonResponse({"error": "payer_config_error", "detail": str(e)}, status=500)

    verifier, challenge = _pkce_pair()
    state = secrets.token_urlsafe(24)
    now = timezone.now()
    PkceSession.objects.create(
        state=state,
        payer_id=cfg.payer_id,
        code_verifier=verifier,
        expires_at=now + timedelta(minutes=10),
    )

    aud = cfg.oauth_audience if cfg.oauth_audience else cfg.fhir_base_url
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": cfg.client_id,
        "redirect_uri": cfg.redirect_uri,
        "scope": cfg.scope,
        "state": state,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "aud": aud,
    }
    if cfg.oauth_app_name:
        params["appname"] = cfg.oauth_app_name
    q = build_oauth_authorize_query_string(
        params, scope_literal_asterisk=cfg.oauth_scope_literal_asterisk
    )
    url = f"{cfg.auth_url}?{q}"
    return redirect(url)


@require_GET
def oauth_callback(request: HttpRequest, payer_id: str) -> HttpResponse:
    q = request.GET
    code = q.get("code")
    state = q.get("state")

    try:
        cfg = get_payer_config(payer_id)
    except KeyError:
        return JsonResponse({"error": "unknown_payer", "payer_id": payer_id}, status=400)
    except Exception as e:
        return JsonResponse({"error": "payer_config_error", "detail": str(e)}, status=500)

    if not code:
        oauth_error = q.get("error")
        err_desc = q.get("error_description")
        status_hint = q.get("status_code")
        if oauth_error or err_desc or status_hint is not None:
            payload: Dict[str, Any] = {
                "error": "oauth_provider_error",
                "oauth_error": oauth_error,
                "error_description": err_desc,
                "state": state,
            }
            if q.get("error_uri"):
                payload["error_uri"] = q.get("error_uri")
            if status_hint is not None:
                payload["status_code"] = status_hint
            return JsonResponse(payload, status=400)

    if not code or not state:
        return JsonResponse({"error": "missing_code_or_state"}, status=400)

    now = timezone.now()
    try:
        sess = PkceSession.objects.get(state=state)
    except PkceSession.DoesNotExist:
        return JsonResponse({"error": "state_not_found"}, status=400)

    if sess.payer_id != cfg.payer_id:
        return JsonResponse({"error": "payer_mismatch"}, status=400)

    if sess.used_at is not None:
        return JsonResponse({"error": "state_already_used"}, status=400)
    if sess.expires_at <= now:
        return JsonResponse({"error": "state_expired"}, status=400)

    sess.used_at = now
    sess.save(update_fields=["used_at"])

    try:
        resp = _exchange_authorization_code(cfg, code=code, code_verifier=sess.code_verifier)
    except requests.RequestException as e:
        return JsonResponse({"error": "token_request_failed", "detail": str(e)}, status=502)

    try:
        token: Any = resp.json()
    except ValueError:
        token = resp.text

    if resp.status_code != 200 or not isinstance(token, dict) or "access_token" not in token:
        return JsonResponse(
            {"error": "token_exchange_failed", "status": resp.status_code, "response": token},
            status=400,
        )

    handoff = _handoff_payload(token, cfg)

    exchange_code = secrets.token_urlsafe(32)
    f = _fernet()
    token_bytes = json.dumps(handoff, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    encrypted = f.encrypt(token_bytes)
    TokenExchangeCode.objects.create(
        code=exchange_code,
        token_encrypted_b64=base64.b64encode(encrypted).decode("ascii"),
        expires_at=now + timedelta(minutes=5),
    )

    handoff_base = _env("APP_HANDOFF_URL_BASE")
    if handoff_base:
        api_base = (_env("PUBLIC_API_BASE_URL") or request.build_absolute_uri("/")).rstrip("/")
        sep = "&" if ("?" in handoff_base) else "?"
        handoff_url = (
            f"{handoff_base}{sep}code={urllib.parse.quote(exchange_code)}"
            f"&api_base={urllib.parse.quote(api_base)}"
        )
        return _http_redirect(handoff_url)

    deeplink_base = _require_env("APP_DEEPLINK_CALLBACK_BASE")
    sep = "&" if ("?" in deeplink_base) else "?"
    target = f"{deeplink_base}{sep}code={urllib.parse.quote(exchange_code)}"
    if target.startswith("http://") or target.startswith("https://"):
        return _http_redirect(target)
    return _html_handoff_to_app(target)


@require_GET
def authorize_legacy(request: HttpRequest) -> HttpResponse:
    return _html_authorize_picker(request)


@require_GET
def callback_legacy(request: HttpRequest) -> HttpResponse:
    # Back-compat: older redirect URIs point at /callback/ (no payer_id in path).
    # Dispatch based on the stored state -> payer_id to avoid "payer_mismatch"
    # when multiple payers share the same legacy callback URL.
    state = request.GET.get("state")
    if state:
        try:
            sess = PkceSession.objects.get(state=state)
            return oauth_callback(request, sess.payer_id)
        except PkceSession.DoesNotExist:
            pass
    return oauth_callback(request, "elevance")


@csrf_exempt
@require_POST
def exchange_code(request: HttpRequest) -> HttpResponse:
    try:
        body = json.loads(request.body.decode("utf-8") or "{}")
    except ValueError:
        return JsonResponse({"error": "invalid_json"}, status=400)

    code = body.get("code")
    if not code or not isinstance(code, str):
        return JsonResponse({"error": "missing_code"}, status=400)

    now = timezone.now()
    try:
        rec = TokenExchangeCode.objects.get(code=code)
    except TokenExchangeCode.DoesNotExist:
        return JsonResponse({"error": "code_not_found"}, status=404)

    if rec.consumed_at is not None:
        return JsonResponse({"error": "code_already_consumed"}, status=400)
    if rec.expires_at <= now:
        return JsonResponse({"error": "code_expired"}, status=400)

    rec.consumed_at = now
    rec.save(update_fields=["consumed_at"])

    try:
        encrypted = base64.b64decode(rec.token_encrypted_b64.encode("ascii"))
        token_bytes = _fernet().decrypt(encrypted)
        payload: Any = json.loads(token_bytes.decode("utf-8"))
    except Exception as e:
        return JsonResponse({"error": "decrypt_failed", "detail": str(e)}, status=500)

    if not isinstance(payload, dict):
        return JsonResponse({"error": "token_payload_invalid"}, status=500)

    return JsonResponse(payload, status=200)


@require_GET
def oauth_debug_config(request: HttpRequest) -> HttpResponse:
    if _env("OAUTH_DEBUG", "0") != "1":
        return JsonResponse({"error": "not_found"}, status=404)
    payer_id = (request.GET.get("payer") or request.GET.get("payer_id") or "elevance").strip().lower()
    try:
        cfg = get_payer_config(payer_id)
    except KeyError:
        return JsonResponse({"error": "unknown_payer", "payer_id": payer_id}, status=404)
    except Exception as e:
        return JsonResponse({"error": "payer_config_error", "detail": str(e)}, status=500)
    payload: dict[str, Any] = {
        "payer_id": cfg.payer_id,
        "redirect_uri": cfg.redirect_uri,
        "authorize_url": cfg.auth_url,
        "client_id": cfg.client_id,
        "oauth_audience": cfg.oauth_audience or cfg.fhir_base_url,
        "oauth_scope_literal_asterisk": cfg.oauth_scope_literal_asterisk,
        "oauth_app_name_set": bool(cfg.oauth_app_name),
        "requires_userinfo": cfg.requires_userinfo,
        "hint": "Register redirect_uri EXACTLY in the payer developer portal (scheme, host, path, trailing slash).",
    }
    if cfg.payer_id == "aetna":
        payload["aetna_checklist"] = (
            "Sandbox: subscribe to Patient Access FHIR products, click Create Application for credentials, "
            "and register the same redirect URI in the portal. If the login page shows only the text null, "
            "try setting AETNA_APP_NAME to the App Name from the portal and retry."
        )
    return JsonResponse(payload)


def _bearer_token(request: HttpRequest) -> Optional[str]:
    auth = request.headers.get("Authorization") or ""
    if not auth.startswith("Bearer "):
        return None
    return auth[len("Bearer ") :].strip() or None


def _empty_fhir_search_bundle() -> dict[str, Any]:
    return {"resourceType": "Bundle", "type": "searchset", "total": 0, "entry": []}


def _unwrap_nested_fhir_error(body: Any) -> Any:
    """Our proxy wraps upstream JSON as { error: 'fhir_error', response: <upstream> }."""
    if isinstance(body, dict) and body.get("error") == "fhir_error" and isinstance(body.get("response"), (dict, list)):
        return body["response"]
    return body


def _issue_text_for_not_supported_check(it: dict[str, Any]) -> str:
    """Combine diagnostics + details.text for matching (FHIR may use either)."""
    parts: list[str] = []
    d = it.get("diagnostics")
    if isinstance(d, str) and d.strip():
        parts.append(d)
    details = it.get("details")
    if isinstance(details, dict):
        t = details.get("text")
        if isinstance(t, str) and t.strip():
            parts.append(t)
    return " ".join(parts).lower()


def _is_fhir_resource_not_supported_outcome(body: Any) -> bool:
    """
    True when payer returns OperationOutcome meaning this resource type is not implemented.
    Must be specific: bare 'not-supported' is used for other failures; require wording that
    indicates the resource type is unavailable (Cigna: 'Resource not available: X').
    """
    inner = _unwrap_nested_fhir_error(body)
    if not isinstance(inner, dict) or inner.get("resourceType") != "OperationOutcome":
        return False
    issues = inner.get("issue")
    if not isinstance(issues, list):
        return False
    for it in issues:
        if not isinstance(it, dict):
            continue
        code = (it.get("code") or "").strip().lower()
        if code != "not-supported":
            continue
        combined = _issue_text_for_not_supported_check(it)
        if "resource not available" in combined:
            return True
    return False


def _unwrap_patient_bundle(data: Any) -> Any:
    """
    Some payers (e.g. Cigna) return a search Bundle for Patient lookups (Patient?_id=...).
    The UI's patient summary expects a single Patient resource; prefer a gov-* Patient when present
    because downstream resources (EOB/Coverage/Encounter) commonly reference that id.
    """
    if not isinstance(data, dict) or data.get("resourceType") != "Bundle":
        return data
    entries = data.get("entry")
    if not isinstance(entries, list) or not entries:
        return data

    patients: list[dict[str, Any]] = []
    for e in entries:
        if not isinstance(e, dict):
            continue
        r = e.get("resource")
        if isinstance(r, dict) and r.get("resourceType") == "Patient":
            patients.append(r)

    if not patients:
        return data

    for p in patients:
        pid = p.get("id")
        if isinstance(pid, str) and pid.startswith("gov-"):
            return p
    return patients[0]


def _fhir_get_json(request: HttpRequest, url: str) -> HttpResponse:
    token = _bearer_token(request)
    if not token:
        return JsonResponse({"error": "missing_bearer_token"}, status=401)
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/fhir+json"}
    try:
        resp = requests.get(url, headers=headers, timeout=_http_timeout())
    except requests.RequestException as e:
        return JsonResponse({"error": "fhir_request_failed", "detail": str(e)}, status=502)

    try:
        data: Any = resp.json()
    except ValueError:
        data = resp.text

    if resp.status_code != 200:
        return JsonResponse(
            {"error": "fhir_error", "status": resp.status_code, "response": data},
            status=resp.status_code,
        )

    return JsonResponse(data, status=200, safe=isinstance(data, dict))


@require_http_methods(["GET"])
def proxy_fhir(request: HttpRequest, payer_id: str, resource_type: str) -> HttpResponse:
    try:
        cfg = get_payer_config(payer_id)
    except KeyError:
        return JsonResponse({"error": "unknown_payer", "payer_id": payer_id}, status=400)
    except Exception as e:
        return JsonResponse({"error": "payer_config_error", "detail": str(e)}, status=500)

    patient_id = request.GET.get("patient_id") or request.GET.get("patient")
    if not patient_id:
        return JsonResponse({"error": "missing_patient_id"}, status=400)

    try:
        url = _fhir_resource_url(cfg, resource_type, patient_id)
    except ValueError as e:
        return JsonResponse({"error": "unsupported_resource", "detail": str(e)}, status=400)

    rt = _normalize_fhir_resource_type(resource_type)
    if rt in cfg.fhir_unsupported_resources:
        return JsonResponse(_empty_fhir_search_bundle(), status=200)

    resp = _fhir_get_json(request, url)
    if resp.status_code == 400:
        try:
            err_body: Any = json.loads(resp.content.decode("utf-8"))
        except Exception:
            err_body = None
        if _is_fhir_resource_not_supported_outcome(err_body):
            return JsonResponse(_empty_fhir_search_bundle(), status=200)

    if resp.status_code != 200:
        return resp

    try:
        payload: Any = json.loads(resp.content.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return resp

    tok = _bearer_token(request)
    hdrs = (
        {"Authorization": f"Bearer {tok}", "Accept": "application/fhir+json"}
        if tok
        else None
    )

    if (
        isinstance(payload, dict)
        and payload.get("resourceType") == "Bundle"
        and hdrs
        and _fhir_should_follow_bundle_next(resource_type)
    ):
        payload = _fhir_follow_bundle_next_pages(cfg, payload, headers=hdrs, timeout=_http_timeout())

    merge_pid = (
        request.GET.get("merge_patient_id") or request.GET.get("cigna_merge_patient_id") or ""
    ).strip()
    if (
        _env("CIGNA_DUAL_PATIENT_MERGE", "1") == "1"
        and cfg.payer_id == "cigna"
        and merge_pid
        and merge_pid != patient_id.strip()
        and rt in ("explanationofbenefit", "medicationrequest")
        and isinstance(payload, dict)
        and payload.get("resourceType") == "Bundle"
        and hdrs
    ):
        try:
            url_m = _fhir_resource_url(cfg, resource_type, merge_pid)
        except ValueError:
            url_m = None
        if url_m:
            try:
                r_m = requests.get(url_m, headers=hdrs, timeout=_http_timeout())
            except requests.RequestException:
                r_m = None
            if r_m is not None and r_m.status_code == 200:
                try:
                    b_m: Any = r_m.json()
                except ValueError:
                    b_m = None
                if isinstance(b_m, dict) and b_m.get("resourceType") == "Bundle":
                    b_m = _fhir_follow_bundle_next_pages(cfg, b_m, headers=hdrs, timeout=_http_timeout())
                    payload = _fhir_merge_cigna_dual_patient_bundles(payload, b_m)

    if rt == "patient":
        payload = _unwrap_patient_bundle(payload)
        return JsonResponse(payload, status=200, safe=isinstance(payload, dict))

    return JsonResponse(payload, status=200, safe=isinstance(payload, dict))


@require_http_methods(["GET"])
def proxy_patient(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "patient")


@require_http_methods(["GET"])
def proxy_coverage(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "coverage")


@require_http_methods(["GET"])
def proxy_encounter(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "encounter")


@require_http_methods(["GET"])
def proxy_eob(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "explanationofbenefit")


@require_http_methods(["GET"])
def proxy_medication_request(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "medicationrequest")


@require_http_methods(["GET"])
def proxy_medication_statement(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "medicationstatement")


@require_http_methods(["GET"])
def proxy_medication_dispense(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "medicationdispense")


@require_http_methods(["GET"])
def proxy_claim(request: HttpRequest) -> HttpResponse:
    return proxy_fhir(request, "elevance", "claim")


@require_http_methods(["GET"])
def proxy_dailymed(request: HttpRequest) -> HttpResponse:
    name = request.GET.get("name")
    if not name:
        return JsonResponse({"error": "missing_name"}, status=400)

    url = "https://dailymed.nlm.nih.gov/dailymed/services/v2/drugnames.json"
    params = {"drug_name": name}
    try:
        resp = requests.get(url, params=params, timeout=_http_timeout())
    except requests.RequestException as e:
        return JsonResponse({"error": "dailymed_request_failed", "detail": str(e)}, status=502)

    try:
        data: Any = resp.json()
    except ValueError:
        data = resp.text

    if resp.status_code != 200:
        return JsonResponse(
            {"error": "dailymed_error", "status": resp.status_code, "response": data},
            status=resp.status_code,
        )

    return JsonResponse(data, status=200, safe=isinstance(data, dict))
