"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const ROOT = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

test("MONET-01: readiness uses only real data, labels it an estimate and never extrapolates", () => {
  const Monetization = require("../../core/analytics/monetization");
  const ch = { slug: "failure-reconstructed", paths: { analytics: fs.mkdtempSync(path.join(os.tmpdir(), "monet-")) } };
  const now = new Date("2026-10-03T00:00:00Z");
  const empty = Monetization.progress(ch, { now, channelTypeDaily: [], subscribers: null });
  assert.deepEqual([empty.subscribers, empty.longWatchHours365, empty.shortsViews90, empty.estimate], [null, null, null, true]);
  const rows = [
    { day: "2026-09-30", contentType: "SHORTS", views: 6000000, estimatedMinutesWatched: 10 },
    { day: "2026-05-01", contentType: "SHORTS", views: 9000000, estimatedMinutesWatched: 10 },
    { day: "2026-09-30", contentType: "VIDEO_ON_DEMAND", views: 10, estimatedMinutesWatched: 60000 },
  ];
  const p = Monetization.progress(ch, { now, channelTypeDaily: rows, subscribers: { value: 250, at: "2026-10-02" } });
  assert.equal(p.shortsViews90, 6000000, "only the last 90 days count");
  assert.equal(p.longWatchHours365, 1000, "only long-form minutes count toward watch hours");
  assert.deepEqual(p.percent, { subscribers: 25, longWatchHours365: 25, shortsViews90: 60 });
  assert.match(p.note, /YouTube decides eligibility/);
});

test("REPORT-01: the daily report shows warehouse freshness, ops, quota and readiness per channel", () => {
  const Report = require("../../daily-operations-report");
  const md = Report.markdown({ generatedAt: "x", channels: [{ name: "X", shortStatus: "s", longStatus: "l", youtubeStatus: "y", analyticsHealth: "a", schedulerHealth: "h", backlog: 1, errors: 0,
    platform: { analyticsFreshness: { newestDay: "2026-10-01", lagDays: 2, errors: [] }, ops24h: { "publish.success": 1, "publish.retry": 2 },
      quota: { usedToday: 1650, budget: 9800, project: "123" }, monetization: { subscribers: 20, longWatchHours365: null, shortsViews90: 12000 } } }] });
  assert.match(md, /\| Analytics warehouse \| through 2026-10-01 \(lag 2 d\) \|/);
  assert.match(md, /\| Ops \(24 h\) \| publish\.success 1, publish\.retry 2 \|/);
  assert.match(md, /\| API quota today \| 1650 \/ 9800 units \(project 123\) \|/);
  assert.match(md, /long-form watch h \(365 d\) unavailable\/4,000/, "missing stays unavailable, not zero");
});

test("TEST-07: production behaviour is not silently altered by the platform work", () => {
  const Safety = require("../../lib/publish-safety");
  assert.equal(Safety.publishMode({}), "live", "uploads stay live unless PUBLISH_MODE says otherwise");
  const portfolio = read(".github/workflows/portfolio-production.yml");
  for (const slug of ["failure-reconstructed", "impossible-brief", "critical-thread"]) {
    assert.match(portfolio, new RegExp(`node shorts-sira\\.js --channel ${slug}`), `${slug} still produced by the portfolio run`);
  }
  assert.match(portfolio, /PUBLISH: \$\{\{ vars\.IB_PUBLISH \}\}/);
  assert.match(portfolio, /PUBLISH: \$\{\{ vars\.CT_PUBLISH \}\}/);
  assert.doesNotMatch(portfolio, /PUBLISH_MODE|PROVENANCE_REQUIRED/, "new gates are opt-in, not switched on in production");
  const uploader = read("youtube-yukle.js");
  assert.match(uploader, /let gizlilik = \(env\("YT_PRIVACY"\) \|\| "private"\)\.toLowerCase\(\);/, "default privacy unchanged");
  assert.match(uploader, /require\("\.\/core\/scheduling\/calendar"\)\.publishSlot\(CHANNEL/, "publish slot logic unchanged");
  const calendar = require("../../core/scheduling/calendar");
  const Channel = require("../../core/channel-context");
  assert.equal(calendar.shortSchedule(Channel.getChannel("failure-reconstructed")).timeZone, "Europe/Istanbul");
});

test("TIKTOK-01 (blocked): TikTok stays retired by the owner's decision, its code dormant and intact", () => {
  for (const slug of ["failure-reconstructed", "impossible-brief", "critical-thread"]) {
    assert.equal(JSON.parse(read(`channels/${slug}/config.json`)).platforms.tiktok.enabled, false, slug);
  }
  for (const file of ["tiktok-yukle.js", "tiktok-yetki.js", "lib/tiktok.js"]) assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} kept`);
});

test("OBS: scheduler tasks from earlier days are settled, so queue depth and job age are meaningful", () => {
  const Scheduler = require("../../core/scheduling");
  const channel = require("../../core/channel-context").getChannel("impossible-brief");
  const state = { queue: [
    { key: "ib:short", format: "short", date: "2026-10-01", status: "queued" },
    { key: "ib:short", format: "short", date: "2026-10-02", status: "queued" },
    { key: "ib:long", format: "long", date: "2026-10-01", status: "queued" },
    { key: "ib:short", format: "short", date: "2026-10-03", status: "queued" },
  ] };
  const records = [{ format: "short", slug: "x", tarih: "2026-10-02T06:30:00Z", publishAt: "2026-10-02T22:00:00Z", videoId: "V" }];
  Scheduler.settle(state, channel, "2026-10-03", records);
  assert.deepEqual(state.queue.map((item) => item.status), ["missed", "done", "expired", "queued"], "today's task stays queued");
});
