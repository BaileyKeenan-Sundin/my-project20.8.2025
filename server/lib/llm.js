// server/lib/llm.js
import fetch from "node-fetch";

const API_BASE = process.env.OPENAI_API_BASE || "https://api.openai.com/v1";

/** Build headers; add Authorization only if a key is present. */
function buildHeaders(apiKey = "") {
  const h = { "Content-Type": "application/json" };
  if (apiKey && apiKey.trim()) h.Authorization = `Bearer ${apiKey}`;
  return h;
}

/**
 * Non-streaming helper (JSON in, single string out).
 * Works with OpenAI/Ollama/Groq when API_BASE + model are set appropriately.
 */
export async function askLLM({
  prompt,
  system = process.env.LLM_SYSTEM_PROMPT || "You are a concise assistant.",
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  maxTokens = 350,
  temperature = 0.2,
  timeoutMs = 15000,
}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: String(prompt || "") },
        ],
        stream: false,
      }),
      signal: ctrl.signal,
    });

    if (!r.ok) {
      const txt = await r.text().catch(() => "");
      throw new Error(`LLM HTTP ${r.status}: ${txt}`);
    }

    const data = await r.json();
    const text =
      data?.choices?.[0]?.message?.content?.trim?.() ||
      data?.choices?.[0]?.delta?.content?.trim?.() ||
      data?.choices?.[0]?.text?.trim?.() ||
      "";
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Streaming helper.
 * Robust parser: supports both SSE ("data: {...}", "[DONE]") and raw JSON chunk streams.
 */
export async function streamChat({
  userText,
  system = process.env.LLM_SYSTEM_PROMPT || "You are a concise assistant.",
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  maxTokens = 500,
  temperature = 0.2,
  timeoutMs = 30000,
  onToken = () => {},
  onDone = () => {},
  onError = () => {},
}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch(`${API_BASE}/chat/completions`, {
      method: "POST",
      headers: buildHeaders(apiKey),
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: String(userText || "") },
        ],
        stream: true,
      }),
      signal: ctrl.signal,
    });

    if (!r.ok || !r.body) {
      const txt = await r.text().catch(() => "");
      throw new Error(`LLM HTTP ${r.status}: ${txt}`);
    }

    let full = "";
    const decoder = new TextDecoder();
    let buffer = "";

    for await (const chunk of r.body) {
      const str = decoder.decode(chunk, { stream: true });
      buffer += str;

      // Split on newlines; keep the last partial line in buffer
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        // Support SSE ("data: {...}") and plain JSON lines
        let payload = line.startsWith("data:") ? line.slice(5).trim() : line;

        if (payload === "[DONE]") {
          onDone(full);
          return;
        }

        try {
          const json = JSON.parse(payload);
          const delta =
            json?.choices?.[0]?.delta?.content ??
            json?.choices?.[0]?.message?.content ??
            "";

          if (typeof delta === "string" && delta.length) {
            full += delta;
            onToken(delta);
          }

          const fr = json?.choices?.[0]?.finish_reason;
          if (fr && fr !== null) {
            onDone(full);
            return;
          }
        } catch {
          // Ignore partial / non-JSON lines
        }
      }
    }

    onDone(full);
  } catch (err) {
    onError(err);
  } finally {
    clearTimeout(t);
  }
}
