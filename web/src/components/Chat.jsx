// web/src/components/Chat.jsx
import { useEffect, useRef, useState } from "react";

export default function Chat({ apiBase = "" }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]); // {role:'user'|'assistant', text:string}
  const [results, setResults] = useState([]);   // normalized events (subset)
  const [loading, setLoading] = useState(false);

  // streaming buffer
  const [streamText, setStreamText] = useState("");
  const streamRef = useRef("");
  useEffect(() => { streamRef.current = streamText; }, [streamText]);

  async function fallbackAsk(q) {
    // Fallback for environments where EventSource isn’t available
    const r = await fetch(`${apiBase}/ai/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: q }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    setResults(data.hits || []);
    setMessages(m => [...m, { role: "assistant", text: data.answer || "" }]);
  }

  function startSSE(q) {
    let es;
    try {
      es = new EventSource(`${apiBase}/ai/chat?message=${encodeURIComponent(q)}`);
    } catch {
      return fallbackAsk(q);
    }

    setStreamText("");
    setResults([]);
    setLoading(true);

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data.type === "text") {
          setStreamText(prev => prev + (data.delta || ""));
        } else if (data.type === "hits") {
          setResults(Array.isArray(data.hits) ? data.hits : []);
        }
      } catch {
        /* ignore malformed frames */
      }
    };

    es.addEventListener("done", () => {
      es.close();
      const final = streamRef.current || "";
      if (final) setMessages(m => [...m, { role: "assistant", text: final }]);
      setStreamText("");
      setLoading(false);
    });

    es.onerror = () => {
      es.close();
      setLoading(false);
      // soft-fallback so the user still gets an answer
      fallbackAsk(q).catch(() => {
        setMessages(m => [...m, { role: "assistant", text: "Sorry—something went wrong." }]);
      });
    };
  }

  async function onSubmit(e) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setMessages(m => [...m, { role: "user", text: q }]);
    setInput("");
    startSSE(q);
  }

  async function showDetails(id) {
    try {
      const r = await fetch(`${apiBase}/api/events/${id}`);
      const ev = await r.json();
      const parts = [
        ev.title ? `**${ev.title}**` : "",
        ev.venue ? `Venue: ${ev.venue}` : "",
        ev.start ? `Start: ${ev.start}` : "",
        ev.url ? `Link: ${ev.url}` : "",
        ev.content_0_text ? `\n${ev.content_0_text.slice(0, 500)}${ev.content_0_text.length > 500 ? "…" : ""}` : "",
      ].filter(Boolean);
      const text = parts.join("\n");
      setMessages(m => [...m, { role: "assistant", text }]);
    } catch (e) {
      setMessages(m => [...m, { role: "assistant", text: "Couldn’t fetch details just now." }]);
    }
  }

  return (
    <div style={{ marginTop: 24 }}>
      <h2>Chat</h2>

      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: 8,
          padding: 16,
          maxWidth: 820,
        }}
      >
        <div style={{ maxHeight: 220, overflowY: "auto", marginBottom: 12 }}>
          {messages.map((m, i) => (
            <div key={i} style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>
              <strong>{m.role === "user" ? "You" : "Assistant"}: </strong>
              <span dangerouslySetInnerHTML={{ __html: m.text }} />
            </div>
          ))}
          {streamText && (
            <div style={{ whiteSpace: "pre-wrap", margin: "6px 0" }}>
              <strong>Assistant: </strong>
              {streamText}
              <span className="blink" style={{ opacity: 0.5 }}>▌</span>
            </div>
          )}
        </div>

        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask what's on, a date range, a category, or a specific event…"
            style={{ flex: 1, padding: 10, borderRadius: 6, border: "1px solid #ccc" }}
            disabled={loading}
          />
          <button type="submit" disabled={loading} style={{ padding: "10px 16px" }}>
            {loading ? "Streaming…" : "Send"}
          </button>
        </form>

        {!!results.length && (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ margin: "8px 0" }}>Results</h3>
            <ul style={{ listStyle: "none", paddingLeft: 0, margin: 0 }}>
              {results.map((ev) => (
                <li
                  key={ev.id}
                  style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0" }}
                >
                  <a href={`${apiBase}/api/events/${ev.id}`} target="_blank" rel="noreferrer">
                    {ev.title}
                  </a>
                  <button
                    type="button"
                    onClick={() => showDetails(ev.id)}
                    style={{ padding: "4px 8px" }}
                  >
                    Details
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
