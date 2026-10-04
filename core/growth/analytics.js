"use strict";

// ANALYTICS SUPPORT MATRIX + PERFORMANCE PERSISTENCE (PHASE 14/15/16/32P).
//
// Audited 2026-09-29 against the official YouTube Data API v3 videos resource
// and YouTube Analytics API v2 metrics list. Nothing here calls a private or
// undocumented endpoint. Missing values are stored as null with a status —
// never substituted by a different metric under the same name.

const Store = require("./store");
const Config = require("./config");
const fs = require("fs");
const path = require("path");

const SUPPORT = Object.freeze({
  views: { status: "SUPPORTED", source: "Data API statistics.viewCount / Analytics views" },
  engaged_views: { status: "ACCOUNT-DEPENDENT", source: "Analytics API engagedViews (requested with the video-filtered report)" },
  likes: { status: "SUPPORTED", source: "Data API statistics.likeCount" },
  comments: { status: "SUPPORTED", source: "Data API statistics.commentCount" },
  shares: { status: "ACCOUNT-DEPENDENT", source: "Analytics API shares (requires yt-analytics.readonly on the channel's token)" },
  subscribers_gained: { status: "ACCOUNT-DEPENDENT", source: "Analytics API subscribersGained" },
  subscribers_lost: { status: "ACCOUNT-DEPENDENT", source: "Analytics API subscribersLost" },
  net_subscribers: { status: "DERIVED", source: "subscribersGained − subscribersLost" },
  average_view_duration: { status: "ACCOUNT-DEPENDENT", source: "Analytics API averageViewDuration" },
  average_percentage_viewed: { status: "ACCOUNT-DEPENDENT", source: "Analytics API averageViewPercentage" },
  watch_time: { status: "ACCOUNT-DEPENDENT", source: "Analytics API estimatedMinutesWatched" },
  traffic_source: { status: "ACCOUNT-DEPENDENT", source: "Analytics API insightTrafficSourceType dimension" },
  retention_curve: { status: "ACCOUNT-DEPENDENT", source: "Analytics API audienceWatchRatio / relativeRetentionPerformance by elapsedVideoTimeRatio" },
  impressions: { status: "UNAVAILABLE", source: "Studio only; manual studio-manual.json entry is labelled as manual" },
  ctr: { status: "UNAVAILABLE", source: "Studio only (impressions click-through rate); manual entry only" },
  returning_viewers: { status: "UNAVAILABLE", source: "not exposed per video by the public API; manual entry only" },
  viewed_vs_swiped_away: { status: "UNAVAILABLE", source: "Shorts 'viewed vs swiped away' is Studio-only; no Analytics API metric" },
  stayed_to_watch: { status: "UNAVAILABLE", source: "Studio-only Shorts metric" },
  end_screen_clicks: { status: "UNAVAILABLE", source: "no end-screen element metric in Analytics API (card* and annotation* metrics only)" },
  card_clicks: { status: "ACCOUNT-DEPENDENT", source: "Analytics API cardClicks / cardClickRate" },
  playlist_metrics: { status: "ACCOUNT-DEPENDENT", source: "Analytics API playlistStarts, viewsPerPlaylistStart, averageTimeInPlaylist (playlist reports)" },
  shorts_related_video_write: { status: "UNAVAILABLE", source: "no Related Video field in videos resource; Studio manual action" },
  end_screen_write: { status: "UNAVAILABLE", source: "no end-screen write endpoint" },
  thumbnail_update: { status: "SUPPORTED", source: "thumbnails.set (channel must be verified for custom thumbnails)" },
  scheduled_publishing: { status: "SUPPORTED", source: "status.publishAt with privacyStatus=private" },
  synthetic_media_disclosure: { status: "SUPPORTED", source: "status.containsSyntheticMedia" },
  short_to_long_conversion: { status: "INFERRED", source: "no direct attribution; inferred from long-form traffic_source=SHORTS/RELATED_VIDEO around linked Short publish dates" },
  long_to_long_session: { status: "INFERRED", source: "inferred from RELATED_VIDEO/END_SCREEN traffic-source share on the next episode; END_SCREEN traffic type is reported as a traffic source" },
});

