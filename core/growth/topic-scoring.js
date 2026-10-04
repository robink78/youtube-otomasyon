"use strict";

// VideoPotentialScore (PHASE 2), topic buckets A/B/C/D (PHASE 3) and
// LongFormPotentialScore (PHASE 32B). Scores are scored separately and stored
// separately: a strong Short topic can be a weak long-form topic and vice versa.
//
// Every factor records its basis:
//   inventory-signal  a value the channel's research inventory already carries
//   derived           computed from topic facts by a documented heuristic
//   learned           adjusted by this channel's own adopted learning
// Nothing here is presented as measured audience demand unless it is.

const M = require("../../lib/metin");
const Model = require("./topic-model");
const Sources = require("./sources");
const Hooks = require("./hooks");

const clamp = (value) => Math.max(0, Math.min(100, Math.round(value)));
const has = (value) => value != null && Number.isFinite(+value);
const count = (text, pattern) => (String(text || "").match(pattern) || []).length;

const HUMAN_STAKES = /\b(crew|people|lives|passengers|workers|children|killed|died|dead|survivors?|victims?|homeless|evacuat\w*|humanity|everyone|cities|hospitals?|food|water|power|electricity|internet|medicine|fuel|heat)\b/gi;
const SURPRISE = /\b(not|never|only|nothing|no one|nobody|instead|actually|wasn'?t|isn'?t|but|yet|despite|unique|single|hidden|quietly|invisible)\b/gi;

function factor(value, basis, note) {
  return { value: clamp(value), basis, ...(note ? { note } : {}) };
}

function component(value, basis, note) {
  return { value: Math.max(-100, Math.min(100, Math.round(value))), basis, ...(note ? { note } : {}) };
}

function allText(topic) {
  return [topic.title, topic.consequence, topic.trigger, topic.mechanism, topic.misconception, topic.debate, topic.lesson,
    topic.dependency, topic.bottleneck, topic.hookText, topic.openingLine, topic.secondBeat, ...(topic.narration || []),
    ...(topic.evidence || []).map((item) => item.claim)].join(" ");
}

function specificEvidenceCount(topic, templated) {
  // Facts that are not boilerplate: narration lines, evidence claims and
  // case-file fields that the inventory does not repeat.
  const templatedValues = new Set(templated.map((field) => String(topic[field] || "").toLowerCase().replace(/[.?!]+$/, "")).filter(Boolean));
  const templatedHook = templated.includes("hookText");
  const fromEvidence = (topic.evidence || []).filter((item) => {
    const claim = String(item.claim || "").toLowerCase().replace(/[.?!]+$/, "");
    if (item.source === "CriticalThread bounded dependency model" || /rule/i.test(item.claim || "")) return false;
    if (templatedValues.has(claim)) return false;
    if (item.source === "editorial brief" && templatedHook) return false;
    return true;
  }).length;
  const specificFields = ["trigger", "mechanism", "number", "misconception", "lesson", "warning"].filter((field) => topic[field] && !templated.includes(field)).length;
  return fromEvidence + specificFields;
}

