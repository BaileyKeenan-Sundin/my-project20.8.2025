// server/lib/events.js
import fetch from "node-fetch";

// --- tiny in-memory cache
let listCache = { ts: 0, data: null };
const detailCache = new Map();
const TTL_LIST_MS = 60 * 1000;      // 60s
const TTL_DETAIL_MS = 5 * 60 * 1000; // 5 min

const now = () => Date.now();

function getWPBase() {
  // Read from env at call-time so dotenv is already loaded by index.js
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

function mapFromWpPost(p) {
  const contentHtml = p.content?.rendered || "";

  // Try to find categories / event taxonomies if embedded
  const terms = p._embedded?.["wp:term"] || [];
  const flat = Array.isArray(terms) ? terms.flat() : [];
  const cats = flat.filter(t => t?.taxonomy === "category").map(t => t?.name).filter(Boolean);
  const eventCats = flat
    .filter(t => /event/i.test(String(t?.taxonomy)))
    .map(t => t?.name)
    .filter(Boolean);

  // Common ACF/meta keys (best-effort)
  const acf = p.acf || p.meta || {};
  const start = acf.start_date || acf.date || acf.start || null;
  const end   = acf.end_date   || acf.end   || null;

  return {
    id: String(p.id),
    title: p.title?.rendered || "",
    start,
    end,
    venue: acf.venue || "",
    category: eventCats[0] || cats[0] || null,
    url: p.link || null,
    availability: acf.availability ?? null,
    price_from: acf.price_from ?? null,
    content_0_text: stripTags(contentHtml).slice(0, 1200),
  };
}

/**
 * findEvents: returns a lightweight list for the grid/search
 * Supports optional { limit, q } (title contains).
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
 * getEventById: fetch a rich, single event by numeric ID
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
  // WP core shape
  if (data && data.id && data.title && data.content) {
    out = mapFromWpPost(data);
  } else {
    // Fallback/legacy shape
    out = {
      id: String(data.id || id),
      title: data.title?.rendered || data.title || "",
      start: null,
      end: null,
      venue: "",
      category: null,
      url: data.link || null,
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
