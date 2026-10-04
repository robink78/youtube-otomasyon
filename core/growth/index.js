"use strict";

// GROWTH ENGINE — shared algorithm, channel-isolated memory.
//
//   rank → select (A/B first, C deliberately) → hooks → first 3 s → script →
//   titles → CTA/loop → integrity/factual → pacing/captions → readiness
//
// planShort() is pure planning (no uploads). The Shorts pipelines call it
// before render (pre-stage gate) and again with options.render after render
// (final-stage gate on the measured output).

const Config = require("./config");
const Store = require("./store");
const Model = require("./topic-model");
const Context = require("./context");
const Titles = require("./titles");
const Hooks = require("./hooks");
const FirstSeconds = require("./first-seconds");
const Script = require("./script");
const Engagement = require("./engagement");
const Integrity = require("./integrity");
const Pacing = require("./pacing");
const Readiness = require("./readiness");
const Funnel = require("./funnel");
const Experiments = require("./experiments");

function durationBucket(seconds) {
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 18) return "under-18s";
  if (seconds <= 25) return "18-25s";
  if (seconds <= 35) return "26-35s";
  if (seconds <= 45) return "36-45s";
  if (seconds <= 60) return "46-60s";
  return "over-60s";
}

function optimizeEditorialOpening(lines, selectedHook, config) {
  const original = [...lines];
  if (!config.hooks.applySelectedOpening || !selectedHook || !selectedHook.spoken || !original.length) return { lines: original, changed: false, original: original[0] || null, selected: original[0] || null };
  const clean = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const spoken = selectedHook.spoken;
  if (clean(original[0]) === clean(spoken)) return { lines: original, changed: false, original: original[0], selected: original[0] };
  const existing = original.findIndex((line, index) => index > 0 && clean(line) === clean(spoken));
  const next = existing > 0 ? [original[existing], ...original.slice(0, existing), ...original.slice(existing + 1)] : [spoken, ...original.slice(1)];
  return { lines: next, changed: true, original: original[0], selected: next[0], source: existing > 0 ? `editorial line ${existing + 1} promoted` : "fact-checked hook candidate" };
}

function findTopic(ctx, idOrSlug) {
  return ctx.inventory.find((topic) => topic.id === idOrSlug || topic.slug === idOrSlug) || null;
}

function decisionCandidate(row) {
  return {
    topicId: row.topic.id,
    slug: row.topic.slug,
    topic: row.topic.title,
    cluster: row.topic.cluster,
    bucket: row.score.bucket,
    viralScore: row.score.ViralPotentialScore,
    videoPotentialScore: row.score.VideoPotentialScore,
    selectionScore: row.score.SelectionScore,
    viralComponents: row.score.viralComponents,
    selectedHook: row.score.selectedHook,
    rejectionReasons: row.score.reasons,
  };
}

function writeDecision(channel, decision) {
  const rows = Store.readState(channel, "growth", "decisions.json", []);
  const next = rows.filter((row) => !(row.date === decision.date && row.contentType === decision.contentType)).concat(decision).slice(-500);
  Store.writeState(channel, "growth", "decisions.json", next);
  Store.writeState(channel, "growth", "latest-decision.json", decision);
}

