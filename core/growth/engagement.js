"use strict";

// ENGAGEMENT (PHASE 12/13/32F): optional contextual CTA and loop planning.
// Story payoff comes first — a CTA is appended after the payoff or not at all,
// and never replaces the native Related Video link as the long-form pathway.

const M = require("../../lib/metin");

function hash01(text) {
  let value = 2166136261;
  for (const char of String(text)) value = Math.imul(value ^ char.charCodeAt(0), 16777619) >>> 0;
  return value / 0xffffffff;
}

// Deterministic per video so reruns are idempotent (no flip-flopping CTA).
function cta(topic, config, options = {}) {
  const engagement = config.engagement;
  const relatedLong = options.relatedLongVideo || null;
  if (relatedLong) {
    const roll = hash01(`${topic.channel}:${topic.id}:long-cta`);
    if (roll < engagement.shortToLongCtaProbability) {
      const lines = engagement.longCtas || [];
      return { type: "SHORT_TO_LONG", text: lines[Math.floor(hash01(topic.id + "l") * lines.length) % lines.length], delivery: options.delivery || "spoken+on-screen",
        target: relatedLong, placement: "after payoff", primaryPathway: "native Related Video (manual action when API unsupported)" };
    }
  }
  const roll = hash01(`${topic.channel}:${topic.id}:cta`);
  if (roll >= engagement.ctaProbability) return { type: "NONE", reason: `deterministic roll ${roll.toFixed(2)} ≥ ctaProbability ${engagement.ctaProbability}` };
  const lines = engagement.ctas || [];
  return { type: "COMMENT_PROMPT", text: lines[Math.floor(hash01(topic.id + "c") * lines.length) % lines.length], delivery: "on-screen", placement: "after payoff" };
}

// LoopPotentialScore: does the final line/visual naturally re-open the first?
function loop(topic, script, hook, config) {
  const lines = script.claims ? script.claims.map((claim) => claim.text) : script;
  const first = lines[0] || "";
  const last = lines[lines.length - 1] || "";
  const overlap = M.kelimeBenzerlik(first, last);
  const causeToConsequence = /\b(that'?s why|which is why|so|this is why|and that)\b/i.test(last);
  const questionOpen = /\?/.test(first) || hook.family === "impossible_question" || hook.family === "question_gap";
  let score = 40 + Math.round(overlap * 60) + (causeToConsequence ? 15 : 0) + (questionOpen ? 10 : 0) + (hook.family === "shocking_consequence" ? 8 : 0);
  score = Math.max(0, Math.min(100, score));
  const use = score >= config.engagement.loopMinimumScore;
  return {
    LoopPotentialScore: score,
    apply: use,
    plan: use
      ? { finalVisual: "return to the opening frame (same crop) for the last 0.8 s", finalLine: "ends on the consequence the opening showed, without repeating it verbatim" }
      : { reason: "loop would not improve story satisfaction; ending stays a clean payoff" },
  };
}

module.exports = { cta, loop, hash01 };