function factors(topic, context) {
  const { config, boilerplate, hooks, sourceQuality, publishedTitles = [], clusterSizes = {}, performance = {} } = context;
  const templated = boilerplate.templatedFields;
  const generic = boilerplate.ratio;
  const text = allText(topic);
  const lexicon = config.lexicon || [];
  const lexHits = lexicon.filter((stem) => text.toLowerCase().includes(stem)).length;
  const s = topic.signals || {};
  const evidenceCount = specificEvidenceCount(topic, templated);
  const f = {};

  // TopicDemand: inventory search seed when present; FR editorial priority;
  // otherwise evergreen as a weak proxy. Measured Search data replaces it via
  // learning (performance.demand) once the channel has published evidence.
  if (has(performance.topicDemand)) f.TopicDemandScore = factor(performance.topicDemand, "learned", "channel search/traffic evidence");
  else if (has(s.popularity)) f.TopicDemandScore = factor(s.popularity, "measured", `Wikipedia monthly pageviews: ${topic.popularity.article} (${topic.popularity.monthlyViews})`);
  else if (has(s.searchDemand)) f.TopicDemandScore = factor(s.searchDemand, "inventory-signal", "seed estimate pending channel Search observations");
  else if (has(s.priority)) f.TopicDemandScore = factor(s.priority, "inventory-signal", "editorial priority (oncelik)");
  else f.TopicDemandScore = factor(has(s.evergreen) ? s.evergreen * 0.8 : 55, "derived", "no demand signal; evergreen proxy");

  const surprise = count(text, SURPRISE);
  f.CuriosityScore = factor((has(s.curiosity) ? s.curiosity : 55 + Math.min(4, surprise) * 7 + (topic.misconception ? 10 : 0) + (topic.question ? 5 : 0)) - generic * 30,
    has(s.curiosity) ? "inventory-signal" : "derived");

  f.HookPotentialScore = factor(hooks.selectedScore - (hooks.meetsMinimum ? 0 : 8), "derived", `${hooks.candidateCount} candidates / ${hooks.familyCount} families`);

  let visual = has(s.visual) ? s.visual : topic.archivalFilm ? 90 : topic.archival ? 78 : topic.stock ? 62 : 55;
  if (topic.channel === "failure-reconstructed" && topic.stock) visual = 64;
  f.VisualImpactScore = factor(visual - generic * 15, has(s.visual) ? "inventory-signal" : "derived", topic.archivalFilm ? "real archival film" : topic.archival ? "archival stills" : undefined);

  const stakes = count(text, HUMAN_STAKES);
  f.EmotionalImpactScore = factor(45 + Math.min(5, stakes) * 8 + Math.min(3, count(text, Hooks.TENSION)) * 4 - generic * 20, "derived");

  const chainOk = (topic.chain || []).length >= 3 && (topic.chain || []).length <= 7;
  const compression = 40 + (topic.consequence ? 12 : 0) + (topic.mechanism && !templated.includes("mechanism") ? 14 : 0) + (topic.trigger || topic.scenario ? 10 : 0)
    + (chainOk ? 12 : 0) + (topic.lesson && !templated.includes("resilience") ? 6 : 0) + Math.min(4, evidenceCount) * 3;
  f.StoryCompressionScore = factor(compression - generic * 35, "derived");

  const numbers = Model.numbersIn(text).length;
  f.RewatchPotentialScore = factor(45 + Math.min(3, numbers) * 8 + (chainOk ? 10 : 0) + (topic.archivalFilm ? 10 : 0) - generic * 20, "derived");
  f.SharePotentialScore = factor(45 + (topic.misconception ? 15 : 0) + Math.min(2, numbers) * 8 + Math.min(3, surprise) * 5 + (stakes ? 6 : 0) - generic * 25, "derived");
  f.CommentPotentialScore = factor(45 + (topic.debate ? 20 : 0) + (topic.misconception ? 10 : 0) + (topic.question ? 8 : 0) + (topic.channel === "impossible-brief" ? 8 : 0) - generic * 15, "derived");

  const clusterSize = clusterSizes[topic.cluster] || 1;
  f.SubscriberConversionPotential = factor(50 + Math.min(20, clusterSize * 2) + ((config.topic.priorityClusters || []).includes(topic.cluster) ? 10 : 0) + (lexHits >= 3 ? 8 : 0) + ((context.learnedClusterBonus || {})[topic.cluster] || 0), "derived+learned",
    `series depth: ${clusterSize} topics in ${topic.cluster || "no cluster"}`);

  const similarity = publishedTitles.length ? Math.max(...publishedTitles.map((title) => M.kelimeBenzerlik(title, topic.title))) : 0;
  f.NoveltyScore = factor((has(s.novelty) ? s.novelty : 80) - similarity * 60 - generic * 15, has(s.novelty) ? "inventory-signal" : "derived", similarity ? `max title similarity ${similarity.toFixed(2)}` : undefined);

  f.AudienceFitScore = factor(has(s.audienceFit) ? s.audienceFit : ((config.topic.priorityClusters || []).includes(topic.cluster) ? 85 : 70), has(s.audienceFit) ? "inventory-signal" : "derived");
  f.SourceQualityScore = factor(sourceQuality.score, "derived", sourceQuality.notes.join("; ") || undefined);

  const required = topic.channel === "failure-reconstructed" ? [topic.mechanism, topic.consequence]
    : topic.channel === "impossible-brief" ? [topic.mechanism, topic.scenario, topic.consequence]
      : topic.channel === "behind-the-ordinary" ? [topic.mechanism, topic.question, topic.consequence]
        : [topic.dependency, topic.bottleneck, topic.consequence];
  f.ChannelFitScore = factor(45 + Math.min(5, lexHits) * 6 + required.filter(Boolean).length / required.length * 25 - generic * 10, "derived");
  return { factors: f, evidenceCount, similarity };
}

