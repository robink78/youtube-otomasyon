"use strict";

// HOOK ENGINE (PHASE 5). Builds hook candidates from DIFFERENT narrative
// families — never cosmetic rewordings — using only facts already present in
// the normalized topic. Every candidate records which topic fields it used so
// a reviewer can trace it back to the case file / evidence.

const M = require("../../lib/metin");
const Model = require("./topic-model");
const Sources = require("./sources");

const FORBIDDEN = /^(did you know|imagine|today we(?:'re| are)? (?:going to|will)|in this video|welcome|hey|hi |hello|scientists say|let'?s talk|have you ever wondered|(?:like and )?subscribe|follow (?:for|us)|before you scroll|wait for it|watch (?:till|until|to) the end)/i;
const DATE_OPENING = /^(in|on|by|back in)?\s*((1[5-9]|20)\d\d\b|(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec)\.?\s+\d|(january|february|march|april|may|june|july|august|september|october|november|december)\b|nineteen|eighteen|the year is)/i;
const TENSION = /\b(explod\w*|collaps\w*|fail\w*|kill\w*|dead|died|dies|sank|sink\w*|burn\w*|tore|torn|destroy\w*|crash\w*|ruptur\w*|vanish\w*|disappear\w*|stop\w*|los[et]|break\w*|broke|twist\w*|gone|doubl\w*|halv\w*|freez\w*|boil\w*|dark\w*|blackout|fractur\w*|crack\w*|flood\w*|poison\w*|shut\w*|melt\w*|welded|cooked|spark\w*|swallow\w*|flatten\w*|without)\b/gi;
const CURIOSITY = /\?|\b(why|how|what|but|not|never|only|until|hidden|nobody|no one|instead|actually|wasn'?t|isn'?t|didn'?t|doesn'?t|real|first|nothing|quietly|depends)\b/gi;
const WEAK_START = new Set(["the", "a", "an", "in", "on", "this", "there", "it", "so", "and", "we", "today"]);
const CLICKBAIT = /\b(shocking|insane|unbelievable|you won'?t believe|mind[- ]blowing|terrifying truth|exposed)\b/i;
// Fail closed on common generated-English defects. These are not style
// preferences: they produce sentence fragments or questions with a missing
// auxiliary verb (for example, "Why servers get only 5 to 15 minutes?").
const MALFORMED_ENGLISH = /^(?:why|how)\s+(?!do\b|does\b|did\b|can\b|could\b|would\b|will\b|is\b|are\b|was\b|were\b|has\b|have\b|had\b|should\b|might\b|must\b)[a-z0-9'’-]+\s+(?:get|gets|got|make|makes|made|need|needs|needed|depend|depends|relies?|survive|survives|work|works|fail|fails|stop|stops)\b.*[.?!]$/i;

function languageProblems(text) {
  const value = String(text || "").trim();
  const problems = [];
  if (MALFORMED_ENGLISH.test(value)) problems.push("malformed English question (missing auxiliary verb)");
  if (/\b(?:the|a|an|to|of|for|with|because|if|when)\s*[.!?]$/i.test(value)) problems.push("incomplete English phrase");
  if ((value.match(/[!?]/g) || []).length > 1) problems.push("malformed punctuation");
  if (/^replacing .+ is not a simple purchase[.!?]?$/i.test(value)) problems.push("generic synthetic opening");
  if (/^that[’\'`]?s\b/i.test(value)) problems.push("context-dependent opening");
  return problems;
}

const FAMILIES = [
  "shocking_consequence", "tiny_cause_massive_consequence", "hidden_cause", "contradiction", "countdown", "warning_ignored",
  "system_dependency", "impossible_sounding_fact", "misconception_reversal", "visual_first_reveal", "unexpected_chain_reaction",
  "scarcity_bottleneck", "before_after_consequence", "impossible_question", "question_gap", "human_consequence", "number_anomaly", "mechanism_reveal",
];

const VISUAL_BASE = {
  visual_first_reveal: 92, shocking_consequence: 85, countdown: 80, unexpected_chain_reaction: 76, before_after_consequence: 76,
  impossible_sounding_fact: 70, tiny_cause_massive_consequence: 72, system_dependency: 70, scarcity_bottleneck: 66, contradiction: 66,
  warning_ignored: 68, hidden_cause: 64, misconception_reversal: 62, impossible_question: 70, question_gap: 55,
  human_consequence: 82, number_anomaly: 78, mechanism_reveal: 72,
};

const words = (text) => String(text || "").split(/\s+/).filter(Boolean);
const wordCount = (text) => words(text).length;
// Split on sentence ends, but not after common abbreviations ("St. Lawrence").
const ABBREVIATION = /\b(St|Mt|Dr|Mr|Mrs|Ms|No|U\.S|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|vs|approx|ca)\.$/;
const sentences = (text) => {
  const parts = String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+/);
  const out = [];
  for (const part of parts) {
    if (out.length && ABBREVIATION.test(out[out.length - 1])) out[out.length - 1] += " " + part;
    else out.push(part);
  }
  return out.map((s) => s.trim()).filter(Boolean);
};

function sentenceCase(text) {
  const value = Model.clean(text);
  if (value && value === value.toUpperCase()) {
    return value.toLowerCase().replace(/(\d)\s?v\b/g, "$1 V").replace(/\bo-rings?\b/g, (m) => m.toUpperCase().replace("O-R", "O-r"));
  }
  return value;
}

function finish(text) {
  const value = Model.clean(text).replace(/\s+([.,!?])/g, "$1");
  if (!value) return "";
  return /[.!?]$/.test(value) ? value : value + ".";
}

// Shorten to the first clause when a sentence is too long to be a hook.
// Returns null instead of truncating mid-meaning.
function compress(text, maxWords) {
  const value = Model.clean(text);
  if (!value) return null;
  if (wordCount(value) <= maxWords) return value;
  // Numeric ranges ("1–2%", "800–900 tonnes") are one value, not a clause break.
  const protectedValue = value.replace(/(\d)\s*[–—-]\s*(\d)/g, "$1\u2060$2");
  const clause = protectedValue.split(/\s*[,;—–:]\s*|\s+-\s+/)[0].replace(/\u2060/g, "–");
  // A subordinate or prepositional lead ("If the Moon vanished tonight",
  // "Without new tools") is not a sentence.
  if (/^(if|when|because|although|while|after|before|since|as|unless|whereas|though|without|despite|during|until|once|whether|with)\b/i.test(clause)) return null;
  if (/\b(of|to|in|on|at|for|with|by|from|the|a|an|and|or|than|about)$/i.test(clause)) return null;
  if (clause && wordCount(clause) >= 4 && wordCount(clause) <= maxWords) return clause;
  return null;
}

function onScreenFor(text, topic) {
  const number = Model.numbersIn(text).find((value) => /[a-z%]/i.test(value) || /\d{3,}|,/.test(value));
  if (number && wordCount(number) <= 4) return number.toUpperCase();
  if (topic.thumbnailTexts && topic.thumbnailTexts[0] && wordCount(topic.thumbnailTexts[0]) <= 5) return topic.thumbnailTexts[0].toUpperCase();
  const content = M.icerikKelimeleri(text).filter((word) => word.length > 3).slice(0, 3);
  return content.join(" ").toUpperCase();
}

function candidate(family, spoken, topic, fields, extra = {}) {
  const text = finish(spoken);
  if (!text) return null;
  return { family, spoken: text, onScreen: extra.onScreen || onScreenFor(text, topic), fields, editorial: !!extra.editorial };
}

function build(topic, config) {
  const max = config.hooks.maxSpokenWords;
  const out = [];
  const add = (item) => { if (item) out.push(item); };
  const subject = Model.capital(topic.subject);

  // 1. Result first.
  add(candidate("shocking_consequence", compress(Model.capital(topic.consequence), max), topic, ["consequence"]));
  // 2. Small cause -> large consequence.
  if (topic.trigger && topic.kind === "case" && wordCount(topic.trigger) <= max - 3) add(candidate("tiny_cause_massive_consequence", `It took only ${Model.lower(topic.trigger)}`, topic, ["trigger"]));
  else if (topic.scenario && /\b(twice|half|double|one second|one day|tiny|slightly|1%|single)\b/i.test(topic.scenario)) add(candidate("tiny_cause_massive_consequence", compress(Model.capital(topic.scenario), max), topic, ["scenario"]));
  // 3. Hidden cause.
  const hiddenFromMisconception = sentences(topic.misconception).find((s) => /\b(nothing|no one|not|never|wasn'?t|didn'?t)\b/i.test(s) && wordCount(s) <= max);
  if (hiddenFromMisconception) add(candidate("hidden_cause", hiddenFromMisconception, topic, ["misconception"]));
  else if (topic.dependencyTarget && topic.subject) add(candidate("hidden_cause", compress(`${Model.capital(topic.dependencyTarget)} quietly relies on ${topic.subject}`, max), topic, ["dependency"]));
  else if (topic.mechanism) add(candidate("hidden_cause", compress(`The real cause was ${Model.lower(topic.mechanism)}`, max), topic, ["mechanism"]));
  // 4. Contradiction taken from the record.
  const contrast = [topic.misconception, topic.debate, ...(topic.narration || []), topic.hookText, ...(topic.evidence || []).map((e) => e.claim)]
    .flatMap(sentences).find((s) => /\b(but|yet|although|despite|passed|still|even though|not)\b/i.test(s) && wordCount(s) <= max && s !== hiddenFromMisconception);
  if (contrast) add(candidate("contradiction", contrast, topic, ["evidence"]));
  // 5. Countdown / time pressure.
  const timed = [topic.hookText, ...(topic.narration || []), ...(topic.evidence || []).map((e) => e.claim), ...(topic.timeline || []).map((t) => t.event)]
    .flatMap(sentences).find((s) => /\b\d[\d.,]*\s*(?:more\s+)?(seconds?|minutes?|hours?|days?)\b|\bin seconds\b|\bwithin\b/i.test(s) && wordCount(s) <= max);
  if (timed) add(candidate("countdown", timed, topic, ["evidence"]));
  // 6. Warning ignored (only when the record mentions one).
  if (topic.warning) add(candidate("warning_ignored", compress(topic.warning, max), topic, ["warning"]));
  // 7. System dependency.
  if (topic.dependencyTarget && topic.subject) add(candidate("system_dependency", compress(`${Model.capital(topic.dependencyTarget)} depends on ${topic.subject}`, max), topic, ["dependency"]));
  // 8. Impossible-sounding (numeric) fact from the evidence.
  // Case-file fields (chain labels, figures, mechanism noun phrases) have their
  // own families; only sentence-shaped evidence becomes a free-standing hook.
  const sentenceEvidence = (topic.evidence || []).filter((e) => e.source !== "case file");
  const numeric = [...sentenceEvidence.filter((e) => /CONFIRMED|VERIFIED|KNOWN|SUPPORTED|ESTIMATE/i.test(e.layer || e.confidence || "")).map((e) => e.claim), ...(topic.narration || []).slice(1)]
    .flatMap(sentences).filter((s) => /\d/.test(s) && !DATE_OPENING.test(s)).map((s) => compress(s, max)).filter(Boolean);
  if (numeric[0]) add(candidate("impossible_sounding_fact", numeric[0], topic, ["evidence"]));
  // 9. Misconception reversal.
  const misconceptionSentences = sentences(topic.misconception).filter((s) => s !== hiddenFromMisconception);
  const correction = misconceptionSentences.find((s) => /\b(actually|in fact|really|instead|was|is)\b/i.test(s) && /\b(not|actually|instead|real)\b/i.test(s) && wordCount(s) <= max);
  const pair = misconceptionSentences.length >= 2 && wordCount(misconceptionSentences.slice(0, 2).join(" ")) <= max + 4 ? misconceptionSentences.slice(0, 2).join(" ") : null;
  const reversal = correction || pair || null;
  if (reversal) add(candidate("misconception_reversal", reversal, topic, ["misconception"]));
  else if (topic.channel === "impossible-brief" && topic.consequence) add(candidate("misconception_reversal", compress(`It would not all happen at once`, max), topic, ["consequence"]));
  // 10. Visual-first: the editor's own opening line.
  if (topic.openingLine) add(candidate("visual_first_reveal", compress(topic.openingLine, max), topic, ["openingLine"], { editorial: true, onScreen: topic.hookText && wordCount(topic.hookText) <= 5 ? topic.hookText.toUpperCase() : undefined }));
  // 11. Chain reaction.
  if ((topic.chain || []).length >= 3) {
    const first = sentenceCase(topic.chain[0]);
    const last = sentenceCase(topic.chain[topic.chain.length - 1]);
    const start = compress(first, 6) || first.split(/\s*[,;—–]\s*/)[0];
    const end = compress(last, 6) || last.split(/\s*[,;—–]\s*/)[0];
    if (wordCount(start) <= 6 && wordCount(end) <= 6) add(candidate("unexpected_chain_reaction", `It started with ${Model.lower(start)}. It ended with ${Model.lower(end)}`, topic, ["chain"]));
  } else if (topic.secondBeat && topic.channel !== "failure-reconstructed") {
    add(candidate("unexpected_chain_reaction", compress(topic.secondBeat, max), topic, ["secondBeat"]));
  }
  // 12. Scarcity / bottleneck.
  const scarce = (topic.evidence || []).map((e) => e.claim).flatMap(sentences).find((s) => /\b(only|unique|single|sole|few|one supplier|one company|monopol)\b/i.test(s));
  if (scarce && compress(scarce, max)) add(candidate("scarcity_bottleneck", compress(scarce, max), topic, ["evidence"]));
  else if (topic.bottleneck && topic.subject) add(candidate("scarcity_bottleneck", compress(`Replacing ${topic.subject} is not a simple purchase`, max), topic, ["bottleneck"]));
  // 13. Before / after.
  if (topic.lesson && topic.kind === "case") add(candidate("before_after_consequence", compress(`After ${topic.subject}, ${Model.lower(topic.lesson)}`, max), topic, ["lesson"]));
  else if (topic.secondBeat && /^without\b/i.test(topic.secondBeat)) add(candidate("before_after_consequence", compress(topic.secondBeat, max), topic, ["secondBeat"]));
  // 14. Impossible question.
  if (topic.channel === "impossible-brief" || /\?$/.test(topic.title)) add(candidate("impossible_question", compress(topic.title, max), topic, ["question"]));
  // 15. Direct question gap.
  if (topic.subject) {
    const q = topic.channel === "critical-thread" ? `What stops if ${topic.subject} stops?`
      : topic.channel === "impossible-brief" ? `What changes first?`
        : topic.channel === "behind-the-ordinary" ? `What is ${topic.designDetail || "that detail"} for?`
        : topic.kind === "case" ? `${subject}: what failed first?` : `${subject}: what fails first?`;
    add(candidate("question_gap", compress(q, max), topic, topic.channel === "impossible-brief" ? ["question"] : ["subject"]));
  }
  // Each further documented fact (narration line or evidence claim) is its own
  // hook idea — different information, not a rewording. The family follows
  // the fact's content.
  // Chain labels and thumbnail figures are fragments, not narration.
  const timelineClaims = new Set([
    ...(topic.timeline || []).map((item) => Model.clean(`${item.t}: ${item.event}`)),
    ...(topic.chain || []).map(Model.clean), Model.clean(topic.number),
  ]);
  const facts = [...(topic.narration || []).slice(1), ...sentenceEvidence.filter((e) => e.source !== "editorial narration" && !timelineClaims.has(e.claim)).map((e) => e.claim)]
    .map((fact) => Model.capital(sentenceCase(fact))).flatMap(sentences).map((fact) => compress(fact, max)).filter(Boolean);
  for (const fact of facts) {
    if (DATE_OPENING.test(fact) || wordCount(fact) < 4 || /^[A-Z][a-z]{2} \d/.test(fact)) continue;
    const family = /\?/.test(fact) ? "contradiction"
      : /\b(seconds?|minutes?|hours?|in an instant|within)\b/i.test(fact) ? "countdown"
        : /\b(crew|people|lives|passengers|workers|children|survived|killed|died|dead)\b/i.test(fact) ? "shocking_consequence"
          : /\d/.test(fact) ? "impossible_sounding_fact"
            : /\b(now|today|since|every|never again|rule|standard)\b/i.test(fact) ? "before_after_consequence"
              : /\b(depend|relies|without)\b/i.test(fact) ? "system_dependency"
                : "hidden_cause";
    add(candidate(family, fact, topic, ["evidence"]));
  }
  // Editorial titles are packaging, not narration: only a question title can
  // double as a spoken opening.
  for (const title of (topic.editorialTitles || []).slice(0, 3)) {
    if (title && /\?$/.test(title) && wordCount(title) <= max) add(candidate("impossible_question", title, topic, ["editorialTitles"], { editorial: true }));
  }
  if (topic.hookText && topic.channel === "impossible-brief") {
    const lead = sentences(topic.hookText)[0];
    if (lead && compress(lead, max)) add(candidate("countdown", compress(lead, max), topic, ["hookText"], { editorial: true }));
  }
  // Explicit additional strategies required by the competition set. These
  // candidates are assembled only from sourced narration/evidence.
  const sourcedSentences = [...(topic.narration || []), ...(topic.evidence || []).map((item) => item.claim)].flatMap(sentences);
  const human = sourcedSentences.find((text) => /\b(crew|people|lives|passengers|workers|children|killed|died|survivors?|victims?)\b/i.test(text) && compress(text, max));
  if (human) add(candidate("human_consequence", compress(human, max), topic, ["evidence"]));
  const anomaly = sourcedSentences.find((text) => /\d/.test(text) && /\b(only|more than|less than|times|percent|%|seconds?|minutes?|hours?|crew|people|workers|passengers)\b/i.test(text) && !DATE_OPENING.test(text) && compress(text, max));
  if (anomaly) add(candidate("number_anomaly", compress(anomaly, max), topic, ["evidence"]));
  if (topic.mechanism && topic.subject) {
    const reveal = compress(`${Model.capital(topic.subject)} failed because ${Model.lower(topic.mechanism)}`, max);
    if (reveal) add(candidate("mechanism_reveal", reveal, topic, ["mechanism", "subject"]));
  }
  return out;
}

function lexiconHits(text, lexicon) {
  const value = String(text || "").toLowerCase();
  return (lexicon || []).filter((stem) => value.includes(stem)).length;
}

function clamp(value) { return Math.max(0, Math.min(100, Math.round(value))); }

function score(hook, topic, config, templated = [], options = {}) {
  const text = hook.spoken;
  const count = wordCount(text);
  const first4 = words(text).slice(0, 4).join(" ");
  const tension = (text.match(TENSION) || []).length;
  const curiosity = new Set((text.toLowerCase().match(CURIOSITY) || [])).size;
  const openingMax = options.openingMaxSeconds || null;
  const seconds = count / config.hooks.spokenWordsPerSecond;
  const numeric = Sources.numericSupport(text, topic);
  const superlatives = Sources.unsupportedSuperlatives(text, topic);
  const genericShare = hook.fields.length ? hook.fields.filter((field) => templated.includes(field) || (field === "question" && templated.includes("question"))).length / hook.fields.length : 0;
  const subjectWords = M.icerikKelimeleri(topic.subject);
  const hasSubject = subjectWords.some((word) => M.icerikKelimeleri(text).includes(word));
  const forbidden = FORBIDDEN.test(text);
  const language = languageProblems(text);
  const dateStart = DATE_OPENING.test(text);
  const firstWord = (words(text)[0] || "").toLowerCase().replace(/[^a-z]/g, "");
  const scores = {
    SwipeStoppingPower: clamp(40 + (TENSION.test(first4) || /\d/.test(first4) ? 25 : 0) + (count <= 9 ? 15 : count <= config.hooks.maxSpokenWords ? 8 : -10)
      + (!WEAK_START.has(firstWord) ? 10 : 0) + (tension ? 5 : 0) - (forbidden ? 60 : 0) - (dateStart ? 20 : 0) - genericShare * 15),
    CuriosityGap: clamp(35 + Math.min(2, curiosity) * 14 + (/unexpected_chain|hidden_cause|contradiction|misconception|impossible_question/.test(hook.family) ? 10 : 0)),
    Clarity: clamp(100 - Math.max(0, count - 9) * 5 - Math.max(0, (text.match(/,/g) || []).length - 1) * 12
      - (words(text).reduce((sum, w) => sum + w.length, 0) / Math.max(1, count) > 6.5 ? 10 : 0) - (count > config.hooks.maxSpokenWords ? 25 : 0)
      - (openingMax && seconds > openingMax * 1.5 ? Math.min(30, Math.round((seconds - openingMax * 1.5) * 12)) : 0)),
    Specificity: clamp(30 + (hasSubject ? 25 : 0) + (/\d/.test(text) ? 25 : 0) + Math.min(2, lexiconHits(text, config.lexicon)) * 8 - genericShare * 35 - (hook.family === "question_gap" ? 20 : 0)),
    EmotionalIntensity: clamp(30 + Math.min(3, tension) * 18 + (/\b(people|crew|lives|children|city|everyone|humanity|earth)\b/i.test(text) ? 10 : 0)),
    Credibility: clamp(100 - numeric.unsupported.length * 40 - superlatives.length * 25 - (CLICKBAIT.test(text) ? 30 : 0) - genericShare * 10),
    VisualCompatibility: clamp((VISUAL_BASE[hook.family] || 60) + (topic.archivalFilm ? 8 : 0) + ((topic.visualScenes || []).length >= 4 ? 4 : 0)),
    ChannelFit: clamp(50 + Math.min(4, lexiconHits(text, config.lexicon)) * 10 + ((config.hooks.preferredFamilies || []).includes(hook.family) ? 10 : 0)),
  };
  scores.ImmediateComprehension = clamp(scores.Clarity * 0.7 + (hasSubject ? 25 : 10) + (count <= 10 ? 8 : 0));
  scores.RetentionExpectation = clamp(scores.CuriosityGap * 0.55 + scores.SwipeStoppingPower * 0.45);
  scores.VoiceoverNaturalness = clamp(100 - Math.max(0, count - 10) * 5 - Math.max(0, (text.match(/[,;:]/g) || []).length - 1) * 10);
  scores.FirstFrameCompatibility = scores.VisualCompatibility;
  scores.FactualDefensibility = scores.Credibility;
  scores.ShortFormSuitability = clamp((count >= 4 && count <= config.hooks.maxSpokenWords ? 92 : 55) + (seconds <= 3.5 ? 5 : -10));
  const weights = config.hooks.weights;
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const total = Math.round(Object.entries(weights).reduce((sum, [key, weight]) => sum + scores[key] * weight, 0) / totalWeight);
  const blockers = [];
  if (forbidden) blockers.push("forbidden opening");
  blockers.push(...language);
  // PHASE 5: "In 1944…" is a bad hook — a date/setup opening is a blocker, not a penalty.
  if (dateStart) blockers.push("date/setup opening");
  if (numeric.unsupported.length) blockers.push("unsupported number: " + numeric.unsupported.join(", "));
  if (superlatives.length) blockers.push("unsupported superlative: " + superlatives.join(", "));
  return {
    ...hook,
    words: count,
    estimatedSeconds: Math.round(count / config.hooks.spokenWordsPerSecond * 10) / 10,
    scores,
    // A bare "X: what failed first?" is a fallback, not a hook idea of its own.
    total: blockers.length ? Math.min(total, 40) : hook.family === "question_gap" ? Math.min(total, 68) : total,
    blocked: blockers.length > 0,
    blockers,
    generic: genericShare >= 0.5,
  };
}

// Drop cosmetic variants: a later candidate that shares most content words
// with an earlier one is the same hook reworded, not a new idea.
function dedupe(list, threshold) {
  const kept = [];
  for (const item of list) {
    if (kept.some((other) => other.spoken.toLowerCase() === item.spoken.toLowerCase() || M.kelimeBenzerlik(other.spoken, item.spoken) >= threshold)) continue;
    kept.push(item);
  }
  return kept;
}

function generate(topic, config, options = {}) {
  const templated = options.templatedFields || [];
  const raw = build(topic, config);
  const unique = dedupe(raw, config.hooks.cosmeticSimilarity);
  const scored = unique.map((hook) => score(hook, topic, config, templated, options))
    .sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.total - a.total);
  // A learned channel preference can nudge ranking (bounded, see learning.js),
  // never override blockers.
  const learned = options.learnedFamilyBonus || {};
  for (const hook of scored) hook.adjustedTotal = hook.blocked ? hook.total : Math.min(100, hook.total + (learned[hook.family] || 0));
  scored.sort((a, b) => Number(a.blocked) - Number(b.blocked) || b.adjustedTotal - a.adjustedTotal);
  // Procedural channels voice the first claim at a natural pace (≈ 2.8
  // words/s) inside openingMaxSeconds; a hook that would need rushed speech is
  // kept for the record but is not selectable.
  if (options.openingMaxSeconds) {
    for (const hook of scored) hook.fitsOpening = hook.words / 2.8 <= options.openingMaxSeconds * 1.15;
  }
  // Editorial openings compete on the same language, factual, duration and
  // score gates as every other candidate. They remain in the audit trail but
  // can no longer override a stronger valid hook merely because they were
  // written first in the source record.
  const selected = scored.find((hook) => !hook.blocked && hook.fitsOpening !== false && hook.adjustedTotal >= config.hooks.minimumScore) || null;
  const families = new Set(scored.map((hook) => hook.family));
  return {
    channel: topic.channel,
    topicId: topic.id,
    candidates: scored,
    candidateCount: scored.length,
    familyCount: families.size,
    meetsMinimum: scored.length >= config.hooks.minimumCandidates,
    selected,
    selectedScore: selected ? selected.adjustedTotal : 0,
    passes: !!selected && selected.adjustedTotal >= config.hooks.minimumScore,
  };
}

module.exports = { FAMILIES, FORBIDDEN, DATE_OPENING, TENSION, MALFORMED_ENGLISH, languageProblems, build, score, generate, dedupe, compress, sentenceCase, wordCount };