const METRIC_MAP = {
  views: (m) => m.views, likes: (m) => m.likes, comments: (m) => m.comments, shares: (m) => m.shares,
  subscribers_gained: (m) => m.subscribersGained, subscribers_lost: (m) => m.subscribersLost,
  net_subscribers: (m) => m.netSubscribers, average_view_duration: (m) => m.averageViewDuration,
  average_percentage_viewed: (m) => m.averageViewPercentage, watch_time_minutes: (m) => m.watchTimeMinutes,
  impressions: (m) => m.impressions, ctr: (m) => m.ctr, returning_viewers: (m) => m.returningViewers,
  first_30s_retention: (m) => m.first30sRetention, engaged_views: (m) => m.engagedViews,
};

function value(metric) {
  if (!metric || metric.durum !== "ok" || !Number.isFinite(metric.deger)) return { value: null, status: metric ? (metric.durum === "ok" ? "INVALID" : "UNAVAILABLE") : "NOT_COLLECTED", reason: metric && metric.neden || null };
  return { value: metric.deger, status: "DIRECTLY_MEASURED", source: metric.kaynak };
}

// Checkpoint due for a video at `now` (hours since publish), given done labels.
function dueCheckpoint(publishAt, now, done, config) {
  const hours = (now.getTime() - Date.parse(publishAt)) / 3600000;
  if (!(hours >= 0)) return null;
  const { checkpointsHours, checkpointLabels } = config.analytics;
  let due = null;
  checkpointsHours.forEach((h, index) => { if (hours >= h && !done.includes(checkpointLabels[index])) due = checkpointLabels[index]; });
  return due;
}

// Convert a lib/analitik measurement into a growth performance snapshot.
function snapshot(measurement) {
  const m = measurement.metrikler || {};
  const metrics = {};
  for (const [key, pick] of Object.entries(METRIC_MAP)) metrics[key] = value(pick(m));
  // Older snapshots stored net subscribers under `subscribersGained`. Preserve
  // that value as net; do not silently relabel it as gross subscribers gained.
  if (m.subscribersGained && /\bnet\b/i.test(String(m.subscribersGained.kaynak || "")) && !m.netSubscribers) {
    metrics.net_subscribers = value(m.subscribersGained);
    metrics.subscribers_gained = { value: null, status: "UNAVAILABLE", reason: "legacy snapshot contains net subscribers only" };
  }
  const views = metrics.views.value;
  const derive = (numerator, factor, label) => numerator != null && views ? { value: Math.round(numerator / views * factor * 100) / 100, status: "DERIVED", from: label } : { value: null, status: "UNAVAILABLE" };
  metrics.subscribers_per_1000_views = derive(metrics.subscribers_gained.value, 1000, "subscribers_gained / views");
  metrics.net_subscribers_per_1000_views = derive(metrics.net_subscribers.value, 1000, "net_subscribers / views");
  metrics.engagement_per_1000_views = views && metrics.likes.value != null && metrics.comments.value != null
    ? { value: Math.round((metrics.likes.value + metrics.comments.value + (metrics.shares.value || 0)) / views * 1000 * 100) / 100, status: "DERIVED", from: "likes+comments+shares / views" }
    : { value: null, status: "UNAVAILABLE" };
  metrics.watch_hours_per_1000_views = derive(metrics.watch_time_minutes.value != null ? metrics.watch_time_minutes.value / 60 : null, 1000, "watch hours / views");
  const traffic = (measurement.trafik || []).map((row) => ({ source: row.kaynak, views: row.views, share: Math.round(row.oran * 1000) / 1000 }));
  return { metrics, traffic, retention: measurement.tutma || null, analyticsStatus: measurement.analitikDurumu || null };
}

