"use strict";

// Age-normalised performance, channel-relative percentiles, growth scoring,
// 1K–2K plateau detection and breakout detection. This module never invents a
// missing metric: unavailable inputs are excluded and listed in `missing`.

const Store = require("./store");
const Config = require("./config");

const clamp = (value, low = 0, high = 100) => Math.max(low, Math.min(high, value));
const round = (value, places = 2) => Number.isFinite(value) ? Math.round(value * 10 ** places) / 10 ** places : null;

function labelHours(label) {
  const value = String(label || "").toLowerCase();
  const hours = value.match(/^(\d+(?:\.\d+)?)h$/);
  if (hours) return +hours[1];
  const days = value.match(/^(\d+(?:\.\d+)?)d$/);
  if (days) return +days[1] * 24;
  return null;
}

function metricValue(snapshot, key) {
  const metric = snapshot && snapshot.metrics && snapshot.metrics[key];
  return metric && Number.isFinite(metric.value) ? metric.value : null;
}

function flatSnapshot(snapshot) {
  if (!snapshot) return {};
  const legacySubscriberMetric = snapshot.metrics && snapshot.metrics.subscribers_gained;
  const legacyIsNet = legacySubscriberMetric && /\bnet\b/i.test(String(legacySubscriberMetric.source || legacySubscriberMetric.neden || ""));
  const explicitNet = metricValue(snapshot, "net_subscribers");
  return {
    views: metricValue(snapshot, "views"),
    likes: metricValue(snapshot, "likes"),
    comments: metricValue(snapshot, "comments"),
    shares: metricValue(snapshot, "shares"),
    subscribersGained: legacyIsNet ? null : metricValue(snapshot, "subscribers_gained"),
    subscribersLost: metricValue(snapshot, "subscribers_lost"),
    netSubscribers: explicitNet != null ? explicitNet : legacyIsNet ? metricValue(snapshot, "subscribers_gained") : null,
    averageViewDuration: metricValue(snapshot, "average_view_duration"),
    averagePercentageViewed: metricValue(snapshot, "average_percentage_viewed"),
    watchTimeMinutes: metricValue(snapshot, "watch_time_minutes"),
    engagedViews: metricValue(snapshot, "engaged_views"),
  };
}

// A checkpoint label describes the target age, not necessarily when GitHub
// Actions actually collected it. Older runs could miss 6h/12h and later
// backfill both at ~18h. Treating those labels as literal ages fabricates view
// velocity and can create a false EARLY_DISTRIBUTION_PLATEAU. When collection
// drift is material (>2.5h), performance math uses the real collection age;
// the declared label remains available for audit/reporting.
function checkpointSeries(row) {
  const series = Object.entries(row.checkpoints || {}).map(([label, snapshot]) => {
    const scheduledHours = labelHours(label);
    const collectedAge = row.publishAt && snapshot.collectedAt
      ? Math.max(0, (Date.parse(snapshot.collectedAt) - Date.parse(row.publishAt)) / 3600000)
      : null;
    const driftHours = Number.isFinite(scheduledHours) && Number.isFinite(collectedAge) ? collectedAge - scheduledHours : null;
    const materiallyLate = Number.isFinite(driftHours) && Math.abs(driftHours) > 2.5;
    const effectiveHours = materiallyLate ? collectedAge : (scheduledHours ?? collectedAge);
    return {
      label,
      hours: effectiveHours,
      scheduledHours,
      collectedAgeHours: round(collectedAge),
      checkpointDriftHours: round(driftHours),
      timingStatus: materiallyLate ? "LATE_COLLECTION_REAL_AGE_USED" : "ON_TIME",
      snapshot,
      metrics: flatSnapshot(snapshot),
    };
  }).filter((item) => Number.isFinite(item.hours)).sort((a, b) => a.hours - b.hours);
  return series;
}

function divide(numerator, denominator) {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator > 0 ? numerator / denominator : null;
}