// Transparent Viral Potential Score. It complements the existing editorial
// VideoPotentialScore with the exact packaging, recognizability, evidence and
// risk dimensions used at a publication decision. Penalties stay visible as
// negative numbers instead of being buried in the final score.
function viralFactors(topic, context, parts) {
  const config = context.config;
  const text = allText(topic);
  const evidence = parts.evidenceCount;
  const humans = count(text, HUMAN_STAKES);
  const surprises = count(text, SURPRISE);
  const numbers = Model.numbersIn(text).length;
  const performance = (context.clusterPerformance || {})[topic.cluster] || { n: 0, score: 50, breakoutRate: 0 };
  const learnedCluster = (context.learnedClusterBonus || {})[topic.cluster] || 0;
  // Measured recognition first (Wikipedia pageviews), then inventory seeds.
  const recognizabilitySeed = has(topic.signals && topic.signals.popularity) ? topic.signals.popularity
    : has(topic.signals && topic.signals.searchDemand) ? topic.signals.searchDemand
    : has(topic.signals && topic.signals.priority) ? topic.signals.priority : topic.year ? 65 : 50;
  const titleCount = (topic.editorialTitles || []).length + (topic.title ? 1 : 0);
  const duplicateRisk = Math.round(parts.similarity * 100);
  const saturationRisk = performance.n ? Math.min(100, performance.n / Math.max(1, context.clusterSizes && context.clusterSizes[topic.cluster] || 1) * 300) : 0;
  const recentFatigueRisk = performance.recentN ? Math.min(100, performance.recentN * 22) : 0;
  const sourceRisk = 100 - context.sourceQuality.score;
  const weakFootageRisk = topic.archivalFilm ? 0 : topic.archival ? 15 : topic.stock ? 45 : Math.max(20, 75 - (topic.visualScenes || []).length * 7);
  const components = {
    curiosity_gap: component(parts.factors.CuriosityScore.value, "derived"),
    immediate_stakes: component(45 + (topic.consequence ? 25 : 0) + Math.min(3, humans) * 8, "derived"),
    human_consequence: component(35 + Math.min(6, humans) * 10, "derived"),
    recognizability: component(recognizabilitySeed + (has(topic.signals && topic.signals.popularity) ? 0 : topic.year ? 5 : 0),
      has(topic.signals && topic.signals.popularity) ? "measured" : has(topic.signals && (topic.signals.searchDemand != null || topic.signals.priority != null)) ? "inventory-signal" : "derived"),
    surprise: component(40 + Math.min(4, surprises) * 10 + (topic.misconception ? 10 : 0), "derived"),
    visual_potential: component(parts.factors.VisualImpactScore.value, parts.factors.VisualImpactScore.basis),
    archival_footage_potential: component(topic.archivalFilm ? 100 : topic.archival ? 80 : topic.stock ? 45 : 35, "inventory-signal"),
    first_frame_potential: component((topic.visualScenes || []).length ? (topic.archivalFilm ? 95 : topic.archival ? 82 : 68) : 30, "derived"),
    title_potential: component(45 + Math.min(5, titleCount) * 8 + (topic.number ? 8 : 0) + (topic.misconception ? 7 : 0), "derived", `${titleCount} source-backed title seeds`),
    emotional_tension: component(parts.factors.EmotionalImpactScore.value, "derived"),
    contradiction: component(topic.misconception ? 85 : topic.debate ? 68 : surprises ? 50 : 30, "derived"),
    unexpected_cause: component(topic.trigger && topic.mechanism ? 82 : topic.mechanism ? 65 : 25, "derived"),
    numerical_anomaly: component(numbers ? Math.min(95, 50 + numbers * 12) : 25, "derived"),
    didnt_know_factor: component((parts.factors.NoveltyScore.value + parts.factors.CuriosityScore.value) / 2, "derived"),
    shareability: component(parts.factors.SharePotentialScore.value, "derived"),
    channel_fit: component(parts.factors.ChannelFitScore.value, "derived"),
    historical_similarity: component(performance.score + learnedCluster, performance.n ? "learned" : "neutral", performance.n ? `${performance.n} same-cluster upload(s), breakout rate ${performance.breakoutRate}` : "no same-cluster channel evidence yet"),
    subscriber_conversion_potential: component(performance.subscriberConversion == null
      ? parts.factors.SubscriberConversionPotential.value
      : Math.min(100, 50 + performance.subscriberConversion * 10), performance.subscriberConversion == null ? "derived" : "learned",
    performance.subscriberConversion == null ? "series-depth proxy; no measured conversion yet" : `${performance.subscriberConversion.toFixed(2)} subscribers / 1,000 views in this topic family`),
    audience_breadth: component(parts.factors.AudienceFitScore.value, parts.factors.AudienceFitScore.basis),
    hook_potential: component(parts.factors.HookPotentialScore.value, "derived"),
    visual_availability: component(Math.max(0, 100 - weakFootageRisk), "inventory-signal"),
    research_confidence: component(context.sourceQuality.score, "derived"),
    duplicate_risk: component(-duplicateRisk, "penalty", duplicateRisk ? `published-title similarity ${parts.similarity.toFixed(2)}` : "no published-title collision"),
    saturation_risk: component(-saturationRisk, "penalty", `${performance.n || 0} published / ${context.clusterSizes && context.clusterSizes[topic.cluster] || 1} inventory in cluster`),
    recent_fatigue_risk: component(-recentFatigueRisk, "penalty", `${performance.recentN || 0} same-family upload(s) in the last 30 days`),
    source_confidence_risk: component(-sourceRisk, "penalty", context.sourceQuality.notes.join("; ") || `${context.sourceQuality.score}/100 source quality`),
    weak_footage_risk: component(-weakFootageRisk, "penalty", topic.archivalFilm ? "archival film available" : topic.archival ? "archival stills available" : "no archival footage confirmed"),
  };
  const weights = config.viralScoring.weights;
  let positiveSum = 0;
  let positiveWeight = 0;
  let penaltySum = 0;
  let penaltyWeight = 0;
  const penaltyKeys = new Set(["duplicate_risk", "saturation_risk", "recent_fatigue_risk", "source_confidence_risk", "weak_footage_risk"]);
  for (const [key, weight] of Object.entries(weights)) {
    const value = components[key] && components[key].value;
    if (!Number.isFinite(value)) continue;
    if (penaltyKeys.has(key)) { penaltySum += Math.abs(value) * weight; penaltyWeight += weight; }
    else { positiveSum += value * weight; positiveWeight += weight; }
  }
  const positive = positiveWeight ? positiveSum / positiveWeight : 0;
  const penalty = penaltyWeight ? penaltySum / penaltyWeight * config.viralScoring.penaltyScale : 0;
  return { score: clamp(positive - penalty), components, weights, calculation: { positive: Math.round(positive * 10) / 10, penalty: Math.round(penalty * 10) / 10, penaltyScale: config.viralScoring.penaltyScale }, specificEvidence: evidence };
}

