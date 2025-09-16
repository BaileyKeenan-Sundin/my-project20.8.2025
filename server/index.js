// server/index.js
import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import * as dotenv from "dotenv";
import http from "http";
import { Server as SocketIOServer } from "socket.io";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const WP = (process.env.WP_BASE_URL || "").replace(/\/$/, ""); // e.g. http://example.local
const CORS_ORIGIN = process.env.CORS_ORIGIN || "http://localhost:5173";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "devsecret123";

app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

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

// --- de-dupe memory (2s window)
const recent = new Map();
function shouldDrop(key, windowMs = 2000) {
  const now = Date.now();
  const last = recent.get(key);
  recent.set(key, now);

  // clean up
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
// WordPress core posts
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
// WordPress custom Events
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
// Legacy/local stub
// ──────────────────────────────────────────────────────────────
app.get("/api/events", (_req, res) => {
  res.json([
    {
      id: "sample-1",
      title: "Sample Event",
      start: new Date().toISOString(),
      venue: "Main Hall",
      url: "https://example.com/buy",
      availability: "in_stock",
      price_from: 10,
    },
  ]);
});

// ──────────────────────────────────────────────────────────────
// AI stub
// ──────────────────────────────────────────────────────────────
app.post("/ai/chat", (req, res) => {
  const msg = req.body?.message ?? "";
  res.json({ answer: `Stub reply for: "${msg}"`, citations: [] });
});

// ──────────────────────────────────────────────────────────────
// Admin ping
// ──────────────────────────────────────────────────────────────
app.get("/admin/ping", (_req, res) => {
  io.emit("event-updated", { source: "admin-ping", ts: Date.now() });
  res.json({ ok: true, emitted: "event-updated" });
});

// ──────────────────────────────────────────────────────────────
// Webhook from WordPress
// ──────────────────────────────────────────────────────────────
app.post("/webhooks/wp", (req, res) => {
  if (!verifyWebhook(req)) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }

  const { id, action = "updated", source = "unknown" } = req.body || {};
  const key = `${id}:${action}`;

  if (shouldDrop(key)) {
    console.log("[webhook] dropped duplicate within 2s:", key);
    return res.json({ ok: true, dropped: true });
  }

  console.log("[webhook] received:", req.body);
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