function derive(row) {
  const series = checkpointSeries(row);
  const last = series[series.length - 1] || null;
  const current = last ? last.metrics : (row.metrics || {});
  const ageHours = last ? last.hours : row.publishAt ? Math.max(1, (Date.now() - Date.parse(row.publishAt)) / 3600000) : null;
  const previous = series.length > 1 ? series[series.length - 2] : null;
  const views = current.views;
  const recentVelocity = last && previous && Number.isFinite(views) && Number.isFinite(previous.metrics.views) && last.hours > previous.hours
    ? (views - previous.metrics.views) / (last.hours - previous.hours)
    : null;
  const likes = current.likes ?? (row.metrics || {}).likes;
  const comments = current.comments ?? (row.metrics || {}).comments;
  const shares = current.shares ?? (row.metrics || {}).shares;
  const subscribersGained = last ? current.subscribersGained : (row.metrics || {}).subscribersGained;
  const engagementCount = [likes, comments, shares].filter(Number.isFinite);
  const engagementTotal = engagementCount.length ? engagementCount.reduce((sum, value) => sum + value, 0) : null;
  return {
    ageHours: round(ageHours),
    checkpoint: last ? last.label : row.latestCheckpoint || null,
    views,
    viewsPerHour: round(divide(views, ageHours)),
    recentViewVelocity: round(recentVelocity),
    likeRate: round(divide(likes, views), 5),
    commentRate: round(divide(comments, views), 5),
    shareRate: round(divide(shares, views), 5),
    engagementRate: round(divide(engagementTotal, views), 5),
    engagedViewRate: round(divide(current.engagedViews, views), 5),
    subscriberConversion: round(divide(subscribersGained, views), 5),
    subscribersPer1000Views: round(divide(subscribersGained, views) == null ? null : subscribersGained / views * 1000),
    // Spec-named derived metrics (NULL when an input is missing).
    netSubscribers: Number.isFinite(subscribersGained) && Number.isFinite(current.subscribersLost) ? subscribersGained - current.subscribersLost : null,
    engagementPer1kViews: engagementCount.length === 3 && Number.isFinite(views) && views > 0 ? round(engagementTotal / views * 1000, 2) : null,
    watchMinutesPerView: round(divide(current.watchTimeMinutes ?? (row.metrics || {}).watchTimeMinutes, views), 3),
    averagePercentageViewed: current.averagePercentageViewed ?? (row.metrics || {}).averagePercentageViewed ?? null,
    averageViewDuration: current.averageViewDuration ?? (row.metrics || {}).averageViewDuration ?? null,
    series,
  };
}