function weighted(factorMap, weights) {
  let sum = 0;
  let total = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (!factorMap[key]) continue;
    sum += factorMap[key].value * weight;
    total += weight;
  }
  return total ? Math.round(sum / total) : 0;
}

function applyLearnedWeights(base, learned, maxShift) {
  const out = { ...base };
  for (const [key, multiplier] of Object.entries(learned || {})) {
    if (!(key in out)) continue;
    const bounded = Math.max(1 - maxShift, Math.min(1 + maxShift, multiplier));
    out[key] = Math.round(out[key] * bounded * 1000) / 1000;
  }
  return out;
}

// Buckets: A breakout / B evergreen / C experimental / D reject. Hard rejects
// bypass the numeric score. The reasons are stored with the bucket.
function bucket(score, parts, topic, context) {
  const { config, boilerplate, hooks, sourceQuality, duplicate } = context;
  const reasons = [];
  const rejects = [];
  if (!topic.mechanism && topic.channel !== "critical-thread") rejects.push("no mechanism in the topic record");
  if (topic.channel === "behind-the-ordinary" && topic.productionReady !== true) rejects.push("research question is not production-ready");
  if (topic.channel === "critical-thread" && !topic.dependency) rejects.push("no dependency statement");
  const sourceCount = (topic.sources || []).length;
  if (sourceCount < config.topic.minimumSourcesForProduction) rejects.push(`only ${sourceCount} source(s); minimum ${config.topic.minimumSourcesForProduction}`);
  if (duplicate) rejects.push("duplicate of " + duplicate);
  if (!hooks.selected) rejects.push("no hook survived fact/forbidden-opening checks");
  if (boilerplate.ratio >= config.topic.hardRejectBoilerplateRatio && parts.evidenceCount < 3) {
    rejects.push(`template content: ${Math.round(boilerplate.ratio * 100)}% of fields repeat across the inventory and only ${parts.evidenceCount} topic-specific fact(s) exist — needs a ResearchPackage`);
  }
  if (rejects.length) return { bucket: "D", reasons: rejects, enrichable: rejects.every((reason) => /template content/.test(reason)) };
  const thresholds = config.topic.buckets;
  const requirementsA = config.topic.bucketRequirements.A;
  const requirementsB = config.topic.bucketRequirements.B;
  const hook = hooks.selectedScore;
  const source = sourceQuality.score;
  const enoughSourcesForAB = sourceCount >= config.topic.minimumSourcesForAB;
  if (enoughSourcesForAB && score >= thresholds.A && hook >= requirementsA.hookMinimum && source >= requirementsA.sourceMinimum && boilerplate.ratio <= requirementsA.maxBoilerplateRatio) {
    reasons.push(`VideoPotential ${score} ≥ ${thresholds.A}`, `hook ${hook}`, `sources ${source}`);
    return { bucket: "A", reasons };
  }
  if (enoughSourcesForAB && score >= thresholds.B && hook >= requirementsB.hookMinimum && source >= requirementsB.sourceMinimum && boilerplate.ratio <= requirementsB.maxBoilerplateRatio) {
    reasons.push(`VideoPotential ${score} ≥ ${thresholds.B}`);
    if (score >= thresholds.A) reasons.push(`not A: ${hook < requirementsA.hookMinimum ? "hook " + hook + " < " + requirementsA.hookMinimum : source < requirementsA.sourceMinimum ? "sources " + source + " < " + requirementsA.sourceMinimum : "boilerplate " + boilerplate.ratio}`);
    return { bucket: "B", reasons };
  }
  if (score >= thresholds.C) {
    reasons.push(`VideoPotential ${score} in experimental band ${thresholds.C}–${thresholds.B - 1}`);
    if (hook < requirementsB.hookMinimum) reasons.push(`hook ${hook} < ${requirementsB.hookMinimum}`);
    if (source < requirementsB.sourceMinimum) reasons.push(`sources ${source} < ${requirementsB.sourceMinimum}`);
    if (boilerplate.ratio > requirementsB.maxBoilerplateRatio) reasons.push(`boilerplate ${boilerplate.ratio}`);
    if (!enoughSourcesForAB) reasons.push(`single-source: every claim rests on ${sourceCount} source — add an authoritative second source to qualify for A/B`);
    return { bucket: "C", reasons };
  }
  return { bucket: "D", reasons: [`VideoPotential ${score} < ${thresholds.C}`] };
}

