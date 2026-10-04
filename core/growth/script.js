"use strict";

// RETENTION-OPTIMIZED SHORT SCRIPTING (PHASE 7/8).
//
// Failure Reconstructed narration is editorial and is NEVER auto-replaced: the
// engine maps it onto the channel structure and lints it. ImpossibleBrief and
// CriticalThread scripts are assembled here from the topic's own facts, in the
// channel's default story order, keeping the claim-layer contract the existing
// renderer and quality gates rely on (five timed claims with evidence layers).

const M = require("../../lib/metin");
const Model = require("./topic-model");
const Hooks = require("./hooks");
const Sources = require("./sources");

const FILLER = /\b(basically|actually|literally|really|very|just|in fact|essentially|obviously|of course|kind of|sort of|you know|as you can see)\b/gi;
const CAUSAL = /\b(because|so|which|then|when|until|after|that'?s why|this is why|as a result|once|if)\b/i;
const BRIDGE = /\b(but|then|so|until|yet|still|instead|and then|which meant|now)\b/i;
const PAYOFF = /\b(predict\w*|timeline|that'?s why|is why|now|today|since|every|lesson|changed|means|depends|answer|so the|which is why|resilience|backup|redundan|survive|never|only)\b/i;

const sentences = (text) => String(text || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim()).filter(Boolean);
const wordCount = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
const finish = (text) => { const value = Model.clean(text); return !value ? "" : /[.!?]$/.test(value) ? value : value + "."; };

function beatRole(sentence, index, total, channel) {
  const text = sentence.toLowerCase();
  if (channel === "failure-reconstructed") {
    if (index === 0) return "CONSEQUENCE";
    if (index === total - 1) return "ENGINEERING_REVEAL";
    if (/\b(rated|designed|because|caused|welded|cracked|flaw|corrod|fatigue|pressure|load|mechanism|called|resonan|flutter|wire|valve|seal)\b/.test(text)) return "CAUSE";
    if (/\b(then|spread|seconds|minutes|faster|within|grew|chain|next|another|later)\b/.test(text)) return "ESCALATION";
    return index <= 2 ? "FAILURE" : "ESCALATION";
  }
  return null;
}

function lint(lines, topic, config, options = {}) {
  const max = config.script.shorts.maxSentenceWords;
  const findings = [];
  let score = 100;
  const all = lines.join(" ");
  const total = wordCount(all);
  const [low, high] = config.script.shorts.targetWords;
  const templatedValues = new Set((options.templatedFields || []).map((field) => String(topic[field] || "").toLowerCase().replace(/[.?!]+$/, "")).filter(Boolean));
  if (Hooks.FORBIDDEN.test(lines[0] || "")) { score -= 40; findings.push("BLOCKER: forbidden opening"); }
  if (lines[1] && Hooks.DATE_OPENING.test(lines[1])) { score -= 10; findings.push("second beat opens with a date — context before tension"); }
  if (lines[0] && Hooks.DATE_OPENING.test(lines[0])) { score -= 35; findings.push("BLOCKER: opens with a date or generic setup"); }
  lines.forEach((line, index) => {
    const longest = Math.max(...sentences(line).map(wordCount), 0);
    if (longest > max) { score -= 5; findings.push(`beat ${index + 1} has a ${longest}-word sentence (> ${max})`); }
    const filler = line.match(FILLER) || [];
    if (filler.length) { score -= 3 * filler.length; findings.push(`sentence ${index + 1} filler: ${filler.join(", ")}`); }
    const bare = line.toLowerCase().replace(/[.?!]+$/, "");
    if ([...templatedValues].some((value) => value && (bare.includes(value) || value.includes(bare)))) { score -= 8; findings.push(`sentence ${index + 1} is inventory boilerplate`); }
  });
  const subjectWord = M.icerikKelimeleri(topic.subject)[0];
  if (subjectWord && lines.filter((line) => line.toLowerCase().includes(subjectWord)).length > 3) { score -= 5; findings.push("subject name repeated in more than three sentences"); }
  if (!CAUSAL.test(all)) { score -= 8; findings.push("no explicit cause → effect connective"); }
  if (!BRIDGE.test(lines.slice(1).join(" "))) { score -= 5; findings.push("no curiosity bridge after the opening"); }
  if (!PAYOFF.test(lines[lines.length - 1] || "")) { score -= 10; findings.push("final line has no payoff / consequence / lesson"); }
  if (total > high) { score -= Math.min(20, Math.ceil((total - high) / 5) * 3); findings.push(`${total} words > ${high} target`); }
  if (total < low) { score -= 8; findings.push(`${total} words < ${low}: thin`); }
  const numeric = Sources.numericSupport(all, topic);
  if (!numeric.supported) { score -= 40; findings.push("BLOCKER: unsupported number(s): " + numeric.unsupported.join(", ")); }
  const superlatives = Sources.unsupportedSuperlatives(all, topic);
  if (superlatives.length) { score -= 15; findings.push("unsupported superlative(s): " + superlatives.join(", ")); }
  const roles = lines.map((line, index) => beatRole(line, index, lines.length, topic.channel));
  const contentWords = M.icerikKelimeleri(all).length;
  const duplicatePairs = [];
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) if (M.kelimeBenzerlik(lines[i], lines[j]) >= 0.65) duplicatePairs.push([i + 1, j + 1]);
  const first = lines[0] || "";
  const last = lines[lines.length - 1] || "";
  const estimatedSeconds = total / 2.8;
  const components = {
    hookDelay: Hooks.FORBIDDEN.test(first) || Hooks.DATE_OPENING.test(first) ? 20 : 95,
    setupDelay: lines[1] && Hooks.DATE_OPENING.test(lines[1]) ? 45 : 85,
    sentenceLength: Math.max(0, 100 - lines.reduce((sum, line) => sum + Math.max(0, Math.max(...sentences(line).map(wordCount), 0) - max) * 5, 0)),
    informationDensity: Math.max(0, Math.min(100, Math.round(contentWords / Math.max(1, total) * 145))),
    repetition: Math.max(0, 100 - duplicatePairs.length * 25),
    deadSections: Math.max(0, 100 - (all.match(FILLER) || []).length * 12),
    escalation: BRIDGE.test(lines.slice(1).join(" ")) ? 90 : 45,
    unansweredQuestions: /\?/.test(first) || /\b(why|how|what|but|until|hidden)\b/i.test(first) ? 85 : 60,
    earlyPayoff: /\b(collaps|explod|fail|kill|sank|broke|destroy|without|depend|stop)\w*/i.test(lines.slice(0, 2).join(" ")) ? 90 : 55,
    visualOpportunities: Math.min(100, 45 + (topic.visualScenes || []).length * 7),
    clarity: Math.max(0, 100 - findings.filter((item) => /sentence|filler|boilerplate/.test(item)).length * 10),
    duration: estimatedSeconds >= 18 && estimatedSeconds <= 60 ? 95 : 45,
    endingStrength: PAYOFF.test(last) ? 95 : 45,
  };
  const blockers = findings.filter((item) => item.startsWith("BLOCKER"));
  return {
    score: Math.max(0, Math.min(100, score)),
    words: total,
    estimatedSeconds: Math.round(estimatedSeconds * 10) / 10,
    components,
    duplicatePairs,
    findings,
    blockers,
    roles,
    rejectionReason: blockers[0] || (score < config.script.shorts.minimumScore ? `retention quality ${score} < ${config.script.shorts.minimumScore}` : null),
    rewriteSuggested: blockers.length > 0 || score < config.script.shorts.minimumScore,
    passes: score >= config.script.shorts.minimumScore && blockers.length === 0,
  };
}

// ----------------------------------------------------------------------------
// Assembled scripts for isolated (procedural) channels.
// Shorten without amputating a list: "maintenance, spares, diversification and
// recovery plans" keeps as many whole items as fit, joined naturally.
function shorten(text, maxWords) {
  const value = Model.clean(text).replace(/[.]+$/, "");
  if (wordCount(value) <= maxWords) return value;
  const parts = value.split(/\s*,\s*|\s+and\s+/);
  const isList = parts.length >= 3 && parts.slice(1).every((part) => wordCount(part) <= 4);
  if (isList && wordCount(parts[0]) < maxWords) {
    const kept = [parts[0]];
    for (const part of parts.slice(1)) {
      if (wordCount([...kept, part].join(" ")) + 1 > maxWords) break;
      kept.push(part);
    }
    if (kept.length >= 2) return kept.slice(0, -1).join(", ") + " and " + kept[kept.length - 1];
  }
  return Hooks.compress(value, maxWords) || value.split(/\s*[;—–]\s*/)[0];
}

function impossibleBrief(topic, hook, config, options) {
  const templated = options.templatedFields || [];
  const assumption = topic.scenario && wordCount(topic.scenario) <= 9 ? `Assume ${Model.lower(topic.scenario)}.` : null;
  const secondBeat = !templated.includes("secondBeat") && topic.secondBeat ? topic.secondBeat : null;
  const mechanism = shorten(topic.mechanism, 7);
  const beats = [
    { role: "IMPOSSIBLE_QUESTION", layer: "SPECULATIVE SCENARIO", confidence: "SPECULATIVE", text: hook.spoken },
    { role: "ASSUMPTION", layer: "SPECULATIVE SCENARIO", confidence: "SPECULATIVE", text: assumption || secondBeat || `Take it literally, and start with ${Model.lower(mechanism)}.` },
    { role: "FIRST_EFFECT", layer: "KNOWN SCIENCE", confidence: "VERIFIED", text: secondBeat && assumption ? `${finish(secondBeat)} That follows from ${Model.lower(mechanism)}.` : `The first effect follows from ${Model.lower(mechanism)}.` },
    { role: "SECOND_ORDER_EFFECT", layer: "ESTIMATED CONSEQUENCE", confidence: "ESTIMATED", text: `Then the bigger shift: ${Model.lower(topic.consequence)}.` },
    { role: "SCIENTIFIC_PAYOFF", layer: "ESTIMATED CONSEQUENCE", confidence: "SUPPORTED", text: options.payoffLine || "The order of effects is predictable. The exact timeline is not." },
  ];
  return beats;
}

function criticalThread(topic, hook, config, options) {
  const templated = options.templatedFields || [];
  const verified = (topic.evidence || []).filter((item) => /VERIFIED/i.test(item.layer) && !item.claim.includes(hook.spoken.replace(/\.$/, "")));
  const hookIsFact = /VERIFIED|evidence/.test(String(hook.fields)) || hook.family === "impossible_sounding_fact";
  const why = !templated.includes("secondBeat") && topic.secondBeat ? topic.secondBeat : `Without it, ${Model.lower(topic.dependencyTarget || topic.category)} loses a qualified step.`;
  const depends = verified[0] ? shorten(verified[0].claim, 16) : `${Model.capital(topic.dependency)}.`;
  const bottleneck = shorten(topic.bottleneck, 8);
  return [
    { role: "HIDDEN_SYSTEM", layer: hookIsFact ? "VERIFIED FACT" : "MODEL", confidence: hookIsFact ? "VERIFIED FACT" : "MODEL", text: hook.spoken },
    { role: "WHY_IT_MATTERS", layer: "VERIFIED FACT", confidence: "VERIFIED FACT", text: finish(why) },
    { role: "WHAT_DEPENDS_ON_IT", layer: "VERIFIED FACT", confidence: "VERIFIED FACT", text: finish(depends) },
    { role: "BOTTLENECK_FAILURE", layer: "MODEL", confidence: "MODEL", text: `${finish(bottleneck)} If it fails, ${Model.lower(shorten(topic.consequence, 11))}.` },
    { role: "RESILIENCE", layer: "VERIFIED FACT", confidence: "VERIFIED FACT", text: options.payoffLine || finish(shorten(topic.resilience, 10)) },
  ];
}

function buildShort(topic, hookBundle, config, options = {}) {
  const hook = hookBundle.selected;
  if (!hook) throw new Error("buildShort requires a selected hook");
  const beats = topic.channel === "critical-thread" ? criticalThread(topic, hook, config, options) : impossibleBrief(topic, hook, config, options);
  // Nominal timing mirrors the old contract; real timing is measured from the
  // per-claim narration takes during render (core/rendering applyMeasuredTiming).
  const nominal = topic.channel === "critical-thread" ? [0, 2, 6, 18, 29, 36] : [0, 1.5, 5, 18, 28, 32];
  const claims = beats.map((beat, index) => ({ start: nominal[index], end: nominal[index + 1], ...beat, text: finish(beat.text) }));
  if (options.cta) claims[claims.length - 1].text = `${claims[claims.length - 1].text} ${finish(options.cta)}`;
  const spoken = claims.map((claim) => claim.text).join(" ");
  const quality = lint(claims.map((claim) => claim.text), topic, config, options);
  return {
    format: "short",
    targetSeconds: nominal[nominal.length - 1],
    spoken,
    claims,
    structure: beats.map((beat) => beat.role),
    forbiddenOpening: Hooks.FORBIDDEN.test(spoken),
    sourceIds: (topic.sources || []).map((source) => source.name),
    retention: quality,
    generator: "core/growth/script",
  };
}

module.exports = { lint, buildShort, beatRole, FILLER };