// Deterministic 75/25 exploit/explore selection over a real, inspectable
// 20–50 topic decision pool. Exploit follows measured scoring. Explore favours
// under-sampled clusters while retaining quality buckets. D is never selected.
function selectShortTopic(channel, options = {}) {
  const ranked = options.ranked || Context.rank(channel, options);
  const config = Config.forChannel(channel);
  const policy = config.scheduler.shorts;
  const selectionPolicy = config.selection;
  const poolPolicy = config.candidatePool;
  const day = options.date || new Date().toISOString().slice(0, 10);
  const exclude = new Set(options.exclude || []);
  const eligible = ranked.rows.filter((row) => !exclude.has(row.topic.id) && !exclude.has(row.topic.slug));
  const qualified = eligible.filter((row) => row.score.bucket !== "D");
  const candidatePool = qualified.slice(0, poolPolicy.target);
  const poolReady = candidatePool.length >= poolPolicy.minimum;
  const primary = candidatePool.filter((row) => selectionPolicy.exploitBuckets.includes(row.score.bucket));
  const experimental = candidatePool.filter((row) => row.score.bucket === policy.experimentalBucket);
  const modeRoll = Engagement.hash01(`${channel.slug}:${day}:explore-exploit`);
  const mode = modeRoll < selectionPolicy.exploreRatio ? "EXPLORE" : "EXPLOIT";
  let choice = null;
  let reason = null;
  if (!poolReady) reason = `NO_CANDIDATE_POOL: ${candidatePool.length} qualified unused topic(s); minimum ${poolPolicy.minimum}`;
  else if (mode === "EXPLORE") {
    const allowed = candidatePool.filter((row) => selectionPolicy.exploreBuckets.includes(row.score.bucket));
    const byCluster = new Map();
    for (const row of allowed) {
      const rows = byCluster.get(row.topic.cluster) || [];
      if (rows.length < selectionPolicy.exploreTopPerCluster) rows.push(row);
      byCluster.set(row.topic.cluster, rows);
    }
    const underSampled = [...byCluster.entries()].flatMap(([cluster, rows]) => rows.map((row) => ({
      row,
      observations: ranked.context.clusterPerformance[cluster] && ranked.context.clusterPerformance[cluster].n || 0,
      roll: Engagement.hash01(`${channel.slug}:${day}:${row.topic.slug}:explore`),
    }))).sort((a, b) => a.observations - b.observations || a.roll - b.roll || b.row.score.SelectionScore - a.row.score.SelectionScore);
    choice = underSampled[0] && underSampled[0].row || null;
    reason = choice ? `EXPLORE (${selectionPolicy.exploreRatio}): under-sampled cluster ${choice.topic.cluster}` : "NO_EXPLORE_CANDIDATE";
  } else if (primary.length) { choice = primary[0]; reason = `EXPLOIT (${selectionPolicy.exploitRatio}): best ${primary[0].score.bucket} topic by SelectionScore`; }
  else if (policy.fallbackToC && experimental.length) { choice = experimental[0]; reason = "FALLBACK_TO_C: no A/B topic remains; C must still pass full production readiness"; }
  const inventory = { A: 0, B: 0, C: 0, D: 0 };
  for (const row of eligible) inventory[row.score.bucket] += 1;
  const decision = {
    schema: "growth-topic-decision/1",
    channel: channel.slug,
    contentType: "short",
    date: day,
    createdAt: (options.now || new Date()).toISOString(),
    mode,
    modeRoll: Math.round(modeRoll * 1000) / 1000,
    pool: {
      minimum: poolPolicy.minimum,
      target: poolPolicy.target,
      count: candidatePool.length,
      meetsMinimum: poolReady,
      candidates: candidatePool.slice(0, poolPolicy.maximumLogged).map(decisionCandidate),
    },
    selected: choice ? decisionCandidate(choice) : null,
    reason,
  };
  if (options.write) writeDecision(channel, decision);
  return {
    schema: decision.schema,
    channel: channel.slug,
    date: day,
    mode,
    selected: choice,
    reason: choice ? reason : reason || `NO_QUALIFIED_TOPIC: ${primary.length} A/B, ${experimental.length} C${policy.fallbackToC ? "" : " (C fallback disabled)"}; skipping is better than publishing weak content`,
    inventory,
    candidatePool: decision.pool,
    decision,
    ranked,
  };
}

// Production order for the legacy (Failure Reconstructed) loop, which tries
// topics in order until one succeeds: the selection first, then the rest of the
// primary buckets, then C only when fallback is allowed. D never appears.
function orderedQueue(channel, options = {}) {
  const selection = selectShortTopic(channel, options);
  const config = Config.forChannel(channel);
  const policy = config.scheduler.shorts;
  const exclude = new Set(options.exclude || []);
  const rows = selection.ranked.rows.filter((row) => !exclude.has(row.topic.id) && !exclude.has(row.topic.slug));
  const order = [];
  const push = (row) => { if (row && !order.includes(row.topic.slug)) order.push(row.topic.slug); };
  push(selection.selected);
  rows.filter((row) => policy.primaryBuckets.includes(row.score.bucket)).forEach(push);
  if (policy.fallbackToC) rows.filter((row) => row.score.bucket === policy.experimentalBucket).forEach(push);
  return { order, reason: selection.reason, mode: selection.mode, inventory: selection.inventory, candidatePool: selection.candidatePool, decision: selection.decision, selected: selection.selected ? selection.selected.topic.slug : null };
}