function scoreShort(topic, context) {
  const parts = factors(topic, context);
  const viral = viralFactors(topic, context, parts);
  const weights = applyLearnedWeights(context.config.topic.weights, context.learnedWeights, context.config.learning.maxWeightShift);
  const score = weighted(parts.factors, weights);
  const classification = bucket(score, parts, topic, context);
  const candidate = context.config.candidatePool;
  const selectionScore = Math.round(score * candidate.videoPotentialWeight + viral.score * candidate.viralPotentialWeight);
  return {
    channel: topic.channel,
    topicId: topic.id,
    slug: topic.slug,
    title: topic.title,
    cluster: topic.cluster,
    VideoPotentialScore: score,
    ViralPotentialScore: viral.score,
    SelectionScore: selectionScore,
    bucket: classification.bucket,
    reasons: classification.reasons,
    enrichable: !!classification.enrichable,
    factors: parts.factors,
    viralComponents: viral.components,
    viralWeights: viral.weights,
    viralCalculation: viral.calculation,
    weights,
    boilerplate: context.boilerplate,
    specificEvidence: parts.evidenceCount,
    sourceQuality: context.sourceQuality,
    selectedHook: context.hooks.selected ? { family: context.hooks.selected.family, spoken: context.hooks.selected.spoken, score: context.hooks.selectedScore } : null,
  };
}

