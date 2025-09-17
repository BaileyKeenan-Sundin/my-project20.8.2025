import { useState } from "react";

// Fallback API base if prop isn't provided
const FALLBACK_API =
  (import.meta?.env?.VITE_API_BASE && String(import.meta.env.VITE_API_BASE)) ||
  "http://127.0.0.1:3000";

const STOPWORDS = new Set([
  "the","a","an","and","or","to","of","for","in","on","at","is","are","be","do",
  "what","whats","happening","show","shows","event","events","any"
]);

function intentFrom(text) {
  const t = (text || "").toLowerCase();
  const idMatch = t.match(/\b(\d{3,8})\b/);
  if (idMatch) return { type: "by-id", id: idMatch[1] };
  if (/(what|whats).*(on|happening|events)/.test(t)) return { type: "list" };
  if (/(today|tonight|tomorrow|weekend)/.test(t)) return { type: "list" };
  const terms = t.replace(/[^a-z0-9 ]/g, " ").split(/\s+/)
    .filter(w => w && w.length > 2 && !STOPWORDS.has(w));
  if (terms.length) return { type: "search", terms };
  return { type: "list" };
}

export default function Chat({ apiBase }) {
  const BASE = apiBase || FALLBACK_API;

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  const [hits, setHits] = useState([]);
  const [details, setDetails] = useState({}); // id -> detail

  async function fetchList(limit = 50) {
    const r = await fetch(`${BASE}/api/events?limit=${limit}`);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  }

  async function fetchDetail(id) {
    if (details[id]) return details[id];
    const r = await fetch(`${BASE}/api/events/${id}`);
    const d = await r.json();
    setDetails(prev => ({ ...prev, [id]: d }));
    return d;
  }

  async function submit(e) {
    e.preventDefault();
    const text = input.trim();
    if (!text) return;
    setMessages(m => [...m, { role: "user", text }]);
    setInput("");

    const intent = intentFrom(text);
    try {
      if (intent.type === "by-id") {
        const d = await fetchDetail(intent.id);
        const msg = d?.title
          ? `Here’s that event:\n\n• ${d.title}${d.url ? `\n${d.url}` : ""}`
          : "I couldn’t find that event id.";
        setMessages(m => [...m, { role: "assistant", text: msg }]);
        setHits(d?.id ? [{ id: d.id, title: d.title }] : []);
        return;
      }

      const list = await fetchList(50);

      if (intent.type === "list") {
        setMessages(m => [...m, { role: "assistant", text: `Here’s what’s on (first ${Math.min(20, list.length)}):` }]);
        setHits(list.slice(0, 20));
        return;
      }

      if (intent.type === "search") {
        const terms = intent.terms;
        const matched = list.filter(ev => {
          const t = (ev.title || "").toLowerCase();
          return terms.some(term => t.includes(term));
        });
        const msg = matched.length
          ? `I found ${matched.length} matching event(s).`
          : `I didn’t find matches for “${terms.join(" ")}”.`;
        setMessages(m => [...m, { role: "assistant", text: msg }]);
        setHits(matched.slice(0, 20));
        return;
      }
    } catch {
      const hint = BASE ? "" : " (API base URL was empty)";
      setMessages(m => [...m, { role: "assistant", text: `Something went wrong fetching events${hint}.` }]);
    }
  }

  return (
    <div style={{ marginTop: 24, padding: 16, border: "1px solid #ddd", borderRadius: 8 }}>
      <h2 style={{ marginTop: 0 }}>Ask about events</h2>
      <form onSubmit={submit} style={{ display: "flex", gap: 8 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder='Try: "what’s on", "comedy", or an event id like 40467'
          style={{ flex: 1, padding: 8 }}
        />
        <button type="submit">Ask</button>
      </form>

      <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ whiteSpace: "pre-wrap" }}>
            <strong>{m.role === "user" ? "You" : "Assistant"}:</strong> {m.text}
          </div>
        ))}
      </div>

      {!!hits.length && (
        <div style={{ marginTop: 16 }}>
          <h3 style={{ marginTop: 0 }}>Results</h3>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {hits.map(h => (
              <li key={h.id} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span>{h.title}</span>
                  <button
                    onClick={async () => {
                      const d = await fetchDetail(h.id);
                      const text = d?.url ? `Details: ${d.url}` : "No URL found.";
                      setMessages(m => [...m, { role: "assistant", text }]);
                    }}
                  >
                    Details
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
