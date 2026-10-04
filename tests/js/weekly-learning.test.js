"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const Weekly = require("../../core/growth/weekly-learning");

const cp = (views, viewed) => ({ metrics: { views: { value: views }, average_percentage_viewed: { value: viewed } } });
const record = (id, publishAt, title, views, viewed, extra = {}) => ({ videoId: id, slug: id, contentType: "short", publishAt, title, checkpoints: views == null ? { "1h": cp(5, null) } : { "1d": cp(views, viewed) }, ...extra });

test("publish slots: the 21:00 baseline and preserved 01:00 experiment cohort", () => {
  assert.equal(Weekly.publishSlot("2026-10-02T18:00:00Z"), "21:00 TR");
  assert.equal(Weekly.publishSlot("2026-10-03T22:00:00Z"), "01:00 TR");
  assert.equal(Weekly.publishSlot("2026-11-03T22:00:00Z"), "01:00 TR");
  assert.equal(Weekly.publishSlot(null), "unknown");
});

test("popularity bands follow the Wikipedia score", () => {
  assert.equal(Weekly.popularityBand(85), "famous");
  assert.equal(Weekly.popularityBand(60), "known");
  assert.equal(Weekly.popularityBand(30), "obscure");
  assert.equal(Weekly.popularityBand(null), "unknown");
});

test("summary compares groups only with enough measured videos and reports recent videos", () => {
  const records = [
    record("a", "2026-09-27T18:00:00Z", "Why A Failed", 1600, 90),
    record("b", "2026-09-28T18:00:00Z", "Why B Failed", 1200, 80),
    record("c", "2026-09-29T18:00:00Z", "C: The Flaw", 300, 60),
    record("d", "2026-09-30T22:00:00Z", "D: The Flaw", 400, 70),
    record("e", "2026-10-01T22:00:00Z", "E: The Flaw", 500, null),
    record("f", "2026-10-02T22:00:00Z", "F: The Flaw", null, null),
  ];
  const popularity = { a: 85, b: 80, c: 40, d: 40, e: 40, f: 60 };
  const summary = Weekly.summarize(records, { shorts: { observations: [{ dimension: "topicCluster", value: "x", sample: 3, lift: -0.1 }] } }, { now: "2026-10-03T00:00:00Z", popularityFor: (slug) => popularity[slug] });
  assert.equal(summary.sample, 6);
  assert.equal(summary.measured, 5);
  assert.equal(summary.recent.length, 6);
  assert.deepEqual(summary.bySlot.map((group) => [group.value, group.measured]).sort(), [["01:00 TR", 2], ["21:00 TR", 3]]);
  const md = Weekly.markdown(summary);
  assert.match(md, /Yayın saati: karşılaştırma için yeterli veri yok/, "the new slot has only 2 measured videos");
  assert.match(md, /Başlık kalıbı: karşılaştırma için yeterli veri yok/);
  assert.match(md, /F: The Flaw — henüz yok/);
  assert.match(md, /Why A Failed — 1600 · %90 · why · famous · 21:00 TR/);
  assert.match(md, /İlk gözlem: topicCluster = x \(3 video, fark -10%\)/);
  assert.match(md, /kesin neden-sonuç değildir/);
});

test("adopted learning and hypotheses are listed when present", () => {
  const md = Weekly.markdown(Weekly.summarize([], { shorts: { adopted: [{ dimension: "titlePattern", value: "why", sample: 12, lift: 0.31 }], hypotheses: [{ dimension: "publishSlot", value: "18:00 New York", sample: 6, lift: 0.2 }] } }));
  assert.match(md, /Uygulanan öğrenmeler.*\n- titlePattern = why \(12 video, fark \+31%\)/);
  assert.match(md, /Hipotezler.*\n- publishSlot = 18:00 New York/);
});
