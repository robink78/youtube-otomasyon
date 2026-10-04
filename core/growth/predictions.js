"use strict";

// PREDICTION vs OUTCOME — the inspectable half of the learning loop.
//
// At plan time the growth engine records its predictions on every video
// (topicScore / viralScore, hookScore, titleScore, readiness, popularity).
// After publication the analytics checkpoints give the outcome (growthScore,
// views, % viewed, subscriber conversion). This module joins them per channel
// and per format and reports:
//
//   • predictions.json        one row per measured video: predicted vs actual
//   • calibration             Spearman rank correlation per predictor — does a
//                             higher predicted score actually rank higher?
//   • topic-performance.json  topic families (clusters): count, predicted vs
//                             actual, views, retention, conversion, confidence,
//                             explore/exploit and fatigue signals
//
// Written to the channel's own growth state (core/growth/store.js); nothing
// is ever read from or written to another channel.

const Store = require("./store");

const PREDICTORS = ["topicScore", "viralScore", "hookScore", "titleScore", "readiness", "popularityScore"];
const MIN_CALIBRATION_SAMPLE = 5;

const finite = (value) => Number.isFinite(value) ? value : null;
const median = (values) => {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  return xs.length ? xs[Math.floor(xs.length / 2)] : null;
};
const mean = (values) => {
  const xs = values.filter(Number.isFinite);
  return xs.length ? Math.round(xs.reduce((sum, value) => sum + value, 0) / xs.length * 10) / 10 : null;
};

function rows(records) {
  return (records || []).filter((record) => record && record.videoId).map((record) => {
    const metrics = record.metrics || {};
    const performance = record.performance || {};
    return {
      videoId: record.videoId,
      slug: record.slug || null,
      contentType: record.contentType === "long" ? "long" : "short",
      cluster: record.topicCluster || null,
      publishAt: record.publishAt || null,
      predicted: Object.fromEntries(PREDICTORS.map((key) => [key, finite(record[key])])),
      outcome: {
        growthScore: finite(performance.growthScore),
        views: finite(metrics.views),
        averagePercentageViewed: finite(metrics.averagePercentageViewed),
        subscribersPer1000Views: finite(metrics.subscribersPer1000Views),
        checkpoint: record.latestCheckpoint || null,
      },
    };
  });
}

function ranks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const out = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].value === order[i].value) j += 1;
    const rank = (i + j) / 2 + 1;
    for (let k = i; k <= j; k += 1) out[order[k].index] = rank;
    i = j + 1;
  }
  return out;
}

function spearman(xs, ys) {
  if (xs.length < 2) return null;
  const rx = ranks(xs), ry = ranks(ys);
  const mx = rx.reduce((s, v) => s + v, 0) / rx.length, my = ry.reduce((s, v) => s + v, 0) / ry.length;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i += 1) { num += (rx[i] - mx) * (ry[i] - my); dx += (rx[i] - mx) ** 2; dy += (ry[i] - my) ** 2; }
  return dx && dy ? Math.round(num / Math.sqrt(dx * dy) * 100) / 100 : null;
}

// Per format and predictor: rank correlation with the measured growth score.
function calibration(predictionRows) {
  const out = {};
  for (const format of ["short", "long"]) {
    out[format] = {};
    const list = predictionRows.filter((row) => row.contentType === format && row.outcome.growthScore != null);
    for (const key of PREDICTORS) {
      const pairs = list.filter((row) => row.predicted[key] != null);
      const rho = pairs.length >= MIN_CALIBRATION_SAMPLE ? spearman(pairs.map((row) => row.predicted[key]), pairs.map((row) => row.outcome.growthScore)) : null;
      out[format][key] = { n: pairs.length, spearman: rho, status: pairs.length < MIN_CALIBRATION_SAMPLE ? "INSUFFICIENT_SAMPLE" : rho == null ? "NO_VARIANCE" : rho >= 0.3 ? "PREDICTIVE" : rho <= -0.3 ? "INVERTED" : "WEAK" };
    }
  }
  return out;
}

// Topic families: exploit = above-median growth with enough samples; explore =
// too few samples to judge; fatigue = the latest videos of the family fall
// below its own earlier median.
function topicPerformance(predictionRows, options = {}) {
  const minSample = options.minSample || 3;
  const out = [];
  for (const format of ["short", "long"]) {
    const list = predictionRows.filter((row) => row.contentType === format && row.cluster);
    const formatMedian = median(list.map((row) => row.outcome.growthScore));
    const clusters = [...new Set(list.map((row) => row.cluster))];
    for (const cluster of clusters) {
      const items = list.filter((row) => row.cluster === cluster).sort((a, b) => String(a.publishAt).localeCompare(String(b.publishAt)));
      const scores = items.map((row) => row.outcome.growthScore).filter(Number.isFinite);
      const actual = median(scores);
      const recent = scores.slice(-2), earlier = scores.slice(0, -2);
      const fatigue = earlier.length >= 2 && recent.length === 2 && Math.max(...recent) < median(earlier) * 0.8;
      out.push({
        contentType: format, cluster, publications: items.length, measured: scores.length,
        predictedTopicScore: mean(items.map((row) => row.predicted.topicScore ?? row.predicted.viralScore)),
        actualGrowthScore: actual,
        medianViews: median(items.map((row) => row.outcome.views)),
        medianAveragePercentageViewed: median(items.map((row) => row.outcome.averagePercentageViewed)),
        medianSubscribersPer1000Views: median(items.map((row) => row.outcome.subscribersPer1000Views)),
        confidence: scores.length >= 10 ? "medium" : scores.length >= minSample ? "low" : "insufficient",
        mode: scores.length < minSample ? "explore" : actual != null && formatMedian != null && actual >= formatMedian ? "exploit" : "deprioritise",
        fatigue,
      });
    }
  }
  return out.sort((a, b) => (b.actualGrowthScore ?? -1) - (a.actualGrowthScore ?? -1));
}

function refresh(channel, records, options = {}) {
  const predictionRows = rows(records);
  const result = { channel: channel.slug, updatedAt: (options.now || new Date()).toISOString(), calibration: calibration(predictionRows), rows: predictionRows };
  const families = { channel: channel.slug, updatedAt: result.updatedAt, families: topicPerformance(predictionRows) };
  if (options.write !== false) {
    Store.writeState(channel, "growth", "predictions.json", result);
    Store.writeState(channel, "growth", "topic-performance.json", families);
  }
  return { ...result, families: families.families };
}

module.exports = { PREDICTORS, MIN_CALIBRATION_SAMPLE, rows, spearman, calibration, topicPerformance, refresh };
