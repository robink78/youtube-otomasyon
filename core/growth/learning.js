"use strict";

// CHANNEL-ISOLATED LEARNING (PHASE 17/18/32Q).
//
// One file per channel: channels/<slug>/memory/growth-learning.json
//   { shorts: {...}, longform: {...} }
// Shorts learn only from Short records, long-form only from long-form records,
// and a channel only from its own records. Knowledge moves through three
// stages so a handful of videos can never rewrite strategy:
//   OBSERVATION       n ≥ minimumSampleObservation — reported, not used
//   HYPOTHESIS        n ≥ minimumSampleHypothesis and |lift| ≥ minimumLift
//   ADOPTED_LEARNING  n ≥ minimumSampleAdopt, lift ≥ minimumLift and the
//                     difference is ≥ 2 standard errors — only these nudge
//                     scoring, and only within maxWeightShift.

const Config = require("./config");
const Store = require("./store");

const DIMENSIONS = {
  shorts: ["hookType", "topicCluster", "durationBucket", "titlePattern", "storyStructure", "ctaStyle", "publishHourUTC", "publishSlot", "popularityBand", "openingVisual", "bucket", "experimentVariant"],
  longform: ["topicCluster", "durationBucket", "titlePattern", "thumbnailPattern", "coldOpenType", "storyStructure", "publishDay", "sourceDepthBucket", "sceneDensityBucket", "endScreenPath", "seriesRelationship"],
};

const FILE = "growth-learning.json";

function empty(channel) {
  const block = () => ({ sampleSize: 0, baselines: {}, observations: [], hypotheses: [], adopted: [], suppressed: [], adoptedWeights: {}, adoptedHookFamilyBonus: {}, adoptedTitlePatternBonus: {}, adoptedClusterBonus: {}, adoptedDurationBucketBonus: {} });
  return { channel: channel.slug, updatedAt: null, shorts: block(), longform: block() };
}

function read(channel) {
  const value = Store.readState(channel, "memory", FILE, null);
  if (!value) return empty(channel);
  if (value.channel && value.channel !== channel.slug) throw new Error(`LEARNING_ISOLATION_VIOLATION: ${FILE} for ${channel.slug} contains ${value.channel}`);
  return value;
}

const mean = (values) => values.reduce((sum, value) => sum + value, 0) / (values.length || 1);
function sd(values) {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - m) ** 2, 0) / (values.length - 1));
}

// Primary outcome per content type. Shorts: retention and subscriber
// conversion relative to the channel's own Short baseline. Long-form: watch
// time per view and subscribers per 1,000 views relative to its own baseline.
function outcome(record, baselines, contentType) {
  const metrics = record.metrics || {};
  if (record.performance && Number.isFinite(record.performance.growthScore)) return record.performance.growthScore / 50;
  const parts = [];
  const rel = (value, base) => Number.isFinite(value) && Number.isFinite(base) && base > 0 ? value / base : null;
  if (contentType === "shorts") {
    parts.push([rel(metrics.averagePercentageViewed, baselines.averagePercentageViewed), 0.25]);
    parts.push([rel(metrics.subscribersPer1000Views, baselines.subscribersPer1000Views), 0.35]);
    parts.push([rel(metrics.engagementPer1000Views, baselines.engagementPer1000Views), 0.15]);
    parts.push([rel(metrics.views, baselines.views), 0.25]);
  } else {
    parts.push([rel(metrics.watchHoursPer1000Views, baselines.watchHoursPer1000Views), 0.35]);
    parts.push([rel(metrics.averagePercentageViewed, baselines.averagePercentageViewed), 0.25]);
    parts.push([rel(metrics.subscribersPer1000Views, baselines.subscribersPer1000Views), 0.4]);
  }
  const usable = parts.filter(([value]) => value != null);
  const total = usable.reduce((sum, [, weight]) => sum + weight, 0);
  return usable.length ? usable.reduce((sum, [value, weight]) => sum + value * weight, 0) / total : null;
}

function baselinesFor(records) {
  const pick = (key) => {
    const values = records.map((record) => (record.metrics || {})[key]).filter(Number.isFinite).sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : null;
  };
  return {
    views: pick("views"), averagePercentageViewed: pick("averagePercentageViewed"), subscribersPer1000Views: pick("subscribersPer1000Views"),
    watchHoursPer1000Views: pick("watchHoursPer1000Views"), engagementPer1000Views: pick("engagementPer1000Views"),
  };
}

