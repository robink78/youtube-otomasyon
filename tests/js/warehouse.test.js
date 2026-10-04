"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Warehouse = require("../../core/analytics/warehouse");

const channel = (slug) => ({ slug, paths: { analytics: fs.mkdtempSync(path.join(os.tmpdir(), `wh-${slug}-`)) } });

// Fake Analytics API v2: answers with columnHeaders/rows like the real one and
// records every query.
function fakeApi({ failDimensions = [] } = {}) {
  const calls = [];
  return {
    calls,
    analytics: async (q) => {
      calls.push(q);
      if (failDimensions.includes(q.dimensions)) return { ok: false, durum: 400, neden: "Unknown identifier" };
      const days = [];
      for (let d = new Date(q.startDate + "T00:00:00Z"); d <= new Date(q.endDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) days.push(d.toISOString().slice(0, 10));
      const dims = q.dimensions.split(",");
      const metrics = q.metrics.split(",");
      const headers = [...dims, ...metrics].map((name) => ({ name }));
      const rows = [];
      for (const day of days.slice(-5)) {
        const extra = dims.length > 1 ? (dims[1] === "insightTrafficSourceType" ? ["SHORTS"] : ["SHORTS"]) : [];
        rows.push([day, ...extra, ...metrics.map((metric) => metric === "views" ? 1000 : metric === "estimatedMinutesWatched" ? 500 : metric === "subscribersGained" ? 12 : metric === "subscribersLost" ? 2 : metric === "averageViewPercentage" ? 81.5 : 10)]);
      }
      return { ok: true, veri: { columnHeaders: headers, rows } };
    },
  };
}

test("ANALYTICS-01/05: daily tables carry real API metrics plus derived ones; impressions/CTR are marked unavailable", async () => {
  const ch = channel("impossible-brief");
  const api = fakeApi();
  const now = new Date("2026-10-03T12:00:00Z");
  const result = await Warehouse.sync(ch, api, { now, backfillDays: 30, videos: [{ videoId: "VID1", contentType: "short", publishedDay: "2026-09-29" }] });
  for (const table of ["channel_daily", "channel_type_daily", "traffic_daily", "video_daily"]) assert.ok(result.tables[table].rows > 0, table);
  const daily = Warehouse.readTable(ch, "channel_daily");
  const row = daily.rows[daily.rows.length - 1];
  assert.equal(row.views, 1000);
  assert.equal(row.netSubscribers, 10);
  assert.equal(row.subscriberConversion, 0.012);
  assert.equal(row.engagementPer1kViews, 30);
  assert.equal(row.watchMinutesPerView, 0.5);
  assert.equal(row.impressions, undefined, "never estimated");
  assert.match(daily.unavailable.impressions, /not exposed by the YouTube Analytics API/);
  const videoQuery = api.calls.find((q) => q.filters === "video==VID1");
  assert.equal(videoQuery.startDate, "2026-09-29", "a video is queried from its publication day");
  assert.equal(api.calls.find((q) => q.dimensions === "day").endDate, "2026-10-01", "end is two days ago (Analytics latency)");
});

test("ANALYTICS-02: first run backfills; later runs only re-read the trailing days and upsert", async () => {
  const ch = channel("critical-thread");
  const api = fakeApi();
  await Warehouse.sync(ch, api, { now: new Date("2026-10-03T12:00:00Z"), backfillDays: 365 });
  const first = api.calls.filter((q) => q.dimensions === "day");
  assert.equal(first[0].startDate, "2025-10-02", "365-day backfill");
  assert.ok(first.length >= 4, "backfill is chunked (≤ 90 days per query)");
  const before = Warehouse.readTable(ch, "channel_daily").rows.length;
  api.calls.length = 0;
  await Warehouse.sync(ch, api, { now: new Date("2026-10-04T12:00:00Z") });
  const next = api.calls.find((q) => q.dimensions === "day");
  assert.equal(next.startDate, "2026-09-28", "re-read the last 3 days");
  const after = Warehouse.readTable(ch, "channel_daily").rows;
  assert.equal(new Set(after.map((row) => row.day)).size, after.length, "upsert never duplicates a day");
  assert.ok(after.length >= before);
  assert.equal(Warehouse.freshness(ch, new Date("2026-10-04T12:00:00Z")).newestDay, "2026-10-02");
});

test("an unsupported optional dimension is recorded, not guessed, and does not stop the other tables", async () => {
  const ch = channel("failure-reconstructed");
  const result = await Warehouse.sync(ch, fakeApi({ failDimensions: ["day,creatorContentType"] }), { now: new Date("2026-10-03T12:00:00Z"), backfillDays: 10 });
  assert.equal(result.tables.channel_type_daily.optional, true);
  assert.match(result.tables.channel_type_daily.error, /analytics query failed/);
  assert.ok(result.tables.channel_daily.rows > 0);
  assert.equal(Warehouse.readTable(ch, "channel_type_daily").rows.length, 0);
  assert.match(Warehouse.freshness(ch).errors[0].table, /channel_type_daily/);
});

test("TEST-03: each channel's warehouse is a separate partition", async () => {
  const a = channel("impossible-brief");
  const b = channel("critical-thread");
  await Warehouse.sync(a, fakeApi(), { now: new Date("2026-10-03T12:00:00Z"), backfillDays: 5 });
  assert.ok(Warehouse.readTable(a, "channel_daily").rows.length > 0);
  assert.equal(Warehouse.readTable(b, "channel_daily").rows.length, 0);
  assert.notEqual(Warehouse.directory(a), Warehouse.directory(b));
  assert.equal(Warehouse.readTable(a, "channel_daily").channel, "impossible-brief");
});

test("derived metrics are NULL-safe", () => {
  assert.deepEqual(Warehouse.derive({ views: 0, likes: 0, comments: 0, shares: 0 }), { netSubscribers: null, subscriberConversion: null, engagementPer1kViews: null, watchMinutesPerView: null });
  assert.equal(Warehouse.derive({ views: 100, subscribersGained: 3 }).netSubscribers, null, "lost unknown → net unknown");
});

test("the sync verifies the channel before writing and runs in the daily analytics loop", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../analytics-sync.js"), "utf8");
  assert.ok(source.indexOf("getYouTubeClient(channel") < source.indexOf("Warehouse.sync(channel"), "identity verified before any row is written");
  const workflow = fs.readFileSync(path.join(__dirname, "../../.github/workflows/portfolio-production.yml"), "utf8");
  assert.match(workflow, /node analytics-sync\.js --channel "\$CHANNEL" \|\| true/);
});

test("per-video publish-relative performance carries the spec's derived metrics", () => {
  const Performance = require("../../core/growth/performance");
  const metric = (value) => ({ value });
  const row = { contentType: "short", publishAt: "2026-10-01T00:00:00Z", checkpoints: { "1d": { collectedAt: "2026-10-02T00:00:00Z", metrics: {
    views: metric(1000), likes: metric(30), comments: metric(5), shares: metric(5), subscribers_gained: metric(8), subscribers_lost: metric(1), watch_time_minutes: metric(400) } } } };
  const derived = Performance.derive(row);
  assert.deepEqual([derived.netSubscribers, derived.engagementPer1kViews, derived.watchMinutesPerView, derived.subscriberConversion], [7, 40, 0.4, 0.008]);
  const sparse = Performance.derive({ contentType: "short", checkpoints: { "1h": { collectedAt: "2026-10-01T01:00:00Z", metrics: { views: metric(50) } } } });
  assert.deepEqual([sparse.netSubscribers, sparse.engagementPer1kViews], [null, null], "missing inputs stay NULL");
});
