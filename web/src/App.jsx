// web/src/App.jsx
import { useEffect, useRef, useState } from "react";
import { socket } from "./socket";
import Chat from "./components/Chat.jsx";

const API = "http://localhost:3000";

export default function App() {
  const [posts, setPosts] = useState([]);
  const [events, setEvents] = useState([]);
  const [fontScale, setFontScale] = useState(1);
  const [highContrast, setHighContrast] = useState(false);
  const [liveStatus, setLiveStatus] = useState("disconnected");
  const fetchLock = useRef(false);
  const debounceRef = useRef(null);

  async function fetchPosts() {
    try {
      const r = await fetch(`${API}/api/wp/posts`);
      const data = await r.json();
      setPosts(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Fetch posts failed:", e);
    }
  }
  async function fetchEvents() {
    if (fetchLock.current) return;
    fetchLock.current = true;
    try {
      const r = await fetch(`${API}/api/events`);
      const data = await r.json();
      setEvents(Array.isArray(data) ? data : []);
      console.log("[client] events refreshed:", data);
    } catch (e) {
      console.error("Fetch events failed:", e);
    } finally {
      fetchLock.current = false;
    }
  }

  // initial load
  useEffect(() => {
    fetchPosts();
    fetchEvents();
  }, []);

  // live updates via shared socket
  useEffect(() => {
    const onConnect = () => {
      setLiveStatus("connected");
      console.log("[client] socket connected", socket.id);
    };
    const onDisconnect = (reason) => {
      setLiveStatus("disconnected");
      console.log("[client] socket disconnected:", reason);
    };
    const onUpdated = (payload) => {
      console.log("[client] event-updated received:", payload);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        fetchEvents();
      }, 400);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("event-updated", onUpdated);

    return () => {
      // IMPORTANT: do NOT socket.disconnect() here; we keep the singleton alive
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("event-updated", onUpdated);
      clearTimeout(debounceRef.current);
    };
  }, []);

  return (
    <div
      style={{
        fontSize: `${fontScale}rem`,
        background: highContrast ? "#000" : "#fff",
        color: highContrast ? "#fff" : "#111",
        minHeight: "100vh",
      }}
    >
      <header style={{ padding: 16, borderBottom: `1px solid ${highContrast ? "#666" : "#ddd"}` }}>
        <h1 style={{ margin: 0 }}>Events & Posts Demo</h1>
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setFontScale((s) => Math.max(0.875, s - 0.125))}>A–</button>
          <button onClick={() => setFontScale((s) => Math.min(1.5, s + 0.125))}>A+</button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={highContrast} onChange={(e) => setHighContrast(e.target.checked)} />
            High contrast
          </label>
          <span style={{ marginLeft: "auto", fontSize: 12, opacity: 0.7 }}>
            live: {liveStatus}
          </span>
        </div>
      </header>

      <main style={{ padding: 16 }}>
        <section>
          <h2>Latest Posts</h2>
          {!posts.length ? (
            <p>Loading…</p>
          ) : (
            <ul>
              {posts.map((p) => (
                <li key={p.id} style={{ marginBottom: 8 }}>
                  <a href={p.url} target="_blank" rel="noreferrer">{p.title}</a>
                  <div style={{ fontSize: ".9em", opacity: .75 }}>{new Date(p.date).toLocaleDateString()}</div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section style={{ marginTop: 24 }}>
          <h2>Events</h2>
          {!events.length ? (
            <p>Loading…</p>
          ) : (
            <ul>
              {events.map((ev) => (
                <li key={ev.id} style={{ marginBottom: 8 }}>
                  <strong>{ev.title}</strong> — {ev.start ? new Date(ev.start).toLocaleString() : "TBA"}
                  {ev.venue ? ` @ ${ev.venue}` : ""}
                  {ev.url ? <> — <a href={ev.url} target="_blank" rel="noreferrer">Buy</a></> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
<hr style={{marginTop:24,marginBottom:24}}/>
  <Chat apiBase={API} />
</main>
    </div>
  );
}
