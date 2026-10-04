"use strict";

// ANALYTICS WAREHOUSE — owner-authenticated YouTube Analytics API (v2) daily
// tables, one partition per channel:
//
//   <channel analytics>/warehouse/channel_daily.json   day × channel totals
//   <channel analytics>/warehouse/channel_type_daily.json  day × creatorContentType (SHORTS / VIDEO_ON_DEMAND / …)
//   <channel analytics>/warehouse/traffic_daily.json   day × insightTrafficSourceType
//   <channel analytics>/warehouse/video_daily.json     day × video (the channel's own uploads)
//   <channel analytics>/warehouse/state.json           load window, freshness, last error
//
// Only metrics the Analytics API reports are stored. Impressions and
// impression click-through rate are NOT exposed by the YouTube Analytics API
// (Studio shows them); they are recorded as unavailable, never estimated.
// Data for the last ~3 days is still being finalised by YouTube, so every
// incremental load re-reads a trailing window and upserts by key.

const fs = require("fs");
const path = require("path");

const CORE_METRICS = ["views", "estimatedMinutesWatched", "averageViewDuration", "averageViewPercentage", "subscribersGained", "subscribersLost", "likes", "comments", "shares"];
const TRAFFIC_METRICS = ["views", "estimatedMinutesWatched"];
const UNAVAILABLE = Object.freeze({
  impressions: "not exposed by the YouTube Analytics API (YouTube Studio only)",
  impressionClickThroughRate: "not exposed by the YouTube Analytics API (YouTube Studio only)",
});
const TRAILING_DAYS = 3;
const MAX_CHUNK_DAYS = 90;
const DEFAULT_BACKFILL_DAYS = 365;

const dayString = (date) => date.toISOString().slice(0, 10);
function addDays(day, delta) { const d = new Date(day + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + delta); return dayString(d); }

function directory(channel) { return path.join(channel.paths.analytics, "warehouse"); }
function tablePath(channel, table) { return path.join(directory(channel), `${table}.json`); }
function readTable(channel, table) {
  try { return JSON.parse(fs.readFileSync(tablePath(channel, table), "utf8")); } catch (error) { return { table, channel: channel.slug, rows: [] }; }
}
function writeTable(channel, table, data) {
  fs.mkdirSync(directory(channel), { recursive: true });
  fs.writeFileSync(tablePath(channel, table), JSON.stringify({ ...data, table, channel: channel.slug }, null, 1) + "\n");
}
function readState(channel) {
  try { return JSON.parse(fs.readFileSync(path.join(directory(channel), "state.json"), "utf8")); } catch (error) { return { channel: channel.slug, tables: {} }; }
}
function writeState(channel, state) {
  fs.mkdirSync(directory(channel), { recursive: true });
  fs.writeFileSync(path.join(directory(channel), "state.json"), JSON.stringify({ ...state, channel: channel.slug }, null, 2) + "\n");
}

// Analytics API response → objects keyed by column name.
function rowsOf(response) {
  const data = response && response.veri;
  if (!data || !Array.isArray(data.columnHeaders)) return [];
  const names = data.columnHeaders.map((header) => header.name);
  return (data.rows || []).map((row) => Object.fromEntries(names.map((name, index) => [name, row[index]])));
}

const finite = (value) => Number.isFinite(value) ? value : null;
const ratio = (a, b) => Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / b : null;

// Derived metrics (ANALYTICS-05); NULL when an input is missing or views are 0.
function derive(row) {
  const views = finite(row.views);
  const engagement = ["likes", "comments", "shares"].map((key) => row[key]).filter(Number.isFinite);
  return {
    netSubscribers: Number.isFinite(row.subscribersGained) && Number.isFinite(row.subscribersLost) ? row.subscribersGained - row.subscribersLost : null,
    subscriberConversion: ratio(row.subscribersGained, views),
    engagementPer1kViews: engagement.length === 3 && views ? Math.round(1000 * engagement.reduce((s, v) => s + v, 0) / views * 100) / 100 : null,
    watchMinutesPerView: ratio(row.estimatedMinutesWatched, views) == null ? null : Math.round(ratio(row.estimatedMinutesWatched, views) * 1000) / 1000,
  };
}