const DEFAULT_LAYER = { "impossible-brief": "KNOWN SCIENCE", "critical-thread": "VERIFIED FACT" };
function editorialClaims(topic, config, templatedFields, selectedHook = null) {
  const beats = topic.narrationBeats.map((beat) => ({ ...beat }));
  const opening = optimizeEditorialOpening(beats.map((beat) => beat.text), selectedHook, config);
  if (opening.changed) beats[0] = { ...beats[0], text: opening.selected, role: "HOOK", layer: beats[0].layer || DEFAULT_LAYER[topic.channel] || "VERIFIED FACT" };
  const lint = Script.lint(beats.map((beat) => beat.text), topic, config, { templatedFields });
  const wordsPerSecond = 2.8;
  let t = 0;
  const claims = beats.map((beat, index) => {
    const text = /[.!?]$/.test(beat.text) ? beat.text : beat.text + ".";
    const seconds = Math.max(1.2, text.split(/\s+/).length / wordsPerSecond);
    const claim = { start: Math.round(t * 10) / 10, end: Math.round((t + seconds) * 10) / 10, role: beat.role || `BEAT_${index + 1}`, layer: beat.layer || DEFAULT_LAYER[topic.channel] || "VERIFIED FACT", confidence: beat.layer || DEFAULT_LAYER[topic.channel] || "VERIFIED FACT", text };
    t += seconds;
    return claim;
  });
  return {
    format: "short", generator: "editorial (researched record)", targetSeconds: claims[claims.length - 1].end,
    spoken: claims.map((claim) => claim.text).join(" "), claims, lines: claims.map((claim) => claim.text),
    structure: claims.map((claim) => claim.role), forbiddenOpening: Hooks.FORBIDDEN.test(claims[0].text),
    sourceIds: (topic.sources || []).map((source) => source.name), retention: lint, openingRewrite: opening,
  };
}

function gateMode() {
  return process.env.GROWTH_GATE_MODE === "shadow" ? "shadow" : "enforce";
}

function captionClaimsFromNarration(lines, seconds) {
  const words = lines.map((line) => line.split(/\s+/).length);
  const total = words.reduce((a, b) => a + b, 0) || 1;
  let t = 0;
  return lines.map((text, index) => { const start = t; t += seconds * words[index] / total; return { start, end: t, text }; });
}

// Legacy FR renders from uretim/<slug>/konu.json. Apply the audited growth
// choices to that per-run copy before footage/TTS/render, while leaving the
// source case file in icerik/konular immutable.
function applyLegacyOverlay(spec, plan) {
  const copy = JSON.parse(JSON.stringify(spec));
  if (!plan || plan.channel !== "failure-reconstructed" || !plan.topic || !copy.slug || plan.topic.slug !== copy.slug || !plan.readiness || plan.readiness.decision === "BLOCK") return copy;
  const lines = plan.script && Array.isArray(plan.script.lines) ? plan.script.lines : [];
  const title = plan.titles && plan.titles.selected && plan.titles.selected.title;
  const hook = plan.hooks && plan.hooks.selected;
  if (title) copy.baslik = title;
  if (lines.length) copy.sahneler = (copy.sahneler || []).map((scene, index) => ({ ...scene, metin: lines[index] || scene.metin }));
  if (hook) copy.hook = hook.onScreen || hook.spoken || copy.hook;
  copy.growthPlan = { schema: plan.schema, selectedHook: hook || null, selectedTitle: plan.titles.selected || null, openingRewrite: plan.script.openingRewrite || null };
  return copy;
}

