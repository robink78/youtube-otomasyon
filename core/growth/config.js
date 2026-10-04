"use strict";

// Growth-engine configuration: shared defaults (config/growth-engine.json)
// deep-merged with one channel's overrides (channels/<slug>/growth-engine.json).
// A channel never reads another channel's overrides.

const fs = require("fs");
const path = require("path");
const Channel = require("../channel-context");

const DEFAULTS_PATH = path.join(Channel.ROOT, "config", "growth-engine.json");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, override) {
  if (!isPlainObject(base)) return override === undefined ? base : override;
  const out = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (key.startsWith("_")) continue;
    out[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return out;
}

function channelOverridePath(channel) {
  return path.join(channel.paths.base, "growth-engine.json");
}

const cache = new Map();

function validate(config) {
  const fail = (message) => { throw new Error(`INVALID_GROWTH_CONFIG: ${message}`); };
  // An evidence-gated channel (only researched records are eligible) may run
  // a smaller pool; every other channel keeps the 20-topic minimum.
  const poolFloor = config.candidatePool && config.candidatePool.evidenceGated === true ? 1 : 20;
  if (!config.candidatePool || config.candidatePool.minimum < poolFloor || config.candidatePool.target < config.candidatePool.minimum || config.candidatePool.target > 50) fail("candidatePool must select 20–50 topics (evidence-gated channels: 1–50)");
  if (Math.abs(config.candidatePool.videoPotentialWeight + config.candidatePool.viralPotentialWeight - 1) > 1e-9) fail("candidatePool scoring weights must equal 1");
  const exploit = config.selection && config.selection.exploitRatio;
  const explore = config.selection && config.selection.exploreRatio;
  if (![exploit, explore].every((value) => Number.isFinite(value) && value >= 0) || Math.abs(exploit + explore - 1) > 1e-9) fail("exploitRatio + exploreRatio must equal 1");
  if (config.hooks.minimumCandidates < 10) fail("hooks.minimumCandidates must be at least 10");
  if (config.titles.shorts.minimumCandidates < 5) fail("titles.shorts.minimumCandidates must be at least 5");
  if (!config.performance || config.performance.growthScoreWeights.subscriberConversion < config.performance.growthScoreWeights.views) fail("subscriber conversion must have meaningful growth-score weight");
  const buckets = config.script.shorts.durationBuckets || [];
  if (buckets.length !== 4 || buckets.some((bucket, index) => !(bucket.min <= bucket.max) || (index && bucket.min <= buckets[index - 1].max))) fail("Short duration buckets must be four ordered, non-overlapping ranges");
  return config;
}

function forChannel(channel = Channel.getChannel()) {
  const key = channel.slug;
  if (cache.has(key)) return cache.get(key);
  const defaults = readJson(DEFAULTS_PATH, null);
  if (!defaults) throw new Error("Missing growth-engine defaults: config/growth-engine.json");
  const override = readJson(channelOverridePath(channel), {});
  const merged = deepMerge(defaults, override);
  merged.channel = channel.slug;
  // Channel config remains the single source for cadence and quality floors.
  const cadence = channel.config.publishingCadence || {};
  if (cadence.longForm && cadence.longForm.everyDays) merged.longform.cadenceDays = cadence.longForm.everyDays;
  if (cadence.shorts && cadence.shorts.targetDurationSeconds) merged.shortsDurationSeconds = cadence.shorts.targetDurationSeconds;
  validate(merged);
  const frozen = Object.freeze(merged);
  cache.set(key, frozen);
  return frozen;
}

function clearCache() { cache.clear(); }

module.exports = { DEFAULTS_PATH, deepMerge, validate, forChannel, channelOverridePath, clearCache, readJson };
