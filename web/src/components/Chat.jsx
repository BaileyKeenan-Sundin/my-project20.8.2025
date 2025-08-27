import { useState } from "react";

const API = "http://localhost:3000";

export default function Chat() {
  const [message, setMessage] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(e) {
    e.preventDefault();
    if (!message.trim()) return;

    setLoading(true);
    setError("");
    setAnswer("");

    try {
      const res = await fetch(`${API}/ai/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAnswer(data.answer || "");
      setMessage("");
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ border: "1px solid #ccc", padding: 12, borderRadius: 8 }}>
      <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1, padding: 8 }}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Ask something…"
          aria-label="Chat message"
        />
        <button disabled={loading || !message.trim()}>
          {loading ? "Sending…" : "Send"}
        </button>
      </form>

      {error && <p style={{ color: "red", marginTop: 8 }}>{error}</p>}

      {answer && (
        <div style={{ marginTop: 12 }}>
          <strong>Reply:</strong>
          <p>{answer}</p>
        </div>
      )}
    </div>
  );
}
