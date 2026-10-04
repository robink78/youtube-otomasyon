"use strict";

// MONETIZATION READINESS — progress toward the YouTube Partner Program
// thresholds YouTube publishes, from the channel's own data only:
//   1,000 subscribers AND (4,000 valid public long-form watch hours in the
//   last 365 days OR 10,000,000 valid public Shorts views in the last 90 days)
//
// This is an estimate. YouTube decides eligibility, and its "valid public"
// counts can differ from the Analytics API. Missing inputs stay null
// ("unavailable"); nothing is extrapolated. Strategy context: Shorts bring
// reach and subscribers, long-form brings watch time and depth.

const fs = require("fs");
const path = require("path");
const Warehouse = require("./warehouse");

const THRESHOLDS = Object.freeze({ subscribers: 1000, longWatchHours365: 4000, shortsViews90: 10000000 });

function latestSubscribers(channel) {
  const directory = path.join(channel.paths.analytics, "kanal");
  try {
    const files = fs.readdirSync(directory).filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file)).sort();
    const snapshot = JSON.parse(fs.readFileSync(path.join(directory, files[files.length - 1]), "utf8"));
    return Number.isFinite(snapshot.subscribers) ? { value: snapshot.subscribers, at: snapshot.tarih || files[files.length - 1].slice(0, 10) } : null;
  } catch (error) { return null; }
}

function sumSince(rows, days, now, predicate, key) {
  const since = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const matching = rows.filter((row) => row.day >= since && predicate(row) && Number.isFinite(row[key]));
  return matching.length ? matching.reduce((sum, row) => sum + row[key], 0) : null;
}

function progress(channel, options = {}) {
  const now = options.now || new Date();
  const typeRows = options.channelTypeDaily || Warehouse.readTable(channel, "channel_type_daily").rows || [];
  const subscribers = options.subscribers !== undefined ? options.subscribers : latestSubscribers(channel);
  const longMinutes = typeRows.length ? sumSince(typeRows, 365, now, (row) => row.contentType === "VIDEO_ON_DEMAND", "estimatedMinutesWatched") : null;
  const shortsViews = typeRows.length ? sumSince(typeRows, 90, now, (row) => row.contentType === "SHORTS", "views") : null;
  const pct = (value, target) => value == null ? null : Math.min(100, Math.round(value / target * 1000) / 10);
  const longWatchHours365 = longMinutes == null ? null : Math.round(longMinutes / 60);
  return {
    channel: channel.slug,
    estimate: true,
    note: "Estimate from the YouTube Analytics API; YouTube decides eligibility.",
    subscribers: subscribers ? subscribers.value : null,
    subscribersAt: subscribers ? subscribers.at : null,
    longWatchHours365,
    shortsViews90: shortsViews,
    percent: {
      subscribers: pct(subscribers ? subscribers.value : null, THRESHOLDS.subscribers),
      longWatchHours365: pct(longWatchHours365, THRESHOLDS.longWatchHours365),
      shortsViews90: pct(shortsViews, THRESHOLDS.shortsViews90),
    },
    thresholds: THRESHOLDS,
  };
}

module.exports = { THRESHOLDS, latestSubscribers, progress };