// ---------------------------------------------------------------------------
// LongFormPotentialScore — depth, not virality.
function scoreLongForm(topic, context) {
  const { config, boilerplate, sourceQuality, clusterSizes = {}, shortsEvidence = null, relatedCount = 0 } = context;
  const templated = boilerplate.templatedFields;
  const generic = boilerplate.ratio;
  const s = topic.signals || {};
  const evidenceCount = specificEvidenceCount(topic, templated);
  const chain = (topic.chain || []).length;
  const timeline = (topic.timeline || []).length;
  const f = {
    DepthPotential: factor(35 + Math.min(10, evidenceCount) * 5 + (topic.misconception ? 6 : 0) + (topic.debate ? 6 : 0) - generic * 30, "derived"),
    NarrativeDepth: factor(35 + Math.min(6, chain) * 6 + Math.min(5, timeline) * 4 + (topic.warning ? 8 : 0) + (topic.lesson ? 6 : 0) + (topic.scenario ? 10 : 0) - generic * 25, "derived"),
    SourceDepth: factor(sourceQuality.score * 0.6 + Math.min(5, (topic.sources || []).length) * 8, "derived", `${(topic.sources || []).length} sources, ${sourceQuality.primaryCount} primary`),
    VisualDepth: factor((has(s.visual) ? s.visual : topic.archivalFilm ? 85 : topic.archival ? 72 : 55) * 0.7 + Math.min(6, (topic.visualScenes || []).length) * 5 - generic * 10, has(s.visual) ? "inventory-signal" : "derived"),
    EngineeringOrScientificDepth: factor((has(s.depth) ? s.depth : 40 + (topic.mechanism && !templated.includes("mechanism") ? 30 : 0) + Math.min(3, Model.numbersIn(allText(topic)).length) * 6) - generic * 25, has(s.depth) ? "inventory-signal" : "derived"),
    SearchDemand: factor(has(s.searchDemand) ? s.searchDemand : has(s.priority) ? s.priority : 55, has(s.searchDemand) || has(s.priority) ? "inventory-signal" : "derived", "seed estimate unless measured"),
    EvergreenPotential: factor(has(s.evergreen) ? s.evergreen : topic.year ? 85 : 75, has(s.evergreen) ? "inventory-signal" : "derived"),
    AudienceFit: factor(has(s.audienceFit) ? s.audienceFit : ((config.topic.priorityClusters || []).includes(topic.cluster) ? 85 : 70), has(s.audienceFit) ? "inventory-signal" : "derived"),
    ShortsEvidence: shortsEvidence
      ? factor(shortsEvidence.score, "measured", shortsEvidence.note)
      : factor(50, "derived", "no published Short in this cluster yet — neutral"),
    SeriesPotential: factor(40 + Math.min(40, (clusterSizes[topic.cluster] || 1) * 3) + relatedCount * 5, "derived"),
    ViewerJourneyPotential: factor(45 + Math.min(30, relatedCount * 10) + ((clusterSizes[topic.cluster] || 1) >= 5 ? 10 : 0), "derived"),
  };
  if (has(s.longPotential)) {
    // The inventory's own long-form estimate is averaged in, never trusted alone.
    f.DepthPotential = factor((f.DepthPotential.value + s.longPotential) / 2, "derived+inventory-signal");
  }
  const weights = config.longform.potentialWeights;
  const score = weighted(f, weights);
  const thresholds = config.longform.potentialBuckets;
  const reasons = [];
  let bucketName;
  if ((topic.sources || []).length < 2) { bucketName = "D"; reasons.push("fewer than two sources"); }
  else if (generic >= config.topic.hardRejectBoilerplateRatio && evidenceCount < 4) { bucketName = "D"; reasons.push("template content cannot carry 8–12 minutes without a ResearchPackage"); }
  else if (score >= thresholds.A) { bucketName = "A"; reasons.push(`LongFormPotential ${score} ≥ ${thresholds.A}`); }
  else if (score >= thresholds.B) { bucketName = "B"; reasons.push(`LongFormPotential ${score} ≥ ${thresholds.B}`); }
  else if (score >= thresholds.C) { bucketName = "C"; reasons.push(`LongFormPotential ${score}: needs more evidence`); }
  else { bucketName = "D"; reasons.push(`LongFormPotential ${score} < ${thresholds.C}`); }
  return { channel: topic.channel, topicId: topic.id, slug: topic.slug, title: topic.title, cluster: topic.cluster, LongFormPotentialScore: score, bucket: bucketName, reasons, factors: f, weights, specificEvidence: evidenceCount };
}

module.exports = { factors, viralFactors, weighted, bucket, scoreShort, scoreLongForm, applyLearnedWeights, specificEvidenceCount };