function flatMetrics(snap) {
  const pick = (key) => snap.metrics[key] ? snap.metrics[key].value : null;
  return {
    views: pick("views"), averagePercentageViewed: pick("average_percentage_viewed"), averageViewDuration: pick("average_view_duration"),
    likes: pick("likes"), comments: pick("comments"), shares: pick("shares"), subscribersGained: pick("subscribers_gained"),
    engagedViews: pick("engaged_views"),
    subscribersLost: pick("subscribers_lost"), netSubscribers: pick("net_subscribers"),
    subscribersPer1000Views: pick("subscribers_per_1000_views"), netSubscribersPer1000Views: pick("net_subscribers_per_1000_views"), engagementPer1000Views: pick("engagement_per_1000_views"),
    watchHoursPer1000Views: pick("watch_hours_per_1000_views"), ctr: pick("ctr"), first30sRetention: pick("first_30s_retention"),
    shortsFeedShare: (snap.traffic.find((row) => row.source === "SHORTS") || {}).share ?? null,
    searchShare: snap.traffic.length ? (snap.traffic.find((row) => row.source === "YT_SEARCH") || { share: 0 }).share : null,
  };
}

const FILE = "performance.json";

function readAll(channel) {
  const rows = Store.readState(channel, "growth", FILE, []);
  for (const row of rows) Store.assertSameChannel(channel, row, "performance row");
  return rows;
}

// Upsert growth metadata (hook, bucket, experiment…) at upload time.
function registerVideo(channel, meta, options = {}) {
  Store.assertSameChannel(channel, meta, "video metadata");
  const rows = readAll(channel);
  const key = meta.videoId;
  if (!key) throw new Error("registerVideo requires videoId");
  const existing = rows.find((row) => row.videoId === key);
  const merged = { ...(existing || { checkpoints: {} }), ...meta, channel: channel.slug, contentType: meta.contentType === "long" ? "long" : "short" };
  const next = rows.filter((row) => row.videoId !== key).concat(merged);
  if (options.write !== false) Store.writeState(channel, "growth", FILE, next);
  return merged;
}

function recordCheckpoint(channel, videoId, label, measurement, options = {}) {
  const rows = readAll(channel);
  let row = rows.find((item) => item.videoId === videoId);
  if (!row) row = { videoId, channel: channel.slug, contentType: measurement.format === "long" ? "long" : "short", checkpoints: {} };
  if (row.contentType !== (measurement.format === "long" ? "long" : "short") && measurement.format) {
    // content type is fixed by the registry; a mismatch is recorded, not merged
    row.contentTypeConflict = measurement.format;
  }
  const snap = snapshot(measurement);
  row.checkpoints[label] = { collectedAt: measurement.toplandi || new Date().toISOString(), ...snap };
  row.metrics = flatMetrics(snap);
  row.latestCheckpoint = label;
  const next = rows.filter((item) => item.videoId !== videoId).concat(row);
  if (options.write !== false) Store.writeState(channel, "growth", FILE, next);
  return row;
}

// Separate baselines per content type — never blended.
function baselines(channel, rows = readAll(channel)) {
  const out = {};
  for (const type of ["short", "long"]) {
    const list = rows.filter((row) => row.contentType === type && row.metrics);
    const median = (key) => {
      const xs = list.map((row) => row.metrics[key]).filter(Number.isFinite).sort((a, b) => a - b);
      return xs.length ? xs[Math.floor(xs.length / 2)] : null;
    };
    out[type] = { n: list.length, views: median("views"), averagePercentageViewed: median("averagePercentageViewed"), subscribersPer1000Views: median("subscribersPer1000Views"), engagementPer1000Views: median("engagementPer1000Views"), watchHoursPer1000Views: median("watchHoursPer1000Views") };
  }
  return out;
}

// PHASE 14: subscribers per 1,000 views by dimension, Shorts and long separate.
function conversionBreakdown(channel, rows = readAll(channel)) {
  const dims = ["topicCluster", "hookType", "durationBucket", "storyStructure", "ctaStyle", "titlePattern", "contentType", "popularityBand", "publishSlot", "openingVisual"];
  const out = { short: {}, long: {} };
  for (const type of ["short", "long"]) {
    for (const dim of dims) {
      const groups = {};
      for (const row of rows.filter((item) => item.contentType === type && item.metrics && Number.isFinite(item.metrics.subscribersPer1000Views))) {
        const key = row[dim] == null ? "unknown" : String(row[dim]);
        (groups[key] = groups[key] || []).push(row.metrics.subscribersPer1000Views);
      }
      out[type][dim] = Object.fromEntries(Object.entries(groups).map(([key, xs]) => [key, { n: xs.length, subscribersPer1000Views: Math.round(xs.reduce((a, b) => a + b, 0) / xs.length * 100) / 100 }]));
    }
  }
  return out;
}