function upsert(rows, incoming, keyOf) {
  const map = new Map(rows.map((row) => [keyOf(row), row]));
  for (const row of incoming) map.set(keyOf(row), row);
  return [...map.values()].sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

// Window for an incremental load: re-read the trailing days, backfill on the
// first run. `end` is two days ago (Analytics data lags ~48 h).
function loadWindow(state, table, { now = new Date(), backfillDays = DEFAULT_BACKFILL_DAYS } = {}) {
  const end = addDays(dayString(now), -2);
  const last = state.tables && state.tables[table] && state.tables[table].lastLoadedDay;
  const start = last ? addDays(last, -TRAILING_DAYS) : addDays(end, -backfillDays + 1);
  return start > end ? null : { start, end };
}

function chunks({ start, end }) {
  const out = [];
  for (let from = start; from <= end; from = addDays(from, MAX_CHUNK_DAYS)) {
    const to = addDays(from, MAX_CHUNK_DAYS - 1);
    out.push({ start: from, end: to < end ? to : end });
  }
  return out;
}

async function query(api, params) {
  const response = await api.analytics(params);
  if (!response || !response.ok) {
    const error = new Error(`analytics query failed: ${(response && (response.neden || response.durum)) || "no response"}`);
    error.status = response && response.durum;
    throw error;
  }
  return rowsOf(response);
}

async function loadChannelDaily(api, window) {
  const rows = [];
  for (const part of chunks(window)) {
    for (const row of await query(api, { startDate: part.start, endDate: part.end, dimensions: "day", metrics: CORE_METRICS.join(","), sort: "day" })) {
      rows.push({ day: row.day, ...Object.fromEntries(CORE_METRICS.map((key) => [key, finite(row[key])])), ...derive(row) });
    }
  }
  return rows;
}

// Shorts vs long-form split; creatorContentType is a documented Analytics
// dimension. If the account or API rejects it, the table is skipped and the
// reason recorded — nothing is inferred.
async function loadChannelTypeDaily(api, window) {
  const rows = [];
  for (const part of chunks(window)) {
    for (const row of await query(api, { startDate: part.start, endDate: part.end, dimensions: "day,creatorContentType", metrics: ["views", "estimatedMinutesWatched", "averageViewDuration", "subscribersGained", "subscribersLost"].join(","), sort: "day" })) {
      rows.push({ day: row.day, contentType: row.creatorContentType, views: finite(row.views), estimatedMinutesWatched: finite(row.estimatedMinutesWatched),
        averageViewDuration: finite(row.averageViewDuration), subscribersGained: finite(row.subscribersGained), subscribersLost: finite(row.subscribersLost), ...derive(row) });
    }
  }
  return rows;
}

async function loadTrafficDaily(api, window) {
  const rows = [];
  for (const part of chunks(window)) {
    for (const row of await query(api, { startDate: part.start, endDate: part.end, dimensions: "day,insightTrafficSourceType", metrics: TRAFFIC_METRICS.join(","), sort: "day" })) {
      rows.push({ day: row.day, source: row.insightTrafficSourceType, views: finite(row.views), estimatedMinutesWatched: finite(row.estimatedMinutesWatched) });
    }
  }
  return rows;
}

// Per video, day dimension with a video filter (the documented way to get a
// video's daily series). Only the channel's own uploads are queried.
async function loadVideoDaily(api, window, videos) {
  const rows = [];
  for (const video of videos) {
    const start = video.publishedDay && video.publishedDay > window.start ? video.publishedDay : window.start;
    if (start > window.end) continue;
    for (const row of await query(api, { startDate: start, endDate: window.end, dimensions: "day", filters: `video==${video.videoId}`, metrics: CORE_METRICS.join(","), sort: "day" })) {
      rows.push({ day: row.day, videoId: video.videoId, contentType: video.contentType || null, ...Object.fromEntries(CORE_METRICS.map((key) => [key, finite(row[key])])), ...derive(row) });
    }
  }
  return rows;
}

const TABLES = {
  channel_daily: { load: (api, window) => loadChannelDaily(api, window), key: (row) => row.day },
  channel_type_daily: { load: (api, window) => loadChannelTypeDaily(api, window), key: (row) => `${row.day}|${row.contentType}`, optional: true },
  traffic_daily: { load: (api, window) => loadTrafficDaily(api, window), key: (row) => `${row.day}|${row.source}` },
  video_daily: { load: (api, window, options) => loadVideoDaily(api, window, options.videos || []), key: (row) => `${row.day}|${row.videoId}` },
};

// Incremental sync of every table for one channel. `api` must already be
// authenticated AND identity-verified for this channel (analytics-sync.js).
async function sync(channel, api, options = {}) {
  const state = readState(channel);
  state.tables = state.tables || {};
  const result = { channel: channel.slug, tables: {}, unavailable: UNAVAILABLE };
  for (const [table, spec] of Object.entries(TABLES)) {
    const window = loadWindow(state, table, options);
    if (!window) { result.tables[table] = { skipped: "up to date" }; continue; }
    try {
      const incoming = await spec.load(api, window, options);
      const current = readTable(channel, table);
      const rows = upsert(current.rows || [], incoming, spec.key);
      if (options.write !== false) writeTable(channel, table, { rows, unavailable: UNAVAILABLE });
      state.tables[table] = { lastLoadedDay: window.end, firstDay: rows.length ? spec.key(rows[0]).slice(0, 10) : null, rows: rows.length, loadedAt: new Date().toISOString(), lastError: null };
      result.tables[table] = { window, loaded: incoming.length, rows: rows.length };
    } catch (error) {
      state.tables[table] = { ...(state.tables[table] || {}), lastError: String(error.message).slice(0, 200), failedAt: new Date().toISOString() };
      result.tables[table] = { window, error: String(error.message).slice(0, 200), optional: !!spec.optional };
    }
  }
  state.lastSyncAt = new Date().toISOString();
  if (options.write !== false) writeState(channel, state);
  return result;
}

// Freshness for reports/observability: how old is the newest loaded day.
function freshness(channel, now = new Date()) {
  const state = readState(channel);
  const days = Object.values(state.tables || {}).map((item) => item.lastLoadedDay).filter(Boolean).sort();
  const newest = days.length ? days[days.length - 1] : null;
  return { channel: channel.slug, lastSyncAt: state.lastSyncAt || null, newestDay: newest,
    lagDays: newest ? Math.round((Date.parse(dayString(now)) - Date.parse(newest)) / 86400000) : null,
    errors: Object.entries(state.tables || {}).filter(([, item]) => item.lastError).map(([table, item]) => ({ table, error: item.lastError })) };
}

module.exports = { CORE_METRICS, UNAVAILABLE, TRAILING_DAYS, DEFAULT_BACKFILL_DAYS, TABLES, directory, readTable, readState, rowsOf, derive, upsert, loadWindow, chunks, sync, freshness };
