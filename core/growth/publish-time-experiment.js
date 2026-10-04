"use strict";

const TIME_ZONE = "Europe/Istanbul";
const COHORTS = Object.freeze({ BASELINE: "21:00_TR", EXPERIMENT: "01:00_TR" });

function localHour(publishAt, timeZone = TIME_ZONE) {
  const date = new Date(publishAt);
  if (!Number.isFinite(date.getTime())) return null;
  return Number(new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", hourCycle: "h23" }).format(date));
}

function cohort(publishAt) {
  const hour = localHour(publishAt);
  return hour === 21 ? COHORTS.BASELINE : hour === 1 ? COHORTS.EXPERIMENT : "OTHER";
}

function metric(checkpoint, key) {
  const value = checkpoint && checkpoint.metrics && checkpoint.metrics[key];
  if (value && typeof value === "object") return Number.isFinite(value.value) ? value.value : null;
  return Number.isFinite(value) ? value : null;
}

function checkpoint(record, labels) {
  for (const label of labels) if (record.checkpoints && record.checkpoints[label]) return record.checkpoints[label];
  return null;
}

function auditRow(record) {
  const points = { "1h": ["1h"], "6h": ["6h"], "12h": ["12h"], "24h": ["24h", "1d"] };
  const views = {};
  for (const [label, aliases] of Object.entries(points)) views[label] = metric(checkpoint(record, aliases), "views");
  const latest = checkpoint(record, ["24h", "1d", "12h", "6h", "1h"]) || {};
  const retention = metric(latest, "average_percentage_viewed");
  const gained = metric(latest, "subscribers_gained");
  const latestViews = metric(latest, "views");
  const subscriberConversion = latestViews > 0 && gained != null ? Math.round(gained / latestViews * 100000) / 100 : null;
  return {
    channel: record.channel, videoId: record.videoId, title: record.title || record.selectedTitle || null,
    topicFamily: record.topicCluster || null, publishAt: record.publishAt, cohort: cohort(record.publishAt),
    views, retention, subscribersGained: gained, subscriberConversion,
  };
}

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function aggregate(rows) {
  const result = { n: rows.length, channels: [...new Set(rows.map((row) => row.channel))], topicFamilies: [...new Set(rows.map((row) => row.topicFamily).filter(Boolean))] };
  for (const label of ["1h", "6h", "12h", "24h"]) {
    const values = rows.map((row) => row.views[label]).filter(Number.isFinite);
    result[`${label}Views`] = { n: values.length, mean: values.length ? Math.round(mean(values)) : null };
  }
  for (const key of ["retention", "subscriberConversion"]) {
    const values = rows.map((row) => row[key]).filter(Number.isFinite);
    result[key] = { n: values.length, mean: values.length ? Math.round(mean(values) * 100) / 100 : null };
  }
  return result;
}

function compare(records) {
  const rows = records.filter((row) => row && row.publishAt && (row.contentType || "short") === "short").map(auditRow)
    .filter((row) => row.cohort !== "OTHER");
  const baselineRows = rows.filter((row) => row.cohort === COHORTS.BASELINE);
  const experimentRows = rows.filter((row) => row.cohort === COHORTS.EXPERIMENT);
  const baseline = aggregate(baselineRows), experiment = aggregate(experimentRows);
  const minimum = Math.min(baseline.n, experiment.n);
  const confidence = minimum < 3 ? "INSUFFICIENT_SAMPLE" : minimum < 8 ? "LOW_DIRECTIONAL" : "DIRECTIONAL_NOT_CAUSAL";
  const observedDifference = {};
  for (const key of ["1hViews", "6hViews", "12hViews", "24hViews", "retention", "subscriberConversion"]) {
    const a = baseline[key].mean, b = experiment[key].mean;
    observedDifference[key] = a == null || b == null ? null : Math.round((b - a) * 100) / 100;
  }
  return { schema: "publish-time-experiment/1", timeZone: TIME_ZONE, cohorts: { baseline, experiment }, confidence,
    significanceClaimed: false, observedDifference, rows };
}

module.exports = { TIME_ZONE, COHORTS, localHour, cohort, auditRow, aggregate, compare };
