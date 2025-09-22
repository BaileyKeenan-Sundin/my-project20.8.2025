// server/lib/llm.js
import fetch from "node-fetch";

/**
 * Non-streaming helper (JSON in, single string out).
 */
export async function askLLM({
  prompt,
  system = "You are a concise assistant.",
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  maxTokens = 350,
  temperature = 0.2,
  timeoutMs = 15000,
}) {
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
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
      data?.choices?.[0]?.text?.trim?.() ||
      "";
    return text;
  } finally {
    clearTimeout(t);
  }
}

/**
 * Streaming helper (SSE from OpenAI → token callbacks).
 * Calls:
 *  - onToken(token)
 *  - onDone(finalText)
 *  - onError(error)
 */
export async function streamChat({
  userText,
  system = "You are a concise assistant.",
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  maxTokens = 500,
  temperature = 0.2,
  timeoutMs = 30000,
  onToken = () => {},
  onDone = () => {},
  onError = () => {},
}) {
  if (!apiKey) {
    onError(new Error("OPENAI_API_KEY not set"));
    return;
  }

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
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

    // node-fetch supports async iteration of the body stream
    for await (const chunk of r.body) {
      const str = decoder.decode(chunk, { stream: true });
      const lines = str.split("\n");
      for (const line of lines) {
        const l = line.trim();
        if (!l || !l.startsWith("data:")) continue;
        const data = l.slice(5).trim();
        if (data === "[DONE]") {
          onDone(full);
          return;
        }
        try {
          const json = JSON.parse(data);
          const delta = json?.choices?.[0]?.delta?.content;
          if (typeof delta === "string" && delta.length) {
            full += delta;
            onToken(delta);
          }
        } catch {
          // ignore partial JSON frames
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
