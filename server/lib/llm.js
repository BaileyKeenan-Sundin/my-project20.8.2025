// server/lib/llm.js
import fetch from "node-fetch";

export async function askLLM({
  prompt,
  system = "You are a concise assistant.",
  apiKey = process.env.OPENAI_API_KEY || "",
  model = process.env.OPENAI_MODEL || "gpt-4o-mini",
  maxTokens = 350,
  temperature = 0.2,
  timeoutMs = 8000,
}) {
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set");
  }

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
      }),
      signal: controller.signal,
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
