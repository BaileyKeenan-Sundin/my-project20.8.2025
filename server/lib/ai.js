// server/lib/ai.js
import { findEvents } from "./events.js";

const CATEGORY_KEYWORDS = {
  comedy: ["comedy","stand-up","standup","comedian","laugh"],
  music: ["music","concert","gig","band"],
  family: ["family","kids","children"],
  sports: ["sport","sports","snooker","boxing","cup","race"],
  dance: ["dance","ballet","choreography"]
};

function normalize(s){ return (s||"").toString().trim(); }

function detectCategory(text){
  const t = text.toLowerCase();
  for (const [cat,kws] of Object.entries(CATEGORY_KEYWORDS)){
    if (kws.some(k => t.includes(k))) return cat;
  }
  return null;
}

function detectQuotedName(text){
  const m = text.match(/["“](.+?)["”]/);
  return m ? m[1] : null;
}

function detectNameish(text){
  const q = detectQuotedName(text);
  if (q) return q;
  const m = text.match(/\babout\s+([a-z0-9][\w\s\-&']{2,})$/i);
  return m ? m[1].trim() : null;
}

function detectWhatsOn(text){
  const t = text.toLowerCase();
  return /(what'?s\s+on|whats\s+on|what is on|anything on|events|shows|happening)/.test(t);
}

function detectDateLabel(text){
  const t = text.toLowerCase();
  if (/\btoday\b/.test(t)) return "today";
  if (/\btomorrow\b/.test(t)) return "tomorrow";
  if (/\bthis\s+weekend\b/.test(t)) return "this weekend";
  if (/\bthis\s+week\b/.test(t)) return "this week";
  if (/\bnext\s+week\b/.test(t)) return "next week";
  return null;
}

export async function askAI(rawText){
  const text = normalize(rawText);
  if (!text){
    return {
      answer: "Ask me things like “what’s on”, “what comedy is on”, or “events about ‘The Maccabees’”.",
      hits: []
    };
  }

  const wantsWhatsOn = detectWhatsOn(text);
  const cat = detectCategory(text);
  const nameQ = detectNameish(text);
  const dateLabel = detectDateLabel(text);

  const pool = await findEvents({ limit: 200 });
  let filtered = pool;

  if (nameQ){
    const q = nameQ.toLowerCase();
    filtered = filtered.filter(e => (e.title||"").toLowerCase().includes(q));
  }

  if (cat){
    const c = cat.toLowerCase();
    filtered = filtered.filter(e => {
      if (e.category && typeof e.category === "string"){
        return e.category.toLowerCase().includes(c);
      }
      return (e.title||"").toLowerCase().includes(c);
    });
  }

  if (!wantsWhatsOn && !cat && !nameQ){
    return {
      answer: "I can help you find events. Try “what’s on”, “what comedy is on”, or “events about “The Maccabees””.",
      hits: []
    };
  }

  const total = filtered.length;
  const shown = filtered.slice(0, 20).map(e => ({ id: String(e.id), title: e.title }));

  const parts = [];
  if (cat) parts.push(`${cat}`);
  if (nameQ) parts.push(`about “${nameQ}”`);
  if (dateLabel) parts.push(`${dateLabel}`);

  const facet = parts.length ? ` ${parts.join(" ")}` : "";
  const preface = total === 0
    ? `I couldn’t find any events${facet ? " for" + facet : ""}.`
    : `I found ${total} event${total===1?"":"s"}${facet ? " for " + facet : ""}. Showing up to ${shown.length}.`;

  return { answer: preface, hits: shown };
}
