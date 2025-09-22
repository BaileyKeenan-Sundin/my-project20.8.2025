// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
import http from "http";
import { Server as SocketIOServer } from "socket.io";
import { findEvents, getEventById, invalidateEventsCache } from "./lib/events.js";

import path from "path";
import { fileURLToPath } from "url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const app = express();
const PORT = process.env.PORT || 3000;
const WP = (process.env.WP_BASE_URL || "").replace(/\/$/, "");
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "devsecret123";

// CORS + JSON
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json({ limit: "1mb" }));

// ──────────────────────────────────────────────────────────────
// HTTP server + Socket.IO
// ──────────────────────────────────────────────────────────────
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer, {
  path: "/socket.io",
  cors: { origin: CORS_ORIGIN },
});

io.on("connection", (socket) => {
  console.log("[socket] connected:", socket.id);
  socket.on("disconnect", (reason) => {
    console.log("[socket] disconnected:", socket.id, reason);
  });
});

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
async function fetchWPJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`WP error ${r.status}`);
  return r.json();
}

function verifyWebhook(req) {
  const hdr = req.get("X-Webhook-Secret") || "";
  return WEBHOOK_SECRET && hdr === WEBHOOK_SECRET;
}

// small de-dupe memory
const recent = new Map();
function shouldDrop(key, windowMs = 2000) {
  const now = Date.now();
  const last = recent.get(key);
  recent.set(key, now);
  if (recent.size > 500) {
    for (const [k, t] of recent) if (now - t > windowMs * 2) recent.delete(k);
  }
  return last && now - last < windowMs;
}

// ──────────────────────────────────────────────────────────────
// Health
// ──────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

