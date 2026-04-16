export type OllamaChatRole = "system" | "user" | "assistant";

export type OllamaChatMessage = {
  role: OllamaChatRole;
  content: string;
};

export type OllamaChatOptions = {
  /** Ollama base URL, e.g. http://localhost:11434 or https://ollama.internal.example */
  baseUrl: string;
  /** Ollama model name, e.g. llama3.1 or mistral */
  model: string;
  messages: OllamaChatMessage[];
  /** Abort after N ms (default 60s) */
  timeoutMs?: number;
};

export type OllamaChatResult = {
  content: string;
  raw: unknown;
};

function normalizeBaseUrl(baseUrl: string): string {
  return (baseUrl || "").trim().replace(/\/+$/, "");
}

export async function ollamaChat(opts: OllamaChatOptions): Promise<OllamaChatResult> {
  const base = normalizeBaseUrl(opts.baseUrl);
  const model = (opts.model || "").trim();
  if (!base) throw new Error("Ollama base URL is not set.");
  if (!model) throw new Error("Ollama model is not set.");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), Math.max(1, opts.timeoutMs ?? 60_000));
  try {
    const res = await fetch(`${base}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        messages: opts.messages,
      }),
      signal: ctrl.signal,
    });

    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      // ignore
    }

    if (!res.ok) {
      const msg =
        (json && (json.error || json.message)) ||
        (text && text.slice(0, 400)) ||
        `HTTP ${res.status} from Ollama`;
      throw new Error(`Ollama request failed: ${msg}`);
    }

    const content = json?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Ollama response missing message.content");
    }

    return { content, raw: json };
  } catch (e: any) {
    if (e?.name === "AbortError") {
      throw new Error("Ollama request timed out. Check connectivity and try again.");
    }
    throw e;
  } finally {
    clearTimeout(t);
  }
}

