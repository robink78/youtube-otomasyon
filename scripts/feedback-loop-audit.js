#!/usr/bin/env node
"use strict";

// Read-only audit of the growth feedback loop. It deliberately separates
// architecture health from sample-size/data-availability health so a small
// channel is not misclassified as broken merely because it has few views.

const fs = require("fs");
const path = require("path");
const Channel = require("../core/channel-context");
const Store = require("../core/growth/store");
const Config = require("../core/growth/config");
const Context = require("../core/growth/context");
const Performance = require("../core/growth/performance");

const CHANNELS = ["failure-reconstructed", "impossible-brief", "critical-thread", "behind-the-ordinary"];

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function publications(channel) {
  const legacy = channel.config.pathMode === "legacy-adapter";
  const file = path.join(channel.paths.state, legacy ? "yayinlananlar.json" : "published.json");
  const rows = readJson(file, []);
  return (Array.isArray(rows) ? rows : []).filter((row) => row && row.videoId && (!row.channel || row.channel === channel.slug));
}

function metricCoverage(rows, key) {
  const eligible = rows.filter((row) => row.contentType === "short" && row.metrics);
  const n = eligible.filter((row) => Number.isFinite(row.metrics[key])).length;
  return { available: n, total: eligible.length, ratio: eligible.length ? Math.round(n / eligible.length * 1000) / 1000 : null };
}

function auditChannel(slug) {
  const channel = Channel.getChannel(slug);
  const config = Config.forChannel(channel);
  const rows = Store.readState(channel, "growth", "performance.json", []);
  const learning = Store.readState(channel, "memory", "growth-learning.json", null);
  const diagnoses = Store.readState(channel, "growth", "diagnoses.json", []);
  const published = publications(channel);

  const drift = [];
  for (const row of rows) {
    for (const point of Performance.checkpointSeries(row)) {
      if (Number.isFinite(point.checkpointDriftHours) && Math.abs(point.checkpointDriftHours) > 2.5) {
        drift.push({ videoId: row.videoId, label: point.label, scheduledHours: point.scheduledHours, collectedAgeHours: point.collectedAgeHours, driftHours: point.checkpointDriftHours });
      }
    }
  }

  // Prove that channel-isolated adopted memory is wired back into selection.
  const learned = learning && learning.shorts || {};
  const syntheticHistory = { published: [], generated: [], blocked: [], failed: [], used: new Set(), publishedTitles: [] };
  const ctx = Context.build(channel, { inventory: [], performanceRows: [], history: syntheticHistory, learning: learning || { shorts: {} } });
  const consumerWiring =
    JSON.stringify(ctx.learnedWeights || {}) === JSON.stringify(learned.adoptedWeights || {}) &&
    JSON.stringify(ctx.learnedFamilyBonus || {}) === JSON.stringify(learned.adoptedHookFamilyBonus || {}) &&
    JSON.stringify(ctx.learnedTitlePatternBonus || {}) === JSON.stringify(learned.adoptedTitlePatternBonus || {}) &&
    JSON.stringify(ctx.learnedClusterBonus || {}) === JSON.stringify(learned.adoptedClusterBonus || {});

  const latestLearningAt = learning && learning.updatedAt || null;
  const shorts = learning && learning.shorts || { sampleSize: 0, status: "missing" };
  const hardBroken = published.length > 0 && rows.length === 0;
  const architectureHealthy = !hardBroken && !!learning && consumerWiring;
  const state = hardBroken ? "BROKEN" : architectureHealthy ? "CLOSED_LOOP_WORKING" : "PARTIAL_LOOP";

  return {
    channel: slug,
    verdict: state,
    mode: shorts.status || "missing",
    publishedVideos: published.length,
    performanceRows: rows.length,
    diagnosisRows: diagnoses.length,
    learning: {
      updatedAt: latestLearningAt,
      sampleSize: shorts.sampleSize || 0,
      status: shorts.status || "missing",
      observations: (shorts.observations || []).length,
      hypotheses: (shorts.hypotheses || []).length,
      adopted: (shorts.adopted || []).length,
      suppressed: (shorts.suppressed || []).length,
    },
    metricCoverage: {
      views: metricCoverage(rows, "views"),
      retention: metricCoverage(rows, "averagePercentageViewed"),
      subscribersPer1000: metricCoverage(rows, "subscribersPer1000Views"),
      engagement: metricCoverage(rows, "engagementPer1000Views"),
    },
    checkpointSchedule: config.analytics.checkpointLabels.map((label, i) => ({ label, hours: config.analytics.checkpointsHours[i] })),
    timing: {
      lateCheckpointCount: drift.length,
      note: drift.length ? "Historical late collections are retained for audit, but performance math uses their real collection age." : "No material checkpoint drift found.",
      examples: drift.slice(-10),
    },
    consumerWiring,
    caveat: shorts.sampleSize < config.learning.minimumSampleAdopt
      ? `Small-sample safety active: strategy is not allowed to adopt learned bonuses before ${config.learning.minimumSampleAdopt} usable Shorts.`
      : "Adoption sample floor reached; only statistically qualified patterns can nudge scoring.",
  };
}

function markdown(report) {
  const lines = [
    "# Growth Feedback Loop Health",
    "",
    `Generated: ${report.generatedAt}`,
    `Portfolio verdict: **${report.verdict}**`,
    "",
    "| Channel | Verdict | Mode | Samples | Performance rows | Diagnoses | Late checkpoints |",
    "|---|---|---|---:|---:|---:|---:|",
  ];
  for (const row of report.channels) lines.push(`| ${row.channel} | ${row.verdict} | ${row.mode} | ${row.learning.sampleSize} | ${row.performanceRows} | ${row.diagnosisRows} | ${row.timing.lateCheckpointCount} |`);
  lines.push("", "## Interpretation", "",
    "- `CLOSED_LOOP_WORKING` means measurements are persisted, learning memory exists, and adopted memory is wired back into topic/hook/title selection.",
    "- `heuristics-only` / `observing` is not a failure. It means the channel deliberately has too little evidence to rewrite strategy.",
    "- Late historical checkpoints are not deleted. Performance math uses actual collection age when drift exceeds 2.5 hours, preventing false velocity/plateau conclusions.",
    "- Studio-only metrics such as Viewed vs Swiped Away still require manual/Studio data; the public API cannot supply them.", "");
  return lines.join("\n");
}

function main() {
  const channels = CHANNELS.map(auditChannel);
  const verdict = channels.some((row) => row.verdict === "BROKEN") ? "BROKEN"
    : channels.some((row) => row.verdict === "PARTIAL_LOOP") ? "PARTIAL_LOOP"
      : "CLOSED_LOOP_WORKING";
  const report = { schema: "feedback-loop-health/1", generatedAt: new Date().toISOString(), verdict, channels };
  const dir = path.join(Channel.ROOT, "reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "feedback-loop-health.json"), JSON.stringify(report, null, 2) + "\n");
  fs.writeFileSync(path.join(dir, "feedback-loop-health.md"), markdown(report) + "\n");
  console.log(JSON.stringify(report, null, 2));
  if (verdict === "BROKEN") process.exitCode = 2;
  return report;
}

if (require.main === module) main();
module.exports = { auditChannel, metricCoverage, markdown, main };