// ──────────────────────────────────────────────────────────────
// WordPress core posts (passthrough, trimmed)
// ──────────────────────────────────────────────────────────────
app.get("/api/wp/posts", async (req, res) => {
  try {
    const page = Number(req.query.page || 1);
    const per_page = Number(req.query.per_page || 10);
    const raw = await fetchWPJson(
      `${WP}/wp-json/wp/v2/posts?page=${page}&per_page=${per_page}&_embed`
    );
    const posts = raw.map((p) => ({
      id: p.id,
      title: p.title?.rendered ?? "",
      slug: p.slug,
      date: p.date,
      excerpt: p.excerpt?.rendered ?? "",
      url: p.link,
    }));
    res.json(posts);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────────────────────────────────────────────────
// WordPress custom Events (raw passthrough)
// ──────────────────────────────────────────────────────────────
app.get("/api/wp/events", async (_req, res) => {
  try {
    const raw = await fetchWPJson(`${WP}/wp-json/example/v1/events`);
    res.json(raw);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────────────────────────────────────────────────
// Normalized Events API
// ──────────────────────────────────────────────────────────────
app.get("/api/events", async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 50)));
    const q = String(req.query.q || "");
    const data = await findEvents({ limit, q });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

app.get("/api/events/:id", async (req, res) => {
  try {
    const row = await getEventById(req.params.id);
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────────────────────────────────────────────────
// AI: intent-driven list endpoint (/ai/ask)
// - Will try to use ./lib/ai.js if present (classifyQuery/buildAnswer)
// - Falls back to a built-in lightweight classifier otherwise
// ──────────────────────────────────────────────────────────────
let externalIntents = null;
try {
  // optional — if you created server/lib/ai.js
  externalIntents = await import("./lib/ai.js");
  if (!externalIntents || typeof externalIntents.classifyQuery !== "function") {
    externalIntents = null;
  }
} catch {
  externalIntents = null;
}

function builtinClassifyQuery(message) {
  const txt = String(message || "").toLowerCase();

  // quick & cheap category hints
  const categories = ["comedy", "music", "family", "sport", "sports", "dance", "exhibition"];
  const foundCats = categories.filter((c) => txt.includes(c));
  const quoted = Array.from(txt.matchAll(/"([^"]+)"/g)).map((m) => m[1]);

  // crude date hints (not filtering yet; kept for NLP surface text)
  const dateHints = [];
  if (/\btoday\b/.test(txt)) dateHints.push("today");
  if (/\btomorrow\b/.test(txt)) dateHints.push("tomorrow");
  if (/\bthis (weekend|week)\b/.test(txt)) dateHints.push(RegExp.$1);

  // build q: prefer quoted phrase, else category keyword, else raw
  let q = "";
  if (quoted.length) q = quoted.join(" ");
  else if (foundCats.length) q = foundCats.join(" ");
  else {
    // generic cue words to strip
    const junk = ["what's on", "whats on", "what is on", "show me", "events", "event", "about"];
    q = junk.reduce((s, j) => s.replace(j, ""), txt).trim();
  }

  const parts = [];
  if (foundCats.length) parts.push(foundCats.join(", "));
  if (dateHints.length) parts.push(dateHints.join(", "));
  if (quoted.length) parts.push(`“${quoted.join(" ” “")}”`);

  return { q, parts };
}

function builtinBuildAnswer({ parts, total, shown }) {
  const facet = parts?.length ? ` ${parts.join(" ")}` : "";
  if (total === 0) return { answer: `I couldn’t find any events${facet ? " for" + facet : ""}.`, hits: [] };
  return {
    answer: `I found ${total} event${total === 1 ? "" : "s"}${facet ? " for " + facet : ""}. Showing up to ${shown.length}.`,
    hits: shown,
  };
}

app.post("/ai/ask", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message required" });

    const classify = externalIntents?.classifyQuery || builtinClassifyQuery;
    const buildAnswer = externalIntents?.buildAnswer || builtinBuildAnswer;

    const { q, parts = [] } = classify(message);

    const limit = Math.max(1, Math.min(20, Number(req.body?.limit || 10)));
    const rows = await findEvents({ limit: 100, q }); // get enough, then slice
    const shown = rows.slice(0, limit);
    const total = rows.length;

    const payload = buildAnswer({ parts, total, shown });
    res.json(payload);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
});

// ──────────────────────────────────────────────────────────────
// AI: streaming chat endpoint (/ai/chat) via SSE
// Falls back to /ai/ask if streaming isn't available
// ──────────────────────────────────────────────────────────────
let streamChatFn = null;
try {
  const llmMod = await import("./lib/llm.js");
  if (llmMod && typeof llmMod.streamChat === "function") {
    streamChatFn = llmMod.streamChat;
  }
} catch { /* no-op */ }

app.post("/ai/chat", async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) return res.status(400).json({ error: "message required" });

    if (streamChatFn) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      if (typeof res.flushHeaders === "function") res.flushHeaders();

      res.write("event: hello\n");
      res.write('data: {"ok":true}\n\n');

      await streamChatFn({
        userText: message,
        onToken: (t) => res.write(`data: ${JSON.stringify({ token: t })}\n\n`),
        onDone: (final) => {
          res.write("event: done\n");
          res.write(`data: ${JSON.stringify({ text: final })}\n\n`);
          res.end();
        },
        onError: (err) => {
          res.write("event: error\n");
          res.write(`data: ${JSON.stringify({ error: String(err) })}\n\n`);
          res.end();
        },
      });
      return;
    }

    // Fallback: proxy to /ai/ask (JSON)
    const r = await fetch("http://127.0.0.1:" + PORT + "/ai/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, limit: req.body?.limit }),
    });
    const json = await r.json();
    res.status(r.status).json(json);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: String(e) });
    else try { res.end(); } catch {}
  }
});

// ──────────────────────────────────────────────────────────────
app.get("/admin/ping", (_req, res) => {
  invalidateEventsCache();
  io.emit("event-updated", { source: "admin-ping", ts: Date.now() });
  res.json({ ok: true, emitted: "event-updated" });
});

// Webhook from WordPress
app.post("/webhooks/wp", (req, res) => {
  if (!verifyWebhook(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  const { id, action = "updated" } = req.body || {};
  const key = `${id}:${action}`;
  if (shouldDrop(key)) {
    console.log("[webhook] dropped duplicate within 2s:", key);
    return res.json({ ok: true, dropped: true });
  }
  console.log("[webhook] received:", req.body);
  invalidateEventsCache();
  io.emit("event-updated", { source: "wp-webhook", payload: req.body, ts: Date.now() });
  res.json({ ok: true, received: req.body });
});

// ──────────────────────────────────────────────────────────────
// Start server
// ──────────────────────────────────────────────────────────────
httpServer.listen(PORT, process.env.HOST || "0.0.0.0", () => {
  console.log(`HTTP+Socket server on http://localhost:${PORT}`);
  console.log(`Socket.IO path: /socket.io  CORS origin: ${CORS_ORIGIN}`);
  console.log(`WP base: ${WP}`);
});
