"use strict";

// CHANNEL-AWARE EXPERIMENTS (PHASE 20).
// channels/<slug>/memory/growth-experiments.json
// One variable per experiment, at most maxActivePerContentType running per
// channel+content type, deterministic arm assignment (reruns are idempotent),
// and assignment happens BEFORE production — an experiment never causes a
// second upload of the same video.

const Config = require("./config");
const Store = require("./store");
const Engagement = require("./engagement");

const FILE = "growth-experiments.json";
const VARIABLES = {
  short: ["hook_style", "duration", "caption_density", "opening_visual", "narration_speed", "cta_vs_no_cta", "story_structure", "title_structure", "short_cta_to_longform"],
  long: ["thumbnail_style", "title_structure", "cold_open", "end_screen_pathway", "duration", "story_structure"],
};

function load(channel) {
  const value = Store.readState(channel, "memory", FILE, null) || { channel: channel.slug, experiments: [] };
  if (value.channel !== channel.slug) throw new Error(`EXPERIMENT_ISOLATION_VIOLATION: ${FILE} for ${channel.slug} contains ${value.channel}`);
  return value;
}

function save(channel, value) { return Store.writeState(channel, "memory", FILE, value); }

function create(channel, spec, options = {}) {
  const config = Config.forChannel(channel);
  const contentType = spec.contentType === "long" ? "long" : "short";
  const variables = Array.isArray(spec.variable) ? spec.variable : [spec.variable];
  if (variables.length > config.experiments.maxVariablesPerExperiment) throw new Error("EXPERIMENT_REJECTED: change one variable at a time");
  if (!VARIABLES[contentType].includes(variables[0])) throw new Error(`EXPERIMENT_REJECTED: unknown ${contentType} variable ${variables[0]}`);
  const value = load(channel);
  const active = value.experiments.filter((item) => item.status === "RUNNING" && item.content_type === contentType);
  if (active.length >= config.experiments.maxActivePerContentType) throw new Error(`EXPERIMENT_REJECTED: ${active[0].experiment_id} is already running for ${contentType}`);
  const startedAt = (options.now || new Date()).toISOString();
  const row = {
    experiment_id: spec.id || `${channel.slug}-${contentType}-${variables[0]}-${startedAt.slice(0, 10)}`,
    channel: channel.slug,
    content_type: contentType,
    hypothesis: spec.hypothesis,
    variable: variables[0],
    control: spec.control,
    variant: spec.variant,
    sample: { control: [], variant: [] },
    metric: spec.metric,
    minimum_per_arm: config.experiments.minimumPerArm,
    result: null,
    confidence: "INSUFFICIENT_DATA",
    status: "RUNNING",
    created_at: startedAt,
    start_time: startedAt,
    notes: spec.notes || null,
  };
  value.experiments.push(row);
  if (options.write !== false) save(channel, value);
  return row;
}

function assign(channel, contentType, videoKey, options = {}) {
  const value = load(channel);
  const running = value.experiments.find((item) => item.status === "RUNNING" && item.content_type === contentType);
  if (!running) return null;
  const already = ["control", "variant"].find((arm) => running.sample[arm].some((item) => item.key === videoKey));
  if (already) return { experiment_id: running.experiment_id, arm: already, variable: running.variable, value: running[already] };
  const arm = Engagement.hash01(`${running.experiment_id}:${videoKey}`) < 0.5 ? "control" : "variant";
  running.sample[arm].push({ key: videoKey, videoId: null, assignedAt: (options.now || new Date()).toISOString() });
  if (options.write !== false) save(channel, value);
  return { experiment_id: running.experiment_id, arm, variable: running.variable, value: running[arm] };
}

function attachVideo(channel, videoKey, videoId, options = {}) {
  const value = load(channel);
  for (const experiment of value.experiments) for (const arm of ["control", "variant"]) for (const item of experiment.sample[arm]) if (item.key === videoKey) item.videoId = videoId;
  if (options.write !== false) save(channel, value);
}

// Evaluate with this channel's own performance records only.
function evaluate(channel, records, options = {}) {
  const value = load(channel);
  const byVideo = new Map(records.filter((record) => record.channel === channel.slug).map((record) => [record.videoId, record]));
  for (const experiment of value.experiments.filter((item) => item.status === "RUNNING")) {
    const metric = (arm) => experiment.sample[arm].map((item) => byVideo.get(item.videoId)).filter(Boolean)
      .map((record) => (record.metrics || {})[experiment.metric]).filter(Number.isFinite);
    const control = metric("control");
    const variant = metric("variant");
    if (control.length < experiment.minimum_per_arm || variant.length < experiment.minimum_per_arm) {
      experiment.result = { control: control.length, variant: variant.length, note: "insufficient data" };
      experiment.confidence = "INSUFFICIENT_DATA";
      continue;
    }
    const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const variance = (xs) => xs.reduce((a, b) => a + (b - mean(xs)) ** 2, 0) / (xs.length - 1);
    const se = Math.sqrt(variance(control) / control.length + variance(variant) / variant.length) || Infinity;
    const z = (mean(variant) - mean(control)) / se;
    experiment.result = { controlMean: mean(control), variantMean: mean(variant), lift: mean(control) ? mean(variant) / mean(control) - 1 : null, z: Math.round(z * 100) / 100, n: [control.length, variant.length] };
    experiment.confidence = Math.abs(z) >= 2 ? "CONSISTENT_WITH_HYPOTHESIS" : "INCONCLUSIVE";
    if (options.close && Math.abs(z) >= 2) experiment.status = "COMPLETE";
  }
  if (options.write !== false) save(channel, value);
  return value;
}

module.exports = { FILE, VARIABLES, load, create, assign, attachVideo, evaluate };
