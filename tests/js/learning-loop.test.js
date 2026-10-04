"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Predictions = require("../../core/growth/predictions");
const Diagnosis = require("../../core/growth/diagnosis");
const Weekly = require("../../core/growth/weekly-learning");

const record = (i, extra = {}) => ({
  videoId: `V${i}`, slug: `s${i}`, contentType: "short", topicCluster: i % 2 ? "aviation" : "bridges", publishAt: `2026-09-${String(10 + i).padStart(2, "0")}T18:00:00Z`,
  topicScore: 50 + i * 5, hookScore: 90 - i * 5, titleScore: 70, readiness: 85, popularityScore: 40 + i * 6,
  metrics: { views: 100 * (i + 1), averagePercentageViewed: 70 + i, subscribersPer1000Views: 1 + i / 10 },
  performance: { growthScore: 40 + i * 6 }, latestCheckpoint: "7d", ...extra,
});

test("LEARN-01: predictions are joined with outcomes and calibrated per predictor", () => {
  const rows = Predictions.rows([1, 2, 3, 4, 5, 6].map((i) => record(i)));
  assert.equal(rows[0].predicted.topicScore, 55);
  assert.equal(rows[0].outcome.growthScore, 46);
  const cal = Predictions.calibration(rows).short;
  assert.deepEqual([cal.topicScore.status, cal.topicScore.spearman], ["PREDICTIVE", 1], "higher predicted topic score ranked higher");
  assert.deepEqual([cal.hookScore.status, cal.hookScore.spearman], ["INVERTED", -1], "an inverted predictor is flagged");
  assert.equal(cal.titleScore.status, "NO_VARIANCE");
  assert.equal(Predictions.calibration(rows.slice(0, 3)).short.topicScore.status, "INSUFFICIENT_SAMPLE", "no verdict under 5 videos");
});

test("TOPIC-01: topic families track predicted vs actual, confidence, explore/exploit and fatigue", () => {
  const records = [1, 3, 5, 7, 9].map((i) => record(i, { topicCluster: "aviation", performance: { growthScore: i < 7 ? 80 : 40 } }))
    .concat([2, 4].map((i) => record(i, { topicCluster: "bridges" })));
  const families = Predictions.topicPerformance(Predictions.rows(records));
  const aviation = families.find((item) => item.cluster === "aviation");
  assert.equal(aviation.publications, 5);
  assert.equal(aviation.confidence, "low");
  assert.equal(aviation.fatigue, true, "the latest two fell below the family's earlier median");
  assert.equal(families.find((item) => item.cluster === "bridges").mode, "explore", "two videos: still exploring");
});

test("TOPIC/LEARN isolation: predictions are written only to the channel's own growth state", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pred-"));
  const saved = process.env.GROWTH_STATE_ROOT;
  process.env.GROWTH_STATE_ROOT = root;
  try {
    const Channel = require("../../core/channel-context");
    Predictions.refresh(Channel.getChannel("impossible-brief"), [record(1)]);
    const Store = require("../../core/growth/store");
    assert.equal(Store.readState(Channel.getChannel("impossible-brief"), "growth", "predictions.json", null).rows.length, 1);
    assert.equal(Store.readState(Channel.getChannel("critical-thread"), "growth", "predictions.json", null), null);
  } finally { if (saved === undefined) delete process.env.GROWTH_STATE_ROOT; else process.env.GROWTH_STATE_ROOT = saved; }
});