function supportMatrix() { return SUPPORT; }

function checkpointLabel(file) {
  const value = file.replace(/\.json$/, "");
  if (value === "1d") return "24h";
  if (value === "7d") return "7d";
  if (/^\d+d$/.test(value)) return `${Number(value.slice(0, -1)) * 24}h`;
  return value;
}

// Import the channel's existing, real analytics snapshots into the shared
// growth registry. This is idempotent and never fabricates old 1h/6h values:
// only files that actually exist are imported under their real age label.
function backfillLegacy(channel, options = {}) {
  if (channel.config.pathMode !== "legacy-adapter") throw new Error(`LEGACY_BACKFILL_UNSUPPORTED: ${channel.slug} has no legacy analytics tree`);
  const Context = require("./context");
  const Performance = require("./performance");
  const ctx = options.context || Context.build(channel);
  const published = ctx.history.published;
  const topics = new Map(ctx.inventory.map((topic) => [topic.slug, topic]));
  let videos = 0;
  let snapshots = 0;
  const skipped = [];
  // Enrich every published registry row, including a just-published video
  // whose first legacy snapshot directory has not been created yet.
  for (const publication of published.filter((row) => row.videoId)) {
    const topic = topics.get(publication.slug);
    const existing = readAll(channel).find((row) => row.videoId === publication.videoId);
    registerVideo(channel, {
      ...(existing || {}),
      videoId: publication.videoId,
      channel: channel.slug,
      contentType: publication.format === "long" ? "long" : "short",
      slug: publication.slug || existing && existing.slug || null,
      title: publication.baslik || publication.title || existing && existing.title || null,
      publishAt: publication.publishAt || publication.tarih || existing && existing.publishAt || null,
      topicCluster: topic && topic.cluster || existing && existing.topicCluster || null,
      registeredBy: existing && existing.registeredBy || "legacy-publication-registry",
    });
  }
  if (!fs.existsSync(channel.paths.analytics)) return { channel: channel.slug, videos, snapshots, skipped: ["analytics directory missing"] };
  for (const videoId of fs.readdirSync(channel.paths.analytics).sort()) {
    const directory = path.join(channel.paths.analytics, videoId);
    if (videoId === "kanal" || !fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
    const files = fs.readdirSync(directory).filter((file) => /^\d+d\.json$|^manual-.*\.json$/.test(file)).sort();
    if (!files.length) continue;
    const publication = published.find((row) => row.videoId === videoId) || {};
    const topic = topics.get(publication.slug);
    let importedForVideo = 0;
    for (const file of files) {
      let measurement;
      try { measurement = JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")); } catch (error) { skipped.push(`${videoId}/${file}: invalid JSON`); continue; }
      if (!measurement || !measurement.metrikler) { skipped.push(`${videoId}/${file}: no measurement`); continue; }
      const contentType = measurement.format === "long" ? "long" : "short";
      registerVideo(channel, {
        videoId,
        channel: channel.slug,
        contentType,
        slug: publication.slug || null,
        title: measurement.baslik || publication.baslik || null,
        publishAt: publication.publishAt || publication.tarih || (measurement.yayin ? `${measurement.yayin}T00:00:00.000Z` : null),
        durationSeconds: measurement.sureSn || null,
        topicCluster: topic && topic.cluster || null,
        registeredBy: "legacy-analytics-backfill",
      });
      recordCheckpoint(channel, videoId, checkpointLabel(file), measurement);
      importedForVideo += 1;
      snapshots += 1;
    }
    if (importedForVideo) videos += 1;
  }
  const rows = Performance.refresh(channel, readAll(channel), { write: options.write !== false });
  return { channel: channel.slug, videos, snapshots, trackedVideos: rows.length, skipped };
}

module.exports = { SUPPORT, FILE, snapshot, flatMetrics, dueCheckpoint, readAll, registerVideo, recordCheckpoint, baselines, conversionBreakdown, supportMatrix, checkpointLabel, backfillLegacy, config: Config };
