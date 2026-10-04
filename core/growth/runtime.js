"use strict";

// Runtime glue between the existing pipelines and the growth engine. Every
// function here is failure-tolerant: a growth bookkeeping error is logged and
// never breaks a render, an upload or TikTok.

const fs = require("fs");
const WeeklyLearning = require("./weekly-learning");
const path = require("path");
const Store = require("./store");
const Analytics = require("./analytics");
const Funnel = require("./funnel");
const Experiments = require("./experiments");
const Growth = require("./index");

function safe(label, fn, fallback = null) {
  try { return fn(); } catch (error) { console.log(`  (growth ${label}: ${error.message})`); return fallback; }
}

function alert(channel, code, message, details = {}) {
  return safe("alert", () => {
    const rows = Store.readState(channel, "growth", "alerts.json", []);
    const today = new Date().toISOString().slice(0, 10);
    if (rows.some((row) => row.code === code && row.date === today && row.message === message)) return rows;
    rows.push({ channel: channel.slug, code, message, details, date: today, at: new Date().toISOString() });
    Store.writeState(channel, "growth", "alerts.json", rows.slice(-200));
    return rows;
  });
}

function publishedRow(channel, slug) {
  const legacy = channel.config.pathMode === "legacy-adapter";
  const file = path.join(channel.paths.state, legacy ? "yayinlananlar.json" : "published.json");
  try { return JSON.parse(fs.readFileSync(file, "utf8")).filter((row) => row.slug === slug && (!row.channel || row.channel === channel.slug)).pop() || null; } catch (error) { return null; }
}

// After a successful upload: register growth metadata for analytics/learning,
// attach the experiment arm, record cluster membership and the Short→Long
// relationship (+ manual Related Video task when a long-form exists).
function afterUpload(channel, slug, plan) {
  return safe("afterUpload", () => {
    const row = publishedRow(channel, slug);
    if (!row || !row.videoId) return null;
    Analytics.registerVideo(channel, {
      ...(plan ? plan.growthMeta : {}), videoId: row.videoId, slug, channel: channel.slug, contentType: "short",
      title: row.baslik || (plan && plan.titles.selected && plan.titles.selected.title) || null, publishAt: row.publishAt || row.tarih || null,
      publishHourUTC: row.publishAt ? new Date(row.publishAt).getUTCHours() : null,
      // Learning dimensions for the two 2026-10-02 changes: the US-evening
      // publish slot and Wikipedia-measured topic recognition.
      publishSlot: WeeklyLearning.publishSlot(row.publishAt || null),
      popularityBand: WeeklyLearning.popularityBand(plan && plan.topic && plan.topic.popularity ? plan.topic.popularity.score : null),
      readiness: plan ? plan.readiness.ProductionReadinessScore : null,
    });
    // Growth-engine decision trail (inspectable next to the prediction ledger).
    try {
      require("../../lib/ops-log").event(channel, "growth.decision", { slug, videoId: row.videoId, bucket: plan && plan.growthMeta.bucket, cluster: plan && plan.growthMeta.topicCluster,
        hookType: plan && plan.growthMeta.hookType, titlePattern: plan && plan.growthMeta.titlePattern, topicScore: plan && plan.growthMeta.topicScore,
        hookScore: plan && plan.growthMeta.hookScore, titleScore: plan && plan.growthMeta.titleScore, experiment: plan && plan.growthMeta.experimentVariant || null });
    } catch (error) {}
    if (plan && plan.experiment) Experiments.attachVideo(channel, slug, row.videoId);
    if (plan) Funnel.updateCluster(channel, plan.topic.cluster || "uncategorized", { type: "short", slug, videoId: row.videoId, title: row.baslik, channel: channel.slug });
    if (plan && plan.relatedLong && plan.relatedLong.videoId) {
      Funnel.linkShortToLong(channel, { slug, videoId: row.videoId, cluster: plan.topic.cluster, channel: channel.slug },
        { slug: plan.relatedLong.slug, videoId: plan.relatedLong.videoId, title: plan.relatedLong.title, channel: channel.slug },
        { type: plan.relatedLong.type, reason: plan.relatedLong.reason, score: plan.relatedLong.score });
      console.log(`RELATED_VIDEO_MANUAL_ACTION_REQUIRED channel=${channel.slug} short_video_id=${row.videoId} target_long_video_id=${plan.relatedLong.videoId} target_long_video_title="${plan.relatedLong.title}"`);
    }
    return row.videoId;
  });
}

function shortSummary(plan, extra = {}) {
  if (!plan) return "";
  return "\n=== GROWTH RUN SUMMARY ===\n" + Growth.printSummary(plan.summary, extra) + "\n";
}

// Failure Reconstructed (legacy pipeline) — plan + gate by slug.
function planLegacy(channel, slug, options = {}) {
  return Growth.planShort(channel, slug, { skipDuplicate: true, ...options });
}