test("DIAG-01: spec diagnoses are relative to the channel's own format baseline", () => {
  const config = require("../../core/growth/config").forChannel(require("../../core/channel-context").getChannel("failure-reconstructed"));
  const baselines = { short: { n: 8, views: 1000, subscribersPer1000Views: 1, averagePercentageViewed: 75 }, long: { n: 0 } };
  const codes = (metrics, options) => Diagnosis.diagnose({ videoId: "x", contentType: "short", metrics }, baselines, config, options).diagnoses.map((item) => item.code);
  assert.ok(codes({ views: 2500, averagePercentageViewed: 85, subscribersPer1000Views: 2, shortsFeedShare: 0.8 }).includes("STRONG_TOPIC_AUDIENCE_FIT"));
  assert.ok(codes({ views: 2500, averagePercentageViewed: 85, subscribersPer1000Views: 1, shortsFeedShare: 0.8 }).includes("STRONG_DISCOVERY"));
  assert.ok(codes({ views: 900, searchShare: 0.62 }).includes("SEARCH_DEPENDENT"));
  const small = { short: { n: 2, views: 100, subscribersPer1000Views: 1 }, long: { n: 0 } };
  assert.ok(!Diagnosis.diagnose({ videoId: "x", contentType: "short", metrics: { views: 900, subscribersPer1000Views: 5 } }, small, config).diagnoses.some((item) => item.code === "STRONG_TOPIC_AUDIENCE_FIT"), "no verdict from a 2-video baseline");
  const first = Diagnosis.diagnose({ videoId: "x", contentType: "short", metrics: { views: 900, averagePercentageViewed: 40 } }, baselines, config).diagnoses;
  assert.equal(first.find((item) => item.code === "RETENTION_FAILURE").specCode, "RETENTION_WEAK", "existing codes carry the spec name");
  assert.equal(Diagnosis.specCode("BREAKOUT"), "POTENTIAL_BREAKOUT");
});

test("CADENCE_QUALITY_RISK: more uploads while watch time per upload falls", () => {
  const now = new Date("2026-10-30T00:00:00Z");
  const days = (start, n, minutes) => Array.from({ length: n }, (_, i) => ({ day: new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10), estimatedMinutesWatched: minutes }));
  const daily = [...days("2026-09-04", 28, 1000), ...days("2026-10-02", 28, 900)];
  const uploads = (start, n) => Array.from({ length: n }, (_, i) => new Date(Date.parse(start) + i * 86400000 * (28 / n)).toISOString());
  const risky = Diagnosis.cadenceRisk(daily, [...uploads("2026-09-04T18:00:00Z", 8), ...uploads("2026-10-02T18:00:00Z", 14)], {}, now);
  assert.equal(risky.code, "CADENCE_QUALITY_RISK");
  const fine = Diagnosis.cadenceRisk(daily, [...uploads("2026-09-04T18:00:00Z", 8), ...uploads("2026-10-02T18:00:00Z", 8)], {}, now);
  assert.equal(fine.code, null);
  assert.equal(Diagnosis.cadenceRisk(daily, uploads("2026-10-02T18:00:00Z", 3), {}, now).reason, "insufficient uploads");
});

test("weekly report surfaces calibration, families, conversion and cadence only with enough data", () => {
  const rows = Predictions.rows([1, 2, 3, 4, 5, 6].map((i) => record(i)));
  const summary = Weekly.summarize([], {}, {
    predictions: { calibration: Predictions.calibration(rows) },
    families: Predictions.topicPerformance(rows),
    conversion: { short: { titlePattern: { why: { n: 4, subscribersPer1000Views: 2.1 }, "label-colon": { n: 5, subscribersPer1000Views: 0.9 }, inside: { n: 1, subscribersPer1000Views: 9 } } } },
    cadence: { code: "CADENCE_QUALITY_RISK", recentUploads: 14, previousUploads: 8, watchMinutesPerUpload: { previous: 3500, recent: 1800 } },
  });
  const md = Weekly.markdown(summary);
  assert.match(md, /konu puanı: sıra korelasyonu 1 \(6 video\) — işe yarıyor/);
  assert.match(md, /kanca puanı: .* TERS çalışıyor/);
  assert.match(md, /Konu aileleri/);
  assert.match(md, /en iyi başlık kalıbı why \(2\.1 .*en zayıf label-colon/, "the 1-video pattern is ignored");
  assert.match(md, /Yayın sıklığı riski/);
});