function percentile(value, values) {
  if (!Number.isFinite(value)) return null;
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (sorted.length <= 1) return sorted.length ? 50 : null;
  const below = sorted.filter((item) => item < value).length;
  const equal = sorted.filter((item) => item === value).length;
  return round((below + Math.max(0, equal - 1) / 2) / (sorted.length - 1) * 100, 1);
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function plateau(raw, row, config) {
  const rule = config.performance.plateau;
  if (row.contentType !== "short" || !Number.isFinite(raw.views) || raw.views < rule.minimumViews || raw.views > rule.maximumViews || raw.ageHours < rule.minimumAgeHours) return null;
  const early = raw.series.filter((item) => item.hours <= rule.earlyWindowHours && Number.isFinite(item.metrics.views)).pop();
  const latest = raw.series[raw.series.length - 1];
  if (!early || !latest || latest.hours <= early.hours || early.metrics.views <= 0) return null;
  const earlyVelocity = early.metrics.views / Math.max(1, early.hours);
  const laterVelocity = (latest.metrics.views - early.metrics.views) / (latest.hours - early.hours);
  const velocityRatio = earlyVelocity > 0 ? laterVelocity / earlyVelocity : null;
  const growthAfterEarly = (latest.metrics.views - early.metrics.views) / early.metrics.views;
  if (!(velocityRatio <= rule.maximumVelocityRatio && growthAfterEarly <= rule.maximumGrowthAfterEarly)) return null;
  return {
    detected: true,
    code: "EARLY_DISTRIBUTION_PLATEAU",
    earlyCheckpoint: early.label,
    latestCheckpoint: latest.label,
    earlyViews: early.metrics.views,
    latestViews: latest.metrics.views,
    earlyVelocity: round(earlyVelocity),
    laterVelocity: round(laterVelocity),
    velocityRatio: round(velocityRatio, 3),
    growthAfterEarly: round(growthAfterEarly, 3),
  };
}

function probableCauses(raw, row, baselines) {
  const causes = [];
  if (Number.isFinite(raw.averagePercentageViewed) && Number.isFinite(baselines.averagePercentageViewed) && raw.averagePercentageViewed < baselines.averagePercentageViewed * 0.85) causes.push("retention below the channel-relative baseline");
  if (Number.isFinite(raw.subscriberConversion) && Number.isFinite(baselines.subscriberConversion) && raw.subscriberConversion < baselines.subscriberConversion * 0.7) causes.push("low subscriber conversion correlation");
  if (Number.isFinite(raw.engagementRate) && Number.isFinite(baselines.engagementRate) && raw.engagementRate < baselines.engagementRate * 0.7) causes.push("low engagement correlation");
  if (Number.isFinite(row.firstSecondsScore) && row.firstSecondsScore < 70) causes.push("weak first-three-second plan correlation");
  if (Number.isFinite(row.hookScore) && row.hookScore < 70) causes.push("weak opening curiosity-gap correlation");
  const recognizability = row.viralComponents && row.viralComponents.recognizability;
  if (recognizability && Number.isFinite(recognizability.value) && recognizability.value < 55) causes.push("low topic recognizability correlation");
  return causes.length ? causes : ["distribution slowed; available metrics do not isolate a reliable cause"];
}

function scoreRow(raw, row, peers, config) {
  const peerValues = (key) => peers.map((item) => item.raw[key]);
  const pct = {
    viewVelocity: percentile(raw.recentViewVelocity ?? raw.viewsPerHour, peers.map((item) => item.raw.recentViewVelocity ?? item.raw.viewsPerHour)),
    retention: percentile(raw.averagePercentageViewed, peerValues("averagePercentageViewed")),
    engagement: percentile(raw.engagementRate, peerValues("engagementRate")),
    subscriberConversion: percentile(raw.subscriberConversion, peerValues("subscriberConversion")),
    views: percentile(raw.viewsPerHour, peerValues("viewsPerHour")),
  };
  const weights = config.performance.growthScoreWeights;
  let sum = 0;
  let total = 0;
  const missing = [];
  for (const [key, weight] of Object.entries(weights)) {
    if (!Number.isFinite(pct[key])) { missing.push(key); continue; }
    sum += pct[key] * weight;
    total += weight;
  }
  let growthScore = total ? sum / total : null;
  const baselines = {
    views: median(peers.map((item) => item.raw.views)),
    viewsPerHour: median(peerValues("viewsPerHour")),
    averagePercentageViewed: median(peerValues("averagePercentageViewed")),
    engagementRate: median(peerValues("engagementRate")),
    subscriberConversion: median(peerValues("subscriberConversion")),
  };
  const plateauResult = plateau(raw, row, config);
  const breakoutRule = config.performance.classification;
  const medianMultiple = Number.isFinite(raw.views) && baselines.views ? raw.views / baselines.views : null;
  const breakoutSignals = [];
  if (Number.isFinite(medianMultiple) && medianMultiple >= breakoutRule.breakoutMedianMultiple && raw.views >= breakoutRule.breakoutMinimumViews) breakoutSignals.push(`${round(medianMultiple, 1)}x channel median views`);
  if (pct.viewVelocity >= 95) breakoutSignals.push(`view velocity in channel p${pct.viewVelocity}`);
  if (pct.subscriberConversion >= 90) breakoutSignals.push(`subscriber conversion in channel p${pct.subscriberConversion}`);
  const breakout = breakoutSignals.length >= 2 || (breakoutSignals.length >= 1 && Number.isFinite(medianMultiple) && medianMultiple >= breakoutRule.breakoutMedianMultiple);
  if (growthScore != null && breakout) growthScore += config.performance.breakoutBonus;
  if (growthScore != null && Number.isFinite(row.readiness) && row.readiness < 70) growthScore -= config.performance.weakQualityPenalty;
  growthScore = growthScore == null ? null : round(clamp(growthScore), 1);
  const classification = plateauResult ? "FAILED_TEST" : breakout ? "BREAKOUT"
    : growthScore == null ? "NORMAL" : growthScore >= breakoutRule.strongGrowthScore ? "STRONG"
      : growthScore >= breakoutRule.normalGrowthScore ? "NORMAL" : "WEAK";
  return {
    growthScore,
    classification,
    percentiles: pct,
    baselines,
    missing,
    plateau: plateauResult,
    breakout: breakout ? { detected: true, signals: breakoutSignals, medianMultiple: round(medianMultiple, 2) } : null,
    probableCauses: plateauResult ? probableCauses(raw, row, baselines) : [],
    caveat: "Classification is channel-relative correlation, not proof of YouTube recommendation causality.",
  };
}

function analyze(rows, config) {
  const prepared = rows.map((row) => ({ row, raw: derive(row) }));
  for (const item of prepared) {
    const peers = prepared.filter((peer) => peer.row.contentType === item.row.contentType && Number.isFinite(peer.raw.views));
    const scored = scoreRow(item.raw, item.row, peers, config);
    item.row.normalized = {
      ageHours: item.raw.ageHours,
      viewsPerHour: item.raw.viewsPerHour,
      recentViewVelocity: item.raw.recentViewVelocity,
      likeRate: item.raw.likeRate,
      commentRate: item.raw.commentRate,
      shareRate: item.raw.shareRate,
      engagementRate: item.raw.engagementRate,
      engagedViewRate: item.raw.engagedViewRate,
      subscriberConversion: item.raw.subscriberConversion,
      subscribersPer1000Views: item.raw.subscribersPer1000Views,
    };
    item.row.performance = scored;
  }
  return rows;
}

function refresh(channel, rows, options = {}) {
  const value = analyze(rows || Store.readState(channel, "growth", "performance.json", []), Config.forChannel(channel));
  for (const row of value) Store.assertSameChannel(channel, row, "performance row");
  if (options.write !== false) Store.writeState(channel, "growth", "performance.json", value);
  return value;
}

function clusterStats(rows) {
  const out = {};
  for (const row of rows.filter((item) => item.contentType === "short")) {
    const key = row.topicCluster || "uncategorized";
    (out[key] = out[key] || []).push(row);
  }
  return Object.fromEntries(Object.entries(out).map(([cluster, list]) => {
    const at = (label, key) => list.map((row) => {
      const snap = row.checkpoints && row.checkpoints[label];
      return snap ? metricValue(snap, key) : null;
    });
    return [cluster, {
      n: list.length,
      medianViews: median(list.map((row) => row.metrics && row.metrics.views)),
      median24hViews: median(at("24h", "views")),
      median48hViews: median(at("48h", "views")),
      medianSubscriberConversion: median(list.map((row) => row.normalized && row.normalized.subscriberConversion)),
      medianEngagementRate: median(list.map((row) => row.normalized && row.normalized.engagementRate)),
      medianRetention: median(list.map((row) => row.metrics && row.metrics.averagePercentageViewed)),
      breakoutFrequency: round(list.filter((row) => row.performance && row.performance.classification === "BREAKOUT").length / list.length, 3),
    }];
  }));
}

module.exports = { labelHours, metricValue, flatSnapshot, checkpointSeries, derive, percentile, median, plateau, probableCauses, analyze, refresh, clusterStats };
