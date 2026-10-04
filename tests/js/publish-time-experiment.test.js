"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Experiment = require("../../core/growth/publish-time-experiment");

const cp = (views, retention, subscribers) => ({ metrics: { views: { value: views }, average_percentage_viewed: { value: retention }, subscribers_gained: { value: subscribers } } });

test("publish-time cohorts preserve 01:00 evidence without claiming significance", () => {
  assert.equal(Experiment.cohort("2026-10-02T18:00:00Z"), "21:00_TR");
  assert.equal(Experiment.cohort("2026-10-03T22:00:00Z"), "01:00_TR");
  const report = Experiment.compare([
    { channel: "a", videoId: "1", contentType: "short", publishAt: "2026-10-02T18:00:00Z", topicCluster: "x", checkpoints: { "1h": cp(100, 80, 1), "24h": cp(1000, 82, 4) } },
    { channel: "a", videoId: "2", contentType: "short", publishAt: "2026-10-03T22:00:00Z", topicCluster: "x", checkpoints: { "1h": cp(10, 60, 0), "24h": cp(100, 62, 0) } },
  ]);
  assert.equal(report.cohorts.baseline.n, 1);
  assert.equal(report.cohorts.experiment.n, 1);
  assert.equal(report.confidence, "INSUFFICIENT_SAMPLE");
  assert.equal(report.significanceClaimed, false);
  assert.equal(report.observedDifference["24hViews"], -900);
});
