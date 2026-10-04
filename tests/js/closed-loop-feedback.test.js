"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Channel = require("../../core/channel-context");
const Config = require("../../core/growth/config");
const Context = require("../../core/growth/context");
const Performance = require("../../core/growth/performance");

function metric(value) { return { value, status: "DIRECTLY_MEASURED" }; }

test("feedback checkpoints include the early-signal and long-tail schedule", () => {
  const config = Config.forChannel(Channel.getChannel("critical-thread"));
  assert.deepEqual(config.analytics.checkpointLabels, ["1h", "6h", "12h", "24h", "48h", "7d", "14d", "30d"]);
  assert.deepEqual(config.analytics.checkpointsHours, [1, 6, 12, 24, 48, 168, 336, 720]);
});

test("late checkpoint labels use real collection age instead of fabricating early velocity", () => {
  const row = {
    videoId: "late1",
    contentType: "short",
    publishAt: "2026-10-02T18:00:00.000Z",
    checkpoints: {
      "1h": { collectedAt: "2026-10-02T19:20:00.000Z", metrics: { views: metric(40) } },
      "12h": { collectedAt: "2026-10-03T11:40:00.000Z", metrics: { views: metric(480) } },
      "6h": { collectedAt: "2026-10-03T11:52:00.000Z", metrics: { views: metric(487) } },
      "24h": { collectedAt: "2026-10-03T18:05:00.000Z", metrics: { views: metric(493) } },
    },
  };
  const series = Performance.checkpointSeries(row);
  const twelve = series.find((point) => point.label === "12h");
  const six = series.find((point) => point.label === "6h");
  assert.equal(twelve.timingStatus, "LATE_COLLECTION_REAL_AGE_USED");
  assert.ok(twelve.hours > 17 && twelve.hours < 18);
  assert.ok(six.hours > 17 && six.hours < 18);
  assert.equal(series[0].label, "1h");
  assert.equal(series[series.length - 1].label, "24h");
});

test("adopted learning is actually wired back into topic, hook and title selection context", () => {
  const channel = Channel.getChannel("impossible-brief");
  const learning = {
    channel: channel.slug,
    shorts: {
      adoptedWeights: { CuriosityScore: 1.15 },
      adoptedHookFamilyBonus: { consequence_first: 4 },
      adoptedTitlePatternBonus: { question: 3 },
      adoptedClusterBonus: { "SPACE & ASTROPHYSICS": 5 },
      adoptedDurationBucketBonus: { "26-35s": 2 },
    },
    longform: {},
  };
  const history = { published: [], generated: [], blocked: [], failed: [], used: new Set(), publishedTitles: [] };
  const ctx = Context.build(channel, { inventory: [], performanceRows: [], history, learning });
  assert.equal(ctx.learnedWeights.CuriosityScore, 1.15);
  assert.equal(ctx.learnedFamilyBonus.consequence_first, 4);
  assert.equal(ctx.learnedTitlePatternBonus.question, 3);
  assert.equal(ctx.learnedClusterBonus["SPACE & ASTROPHYSICS"], 5);
  assert.equal(ctx.learnedDurationBucketBonus["26-35s"], 2);
});