function learnBlock(records, contentType, config) {
  const rules = config.learning;
  const baselines = baselinesFor(records);
  const scored = records.map((record) => ({ record, y: outcome(record, baselines, contentType) })).filter((row) => row.y != null);
  const overall = mean(scored.map((row) => row.y));
  const observations = [];
  const hypotheses = [];
  const adopted = [];
  const suppressed = [];
  for (const dimension of DIMENSIONS[contentType]) {
    const groups = new Map();
    for (const row of scored) {
      const value = row.record[dimension];
      if (value == null || value === "") continue;
      if (!groups.has(value)) groups.set(value, []);
      groups.get(value).push(row.y);
    }
    for (const [value, ys] of groups) {
      if (ys.length < rules.minimumSampleObservation) continue;
      const lift = overall ? mean(ys) / overall - 1 : 0;
      const standardError = ys.length > 1 ? sd(ys) / Math.sqrt(ys.length) : Infinity;
      const z = standardError > 0 && Number.isFinite(standardError) ? (mean(ys) - overall) / standardError : 0;
      const row = { stage: "OBSERVATION", dimension, value: String(value), sample: ys.length, lift: Math.round(lift * 1000) / 1000, z: Math.round(z * 100) / 100 };
      observations.push(row);
      if (ys.length >= rules.minimumSampleHypothesis && Math.abs(lift) >= rules.minimumLift) hypotheses.push({ ...row, stage: "HYPOTHESIS" });
      if (ys.length >= rules.minimumSampleAdopt && lift >= rules.minimumLift && z >= 2) adopted.push({ ...row, stage: "ADOPTED_LEARNING" });
      if (ys.length >= rules.minimumSampleAdopt && lift <= -rules.minimumLift && z <= -2) suppressed.push({ ...row, stage: "SUPPRESSED_PATTERN" });
    }
  }
  // Adaptive weighting: correlate topic factors with the outcome, only once
  // the adopt sample floor is met; bounded by maxWeightShift.
  const adoptedWeights = {};
  if (scored.length >= rules.minimumSampleAdopt) {
    const keys = new Set(scored.flatMap((row) => Object.keys(row.record.factors || {})));
    for (const key of keys) {
      const pairs = scored.map((row) => [row.record.factors && row.record.factors[key], row.y]).filter(([x]) => Number.isFinite(x));
      if (pairs.length < rules.minimumSampleAdopt) continue;
      const xs = pairs.map((pair) => pair[0]);
      const ys = pairs.map((pair) => pair[1]);
      const sx = sd(xs), sy = sd(ys);
      if (!sx || !sy) continue;
      const mx = mean(xs), my = mean(ys);
      const r = pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0) / ((pairs.length - 1) * sx * sy);
      if (Math.abs(r) < 0.2) continue;
      adoptedWeights[key] = Math.round((1 + Math.max(-rules.maxWeightShift, Math.min(rules.maxWeightShift, r * 0.5))) * 1000) / 1000;
    }
  }
  const adoptedHookFamilyBonus = {};
  const adoptedTitlePatternBonus = {};
  const adoptedClusterBonus = {};
  const adoptedDurationBucketBonus = {};
  const bonus = (row) => Math.max(-8, Math.min(8, Math.round(row.lift * 20)));
  for (const row of [...adopted, ...suppressed]) {
    if (row.dimension === "hookType") adoptedHookFamilyBonus[row.value] = bonus(row);
    if (row.dimension === "titlePattern") adoptedTitlePatternBonus[row.value] = bonus(row);
    if (row.dimension === "topicCluster") adoptedClusterBonus[row.value] = bonus(row);
    if (row.dimension === "durationBucket") adoptedDurationBucketBonus[row.value] = bonus(row);
  }
  return {
    sampleSize: scored.length,
    status: scored.length >= rules.minimumSampleAdopt ? "adaptive" : scored.length >= rules.minimumSampleObservation ? "observing" : "heuristics-only",
    baselines,
    observations,
    hypotheses,
    adopted,
    suppressed,
    adoptedWeights,
    adoptedHookFamilyBonus,
    adoptedTitlePatternBonus,
    adoptedClusterBonus,
    adoptedDurationBucketBonus,
  };
}

function learn(channel, records, options = {}) {
  const config = Config.forChannel(channel);
  for (const record of records || []) Store.assertSameChannel(channel, record, "performance record " + (record.videoId || ""));
  const own = (records || []).filter((record) => record.channel === channel.slug);
  const shorts = own.filter((record) => record.contentType === "short");
  const longform = own.filter((record) => record.contentType === "long");
  const value = {
    channel: channel.slug,
    updatedAt: (options.now || new Date()).toISOString(),
    caveat: "Associations within this channel only. Topic, timing and packaging confound each other; adopted learning nudges heuristics, it never proves causation.",
    shorts: learnBlock(shorts, "shorts", config),
    longform: learnBlock(longform, "longform", config),
  };
  if (options.write !== false) Store.writeState(channel, "memory", FILE, value);
  return value;
}

module.exports = { DIMENSIONS, FILE, read, learn, learnBlock, outcome, baselinesFor, empty };