// ANALYTICS PASS (PHASE 16/18/19/20): checkpoints 1h…30d, per-channel and
// per-content-type baselines, diagnosis at 24h/7d(+), learning, experiments.
// `measure(video)` is lib/analitik.topla bound to the caller's API client.
async function analyticsPass(channel, videos, measure, options = {}) {
  const Config = require("./config");
  const Diagnosis = require("./diagnosis");
  const Learning = require("./learning");
  const Performance = require("./performance");
  const config = Config.forChannel(channel);
  const now = options.now || new Date();
  const rows = Analytics.readAll(channel);
  const ctx = require("./context").build(channel, { performanceRows: rows.filter((row) => row.contentType === "short") });
  const results = [];
  for (const video of videos) {
    if (!video || !video.status || video.status.privacyStatus !== "public") continue;
    const existing = rows.find((row) => row.videoId === video.id);
    const done = existing ? Object.keys(existing.checkpoints || {}) : [];
    const label = Analytics.dueCheckpoint(video.snippet.publishedAt, now, done, config);
    if (!label) continue;
    const measurement = await measure(video);
    const publication = ctx.history.published.find((item) => item.videoId === video.id) || {};
    const topic = ctx.inventory.find((item) => item.slug === publication.slug || item.id === publication.topicId);
    Analytics.registerVideo(channel, { ...(existing || {}), videoId: video.id, channel: channel.slug, contentType: measurement.format === "long" ? "long" : "short", slug: publication.slug || existing && existing.slug || null, topicCluster: topic && topic.cluster || existing && existing.topicCluster || null, title: video.snippet.title, publishAt: video.snippet.publishedAt, durationSeconds: measurement.sureSn || existing && existing.durationSeconds, registeredBy: existing && existing.registeredBy || "analytics-pass" });
    const row = Analytics.recordCheckpoint(channel, video.id, label, measurement);
    results.push({ videoId: video.id, label, row });
  }
  const all = Performance.refresh(channel, Analytics.readAll(channel));
  const baselines = Analytics.baselines(channel, all);
  const diagnoses = Store.readState(channel, "growth", "diagnoses.json", []);
  for (const { videoId, label } of results) {
    if (!config.diagnosis.checkpoints.includes(label)) continue;
    const row = all.find((item) => item.videoId === videoId);
    if (!row) continue;
    const diagnosis = Diagnosis.diagnose(row, baselines, config, { checkpoint: label });
    if (row.performance && row.performance.plateau) diagnosis.diagnoses.unshift({ code: "EARLY_DISTRIBUTION_PLATEAU", confidence: "medium", evidence: `${row.performance.plateau.earlyViews} → ${row.performance.plateau.latestViews} views; later/early velocity ${row.performance.plateau.velocityRatio}`, recommendation: "Treat listed causes as hypotheses; change one opening, duration or topic variable on a future upload." });
    if (row.performance && row.performance.breakout) diagnosis.diagnoses.unshift({ code: "BREAKOUT", confidence: baselines.short.n >= 10 ? "medium" : "low", evidence: row.performance.breakout.signals.join("; "), recommendation: "Nominate adjacent same-cluster topics without duplicating this event." });
    for (const item of diagnosis.diagnoses) item.specCode = item.specCode || Diagnosis.specCode(item.code);
    diagnoses.push({ ...diagnosis, at: now.toISOString() });
    console.log(analyticsSummary(channel, row, diagnosis));
  }
  Store.writeState(channel, "growth", "diagnoses.json", diagnoses.slice(-500));
  const learning = Learning.learn(channel, all, { now });
  Experiments.evaluate(channel, all);
  // Prediction vs outcome + topic-family ledger (inspectable learning).
  try { require("./predictions").refresh(channel, all, { now }); } catch (error) {}
  return { measured: results.length, baselines, learning: { shorts: learning.shorts.status, longform: learning.longform.status } };
}

function analyticsSummary(channel, row, diagnosis) {
  const m = row.metrics || {};
  const top = diagnosis.diagnoses[0] || {};
  const Growth = require("./index");
  return "\n=== GROWTH ANALYTICS ===\n" + Growth.printSummary({
    Channel: channel.name, "Content Type": row.contentType === "long" ? "LONG_FORM" : "SHORT", Checkpoint: diagnosis.checkpoint,
    Views: m.views, "Avg view duration": m.averageViewDuration != null ? m.averageViewDuration + " s" : "unavailable",
    "Avg % viewed": m.averagePercentageViewed ?? "unavailable", "Watch Time": row.checkpoints[row.latestCheckpoint].metrics.watch_time_minutes.value != null ? row.checkpoints[row.latestCheckpoint].metrics.watch_time_minutes.value + " min" : "unavailable",
    Engagement: m.engagementPer1000Views != null ? m.engagementPer1000Views + " / 1k views" : "unavailable",
    "Subscribers gained": row.checkpoints[row.latestCheckpoint].metrics.subscribers_gained.value ?? "unavailable",
    Diagnosis: diagnosis.diagnoses.map((item) => item.code).join(", "), Confidence: top.confidence, Recommendation: top.recommendation,
  });
}

module.exports = { safe, alert, afterUpload, shortSummary, planLegacy, publishedRow, analyticsPass, analyticsSummary };