function planShort(channel, idOrTopic, options = {}) {
  const ctx = options.context || Context.build(channel, options);
  const config = ctx.config;
  const topic = typeof idOrTopic === "string" ? findTopic(ctx, idOrTopic) : idOrTopic;
  if (!topic) throw new Error(`${channel.name}: topic not found for growth plan: ${idOrTopic}`);
  if (topic.channel !== channel.slug) throw new Error(`CROSS_CHANNEL_PLAN_BLOCKED: topic ${topic.id} belongs to ${topic.channel}`);
  const evaluation = Context.evaluate(topic, ctx, { skipDuplicate: options.skipDuplicate });
  const hooks = evaluation.hooks;
  const retention = channel.config.retentionRules || {};
  const related = Funnel.relatedLongFor(channel, topic, { longs: options.longs });
  const cta = Engagement.cta(topic, config, { relatedLongVideo: related ? { videoId: related.long.videoId, title: related.long.title, relationship: related.relationship } : null });
  const experiment = options.assignExperiment ? Experiments.assign(channel, "short", topic.slug, { write: options.write }) : null;
  const legacyTitles = options.legacyTitles || [];
  const titles = Titles.generate(topic, config, "short", { extra: legacyTitles, publishedTitles: ctx.history.publishedTitles, learnedPatternBonus: ctx.learnedTitlePatternBonus });
  let script;
  if (topic.channel === "failure-reconstructed") {
    // The source case file remains immutable. The production plan may promote
    // the highest-scoring fact-checked hook into line one; provenance and the
    // original opening remain in the plan for audit and rollback.
    const opening = optimizeEditorialOpening(topic.narration, hooks.selected, config);
    const lint = Script.lint(opening.lines, topic, config, { templatedFields: evaluation.boilerplate.templatedFields });
    script = { format: "short", generator: "editorial case file + selected hook", spoken: opening.lines.join(" "), lines: opening.lines, originalLines: topic.narration, openingRewrite: opening, structure: lint.roles, retention: lint };
  } else if (topic.narration && topic.narration.length) {
    // Researched ImpossibleBrief / CriticalThread records: editorial narration,
    // one timed claim per line with its evidence layer (the renderer's
    // contract); nominal timing is replaced by measured takes at render.
    script = editorialClaims(topic, config, evaluation.boilerplate.templatedFields, hooks.selected);
  } else if (hooks.selected) {
    script = Script.buildShort(topic, hooks, config, { templatedFields: evaluation.boilerplate.templatedFields, cta: cta.type !== "NONE" && cta.delivery !== "on-screen" ? cta.text : null });
  } else {
    script = { format: "short", generator: "none", spoken: "", lines: [], structure: [], retention: { score: 0, findings: ["no hook"], blockers: ["BLOCKER: no hook"], passes: false } };
  }
  const lines = script.claims ? script.claims.map((claim) => claim.text) : script.lines;
  const first = hooks.selected ? FirstSeconds.plan(topic, hooks, config, { openingMaxSeconds: retention.openingMaxSeconds }) : { score: 0, passes: false, blockers: ["no hook"], First3SecondPlan: null };
  const loop = hooks.selected ? Engagement.loop(topic, script.claims ? script : lines, hooks.selected, config) : { LoopPotentialScore: 0, apply: false };
  const disclosureEnabled = options.disclosureEnabled !== false;
  const integrity = Integrity.visual(topic, config, { disclosureEnabled });
  const factual = Integrity.factual(topic, lines);
  const range = channel.config.publishingCadence.shorts.targetDurationSeconds || [20, 40];
  const estimatedSeconds = Math.round(lines.join(" ").split(/\s+/).length / 2.8 * 10) / 10;
  const plannedSegments = Pacing.segments(Math.min(range[1], Math.max(range[0], estimatedSeconds)), config);
  const pacing = Pacing.pacingReport(plannedSegments);
  const captionClaims = script.claims || captionClaimsFromNarration(lines, estimatedSeconds);
  const captions = Pacing.captionAudit(captionClaims, config.captions);
  const readiness = Readiness.shorts({
    channel: channel.slug,
    topicScore: evaluation.score,
    hooks,
    titles,
    script: script.retention,
    firstSeconds: first,
    factual,
    integrity,
    sourceQuality: evaluation.sourceQuality,
    metadata: { uploadChannel: channel.slug },
    duplicate: options.duplicate || null,
    captions: options.stage === "final" ? captions : null,
    pacing,
    durationRange: range,
    render: options.render || null,
    externalGate: options.externalGate || null,
  }, config);
  const plan = {
    schema: "growth-short-plan/1",
    channel: channel.slug,
    channelName: channel.name,
    contentType: "short",
    createdAt: (options.now || new Date()).toISOString(),
    topic: { id: topic.id, slug: topic.slug, title: topic.title, cluster: topic.cluster, subject: topic.subject },
    topicScore: evaluation.score,
    viralPotentialGate: {
      score: evaluation.score.ViralPotentialScore,
      minimum: Number(config.viralScoring.minimumToProduce || 68),
      decision: evaluation.score.ViralPotentialScore >= Number(config.viralScoring.minimumToProduce || 68) ? "PRODUCE" : "BLOCK",
      components: evaluation.score.viralComponents,
    },
    topicDecision: options.selection || null,
    hooks: { selected: hooks.selected, selectedScore: hooks.selectedScore, passes: hooks.passes, candidateCount: hooks.candidateCount, familyCount: hooks.familyCount, meetsMinimum: hooks.meetsMinimum, candidates: hooks.candidates },
    first3Seconds: first,
    script: { ...script, estimatedSeconds },
    titles: { selected: titles.selected, selectedScore: titles.selectedScore, count: titles.count, meetsMinimum: titles.meetsMinimum, candidates: titles.candidates },
    cta,
    loop,
    integrity,
    factual,
    pacing: { plannedSegments, ...pacing },
    captions,
    relatedLong: related ? { videoId: related.long.videoId, slug: related.long.slug, title: related.long.title, ...related.relationship } : null,
    experiment,
    readiness,
    growthMeta: {
      hookType: hooks.selected ? hooks.selected.family : null,
      hookScore: hooks.selectedScore,
      selectedHook: hooks.selected ? hooks.selected.spoken : null,
      firstLine: lines[0] || null,
      firstSecondsScore: first.score,
      topicCluster: topic.cluster,
      bucket: evaluation.score.bucket,
      viralScore: evaluation.score.ViralPotentialScore,
      viralComponents: evaluation.score.viralComponents,
      storyStructure: (config.story && config.story.shorts || []).join(">"),
      titlePattern: titles.selected ? titles.selected.pattern : null,
      selectedTitle: titles.selected ? titles.selected.title : null,
      // Predictions recorded at decision time, compared with outcomes later
      // (core/growth/predictions.js). Full candidate lists stay in the plan file.
      titleScore: titles.selectedScore,
      titleCandidates: titles.count,
      hookCandidates: hooks.candidateCount,
      topicScore: evaluation.score.VideoPotentialScore,
      popularityScore: topic.popularity ? topic.popularity.score : null,
      ctaStyle: cta.type,
      durationBucket: durationBucket(estimatedSeconds),
      openingVisual: first.First3SecondPlan ? first.First3SecondPlan.firstFrame.sourceClass : null,
      experimentVariant: experiment ? `${experiment.experiment_id}:${experiment.arm}` : null,
      factors: Object.fromEntries(Object.entries(evaluation.score.factors).map(([key, value]) => [key, value.value])),
      selectionMode: options.selection && options.selection.mode || null,
    },
  };
  plan.summary = summary(plan);
  if (options.write) Store.writeState(channel, "shorts", `${topic.slug}.json`, plan);
  return plan;
}

