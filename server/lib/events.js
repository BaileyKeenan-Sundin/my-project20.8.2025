// server/lib/events.js
import fetch from "node-fetch";

// ── tiny in-memory cache
let listCache = { ts: 0, data: null };
const detailCache = new Map();
const TTL_LIST_MS = 60 * 1000;       // 60s
const TTL_DETAIL_MS = 5 * 60 * 1000; // 5m

const now = () => Date.now();

function getWPBase() {
  // Read env at call-time (dotenv already loaded in index.js)
  return (process.env.WP_BASE_URL || "").replace(/\/$/, "");
}

function makeUrl(path) {
  const base = getWPBase();
  if (!base) throw new Error("WP_BASE_URL not set");
  return `${base}${path}`;
}

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} for ${url}`);
  return r.json();
}

function stripTags(html = "") {
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

// Ensure a URL is absolute using WP base if it's relative
function absoluteUrl(u) {
  if (!u) return null;
  const base = getWPBase();
  if (!base) return u;
  // handles "/path" or "//host/path"
  if (u.startsWith("//")) return new URL((base.startsWith("https") ? "https:" : "http:") + u).toString();
  if (u.startsWith("/")) return new URL(u, base).toString();
  return u;
}

// Force scheme+host to match WP_BASE_URL to reduce 404/mixed-content
function fixHostUrl(u) {
  if (!u) return null;
  const base = getWPBase();
  if (!base) return u;
  try {
    const target = new URL(absoluteUrl(u));
    const desired = new URL(base);
    // if same hostname ignoring scheme/port OR local .local domain, force to base scheme+host
    if (target.hostname === desired.hostname) {
      target.protocol = desired.protocol;
      target.host = desired.host; // host includes port if any
      return target.toString();
    }
    return target.toString();
  } catch {
    return u;
  }
}

function mapFromWpPost(p) {
  const contentHtml = p.content?.rendered || "";

  // Embedded terms → category / event-category best effort
  const terms = p._embedded?.["wp:term"] || [];
  const flat = Array.isArray(terms) ? terms.flat() : [];
  const cats = flat.filter(t => t?.taxonomy === "category").map(t => t?.name).filter(Boolean);
  const eventCats = flat
    .filter(t => /event/i.test(String(t?.taxonomy)))
    .map(t => t?.name)
    .filter(Boolean);

  // ACF/meta best-effort
  const acf = p.acf || p.meta || {};
  const start = acf.start_date || acf.date || acf.start || null;
  const end   = acf.end_date   || acf.end   || null;

  let url = p.link || null;
  url = fixHostUrl(url);

  return {
    id: String(p.id),
    title: p.title?.rendered || "",
    start,
    end,
    venue: acf.venue || "",
    category: eventCats[0] || cats[0] || null,
    url,
    availability: acf.availability ?? null,
    price_from: acf.price_from ?? null,
    content_0_text: stripTags(contentHtml).slice(0, 1200),
  };
}

/**
 * findEvents: lightweight list for grid/search
 * Supports optional { limit, q } (title contains)
 */
export async function findEvents({ limit = 50, q = "" } = {}) {
  if (listCache.data && now() - listCache.ts < TTL_LIST_MS) {
    const out = listCache.data;
    return q
      ? out.filter(e => e.title.toLowerCase().includes(q.toLowerCase())).slice(0, limit)
      : out.slice(0, limit);
  }

  const raw = await fetchJson(makeUrl("/wp-json/example/v1/events"));
  const arr = Array.isArray(raw) ? raw : [];
  const mapped = arr.map(e => ({
    id: String(e.id),
    title: e.title || e.post_title || "",
  }));

  listCache = { ts: now(), data: mapped };

  return q
    ? mapped.filter(e => e.title.toLowerCase().includes(q.toLowerCase())).slice(0, limit)
    : mapped.slice(0, limit);
}

/**
 * getEventById: richer, single event by numeric ID
 * Tries WP core posts first; falls back to likely endpoints.
 */
export async function getEventById(id) {
  const key = String(id);
  const c = detailCache.get(key);
  if (c && now() - c.ts < TTL_DETAIL_MS) return c.data;

  const candidates = [
    makeUrl(`/wp-json/wp/v2/posts/${key}?_embed=1`),
    makeUrl(`/wp-json/wp/v2/event/${key}?_embed=1`),
    makeUrl(`/wp-json/example/v1/events/${key}`),
  ];

  let data = null, lastErr = null;
  for (const url of candidates) {
    try {
      const d = await fetchJson(url);
      if (d && (d.id || d.title)) { data = d; break; }
    } catch (e) {
      lastErr = e;
    }
  }
  if (!data) throw lastErr || new Error("no detail endpoint found");

  let out;
  if (data && data.id && data.title && data.content) {
    out = mapFromWpPost(data);
  } else {
    let url = data.link || null;
    url = fixHostUrl(url);
    out = {
      id: String(data.id || id),
      title: data.title?.rendered || data.title || "",
      start: null,
      end: null,
      venue: "",
      category: null,
      url,
      availability: null,
      price_from: null,
      content_0_text: stripTags(data.content?.rendered || "").slice(0, 1200),
    };
  }

  detailCache.set(key, { ts: now(), data: out });
  return out;
}

/** invalidateEventsCache: used by webhooks/admin ping to force refresh */
export function invalidateEventsCache() {
  listCache = { ts: 0, data: null };
  detailCache.clear();
}
