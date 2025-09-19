// server/lib/ai.js
// Rule-based intent for lightweight "what's on" search.
// Uses server/lib/events.js::findEvents() as the single source of truth.

import { findEvents } from "./events.js";

// Tune how many hits we return in one answer.
// (Matches what you've been testing: "Showing up to 10.")
const SHOW_LIMIT = 10;

const CATEGORY_KEYWORDS = {
  comedy: ["comedy", "stand-up", "standup", "comedian", "laugh"],
  music: ["music", "concert", "gig", "band", "festival"],
  family: ["family", "kids", "children"],
  sports: ["sport", "sports", "snooker", "boxing", "cup", "race"],
  dance: ["dance", "ballet", "choreography"],
  exhibition: ["exhibition", "expo", "showcase", "fair"] // helps with your data shape
};

// ──────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────
function normalizeText(s) {
  if (!s) return "";
  // unify quotes/dashes & collapse whitespace
  return String(s)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function detectCategory(text) {
  const t = text.toLowerCase();
  for (const [cat, kws] of Object.entries(CATEGORY_KEYWORDS)) {
    if (kws.some((k) => t.includes(k))) return cat;
  }
  return null;
}

function detectQuotedName(text) {
  const m = text.match(/"([^"]+)"|“([^”]+)”/);
  return m ? (m[1] || m[2]) : null;
}

function detectNameish(text) {
  const q = detectQuotedName(text);
  if (q) return q;

  // explicit patterns like: events about X, shows about X, called X, named X
  const m =
    text.match(/\babout\s+([a-z0-9][\w\s\-&']{2,})$/i) ||
    text.match(/\b(called|named)\s+([a-z0-9][\w\s\-&']{2,})$/i);
  if (m) return (m[1] && !m[2] ? m[1] : m[2]).trim();

  // fallback: if user typed something that isn't a generic "what's on" ask
  // and doesn't look like a pure category/date ask, treat the whole thing as a title query.
  const t = text.toLowerCase();
  const generic =
    detectWhatsOn(text) || detectCategory(text) || detectDateLabel(text);
  if (!generic && t.length >= 3) return text.trim();

  return null;
}

function detectWhatsOn(text) {
  const t = text.toLowerCase();
  return /(what'?s\s+on|whats\s+on|what is on|anything on|events|shows|what to see|what to do|happening)/.test(
    t
  );
}

// We’ll enable real date filtering once start/end are populated.
// For now we just annotate the phrase so your answer reads naturally.
function detectDateLabel(text) {
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return "today";
  if (/\btomorrow\b/.test(t)) return "tomorrow";
  if (/\bthis\s+weekend\b/.test(t)) return "this weekend";
  if (/\bthis\s+week\b/.test(t)) return "this week";
  if (/\bnext\s+week\b/.test(t)) return "next week";
  return null;
}

// ──────────────────────────────────────────────────────────────
export async function askAI(rawText) {
  const text = normalizeText(rawText);
  if (!text) {
    return {
      answer:
        'Ask me things like "what’s on", "what comedy is on", or "events about \\"The Maccabees\\"".',
      hits: []
    };
  }

  const wantsWhatsOn = detectWhatsOn(text);
  const cat = detectCategory(text);
  const nameQ = detectNameish(text);
  const dateLabel = detectDateLabel(text);

  // Pull from normalized/cached source
  const pool = await findEvents({ limit: 500 });
  let filtered = pool;

  // Name/title filter
  if (nameQ) {
    const q = nameQ.toLowerCase();
    filtered = filtered.filter((e) =>
      (e.title || "").toLowerCase().includes(q)
    );
  }

  // Category filter (prefer e.category, fallback to title contains)
  if (cat) {
    const c = cat.toLowerCase();
    filtered = filtered.filter((e) => {
      if (e.category && typeof e.category === "string") {
        return e.category.toLowerCase().includes(c);
      }
      return (e.title || "").toLowerCase().includes(c);
    });
  }

  // Date filter (placeholder: activates once e.start is real Date or ISO)
  if (dateLabel) {
    // Example scaffold (kept inert until start dates exist):
    // const now = new Date();
    // const startWindow = new Date(now);
    // const endWindow = new Date(now);
    // switch (dateLabel) { ... }
    // filtered = filtered.filter(e => e.start && withinWindow(e.start, startWindow, endWindow));
  }

  // If user didn’t ask a recognizable thing, guide them.
  if (!wantsWhatsOn && !cat && !nameQ) {
    return {
      answer:
        'I can help you find events. Try "what’s on", "what comedy is on", or \'events about "The Maccabees"\'.',
      hits: []
    };
  }

  const total = filtered.length;
  const shown = filtered
    .slice(0, SHOW_LIMIT)
    .map((e) => ({ id: String(e.id), title: e.title }));

  const parts = [];
  if (cat) parts.push(`${cat}`);
  if (nameQ) parts.push(`about "${nameQ}"`);
  if (dateLabel) parts.push(`${dateLabel}`);

  const facet = parts.length ? ` ${parts.join(" ")}` : "";
  const preface =
    total === 0
      ? `I couldn’t find any events${facet ? " for" + facet : ""}.`
      : `I found ${total} event${total === 1 ? "" : "s"}${
          facet ? " for " + facet : ""
        }. Showing up to ${shown.length}.`;

  return { answer: preface, hits: shown };
}
