// server/lib/ai.js
// Intent + answer helpers used by /ai/ask.
// Design goals:
// 1) Keep the raw user message in the search query so results match your SSE path.
// 2) Add lightweight, extensible category synonyms (no rigid hard-coding).
// 3) Provide simple, stable text answers + compact hit list for the UI.

import { findEvents } from "./events.js";

const SHOW_LIMIT = 10;

// Small, extensible seed list — we *append* these to the user's text
// instead of replacing it, so we don't get brittle behavior.
const CATEGORY_SYNONYMS = {
  music: [
    "concert", "gig", "band", "orchestra", "live", "tour",
    "festival", "dj", "singer", "choir", "performance"
  ],
  comedy:    ["comedy","comedian","stand up","stand-up","standup","comic"],
  family:    ["family","kids","children","child","family-friendly","family friendly"],
  sports:    ["sport","sports","boxing","snooker","cycling","football","tennis","run","marathon","ice hockey","hockey"],
  dance:     ["dance","ballet","contemporary","hip hop","hip-hop"],
  theatre:   ["theatre","theater","play","drama","stage"],
  film:      ["film","cinema","movie","screening"],
  festival:  ["festival","fair","market","street fair"],
  exhibition:["exhibition","expo","showcase","gallery","art show"]
};

function norm(s) {
  return String(s || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function detectWhatsOn(t) {
  t = t.toLowerCase();
  return /(what'?s\s+on|whats\s+on|what is on|anything on|events|shows|happening|what to see|what to do)/.test(
    t
  );
}

function detectCategory(text) {
  const t = text.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_SYNONYMS)) {
    if (kws.some(k => t.includes(k)) || t.includes(cat)) return cat;
  }
  return null;
}

function detectQuoted(text) {
  const m = text.match(/"([^"]+)"|“([^”]+)”/);
  return m ? (m[1] || m[2]) : null;
}

function detectDateLabel(text) {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return "today";
  if (/\btomorrow\b/.test(t)) return "tomorrow";
  if (/\bthis\s+weekend\b/.test(t)) return "this weekend";
  if (/\bthis\s+week\b/.test(t)) return "this week";
  if (/\bnext\s+week\b/.test(t)) return "next week";
  return null;
}

// Build the string we pass into findEvents({ q })
// Key idea: start with the *raw* user message, then append light synonyms.
// If a quoted title/artist is present, prefer that as the core term.
function buildSearchQ(text) {
  const qParts = [];
  const quoted = detectQuoted(text);
  if (quoted) {
    qParts.push(quoted);
  } else {
    // keep the original text so your ranker behaves like the SSE path
    qParts.push(text);
  }
  const cat = detectCategory(text);
  if (cat && CATEGORY_SYNONYMS[cat]) {
    qParts.push(...CATEGORY_SYNONYMS[cat]);
  }
  // de-dupe tokens but keep order reasonably stable
  const seen = new Set();
  const toks = qParts
    .join(" ")
    .split(/\s+/)
    .map(t => t.toLowerCase())
    .filter(t => {
      if (!t) return false;
      if (seen.has(t)) return false;
      seen.add(t);
      return true;
    });
  return toks.join(" ");
}

// ── Exports used by server/index.js ────────────────────────────

export function classifyQuery(rawMessage) {
  const text = norm(rawMessage);
  const parts = [];
  if (!text) return { q: "", parts };

  const cat = detectCategory(text);
  const quoted = detectQuoted(text);
  const dateLabel = detectDateLabel(text);
  const whatsOn = detectWhatsOn(text);

  if (cat) parts.push(cat);
  if (quoted) parts.push(`about "${quoted}"`);
  if (dateLabel) parts.push(dateLabel);
  if (!cat && !quoted && whatsOn) parts.push("what's on");

  const q = buildSearchQ(text);
  return { q, parts };
}

export function buildAnswer({ parts = [], total = 0, shown = [] }) {
  const shownCount = shown.length;
  const facet = parts.length ? ` for ${parts.join(" ")}` : "";
  const answer =
    total === 0
      ? `I couldn’t find any events${facet || ""}.`
      : `I found ${total} event${total === 1 ? "" : "s"}${facet || ""}. Showing up to ${Math.min(
          SHOW_LIMIT,
          shownCount
        )}.`;
  // Keep hits minimal and predictable for UI
  const hits = shown.map(e => ({ id: String(e.id), title: e.title }));
  return { answer, hits };
}

// Optional: still available if anything calls it directly (not required by /ai/ask)
export async function askAI(rawText) {
  const { q, parts } = classifyQuery(rawText);
  const rows = await findEvents({ limit: 120, q });
  const shown = rows.slice(0, SHOW_LIMIT);
  return buildAnswer({ parts, total: rows.length, shown });
}