// Map Failure Reconstructed's existing final gate (quality-gate.js) into the
// readiness inputs so nothing is measured twice.
function externalFromLegacyGate(result) {
  if (!result || !result.bilesenler) return null;
  const b = result.bilesenler;
  return {
    visual: b.visual && !b.visual.olculmedi ? b.visual.puan : null,
    audio: b.audio && !b.audio.olculmedi ? b.audio.puan : null,
    visualCritical: b.visual && b.visual.kritik && !/CAPTION/i.test(b.visual.kritik) ? b.visual.kritik : null,
    captionCritical: b.visual && b.visual.kritik && /CAPTION/i.test(b.visual.kritik) ? b.visual.kritik : null,
    legacyDecision: result.karar,
    legacyScore: result.toplam,
  };
}

function summary(plan) {
  return {
    Channel: plan.channelName,
    "Content Type": "SHORT",
    Topic: plan.topic.title,
    "Topic Score": plan.topicScore.VideoPotentialScore,
    "Topic Bucket": plan.topicScore.bucket,
    "Selected Hook": plan.hooks.selected ? plan.hooks.selected.spoken : null,
    "Hook Type": plan.hooks.selected ? plan.hooks.selected.family : null,
    "Hook Score": plan.hooks.selected ? plan.hooks.selected.adjustedTotal : 0,
    "First-3-sec Score": plan.first3Seconds.score,
    Duration: plan.script.estimatedSeconds ? `~${plan.script.estimatedSeconds}s (estimated)` : null,
    Scenes: plan.pacing.segments,
    "Production Score": `${plan.readiness.ProductionReadinessScore} (${plan.readiness.stage}) → ${plan.readiness.decision}`,
    Experiment: plan.experiment ? `${plan.experiment.experiment_id}:${plan.experiment.arm}` : "none",
    "Related Long Video": plan.relatedLong ? `${plan.relatedLong.title} (${plan.relatedLong.type})` : "none yet",
  };
}

function printSummary(summaryObject, extra = {}) {
  const rows = { ...summaryObject, ...extra };
  const width = Math.max(...Object.keys(rows).map((key) => key.length));
  return Object.entries(rows).map(([key, value]) => `${(key + ":").padEnd(width + 2)}${value == null ? "—" : value}`).join("\n");
}

module.exports = {
  Config, Store, Model, Context, selectShortTopic, orderedQueue, gateMode, planShort, externalFromLegacyGate, summary, printSummary, durationBucket, optimizeEditorialOpening, applyLegacyOverlay, findTopic, decisionCandidate, writeDecision,
};
