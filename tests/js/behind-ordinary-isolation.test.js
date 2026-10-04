"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const Channel = require("../../core/channel-context");
const Discovery = require("../../core/discovery");
const Growth = require("../../core/growth");
const Store = require("../../core/growth/store");
const Analytics = require("../../core/growth/analytics");
const Predictions = require("../../core/growth/predictions");
const Experiments = require("../../core/growth/experiments");
const Thumbnails = require("../../core/growth/thumbnails");
const Learning = require("../../core/growth/learning");
const Quota = require("../../lib/quota");

test("The Hidden Logic of Things topics and every adaptive ledger remain channel-isolated", () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "bto-isolation-"));
  const savedRoot = process.env.GROWTH_STATE_ROOT;
  process.env.GROWTH_STATE_ROOT = sandbox;
  try {
    const bto = Channel.getChannel("behind-the-ordinary");
    const ct = Channel.getChannel("critical-thread");
    const btoTopic = Discovery.discover(bto, { limit: 5 })[0];
    const ctTopic = Discovery.discover(ct, { limit: 5 })[0];
    assert.throws(() => Growth.planShort(bto, ctTopic), /CROSS_CHANNEL_PLAN_BLOCKED/);
    assert.throws(() => Growth.planShort(ct, btoTopic), /CROSS_CHANNEL_PLAN_BLOCKED/);
    const ranked = Growth.Context.rank(bto);
    assert.ok(ranked.rows.length > 0);
    assert.ok(ranked.rows.every((row) => row.topic.channel === "behind-the-ordinary" && row.topic.productionReady === true));

    const performance = {
      videoId: "BTO-VIDEO-1", channel: bto.slug, contentType: "short", slug: btoTopic.slug,
      topicCluster: btoTopic.category, hookType: "visual_first_reveal", titlePattern: "WHY",
      metrics: { views: 1000, averagePercentageViewed: 85, subscribersPer1000Views: 4, engagementPer1000Views: 20 },
      performance: { growthScore: 80 }, topicScore: 91, viralScore: 87, hookScore: 90, titleScore: 88, readiness: 92,
    };
    Analytics.registerVideo(bto, performance);
    assert.equal(Analytics.readAll(bto).length, 1);
    assert.equal(Analytics.readAll(ct).length, 0, "analytics cannot leak");
    assert.throws(() => Analytics.registerVideo(ct, performance), /CROSS_CHANNEL_WRITE_BLOCKED/);

    Predictions.refresh(bto, [performance]);
    assert.equal(Store.readState(bto, "growth", "predictions.json", null).channel, bto.slug);
    assert.equal(Store.readState(ct, "growth", "predictions.json", null), null, "prediction ledger cannot leak");

    Experiments.create(bto, { id: "bto-hook-test", contentType: "short", hypothesis: "A macro object reveal improves retention", variable: "hook_style", control: "question", variant: "visual reveal", metric: "averagePercentageViewed" });
    assert.equal(Experiments.load(bto).experiments.length, 1);
    assert.equal(Experiments.load(ct).experiments.length, 0, "experiment ledger cannot leak");

    Thumbnails.recordVariants(bto, btoTopic.slug, [{ file: "bto-preview.jpg", sha256: "bto-only-hash", concept: "macro-detail", selected: true }]);
    assert.equal(Thumbnails.read(bto).variants.length, 1);
    assert.equal(Thumbnails.read(ct).variants.length, 0, "thumbnail ledger cannot leak");

    Learning.learn(bto, [performance]);
    assert.equal(Learning.read(bto).channel, bto.slug);
    assert.equal(Learning.read(ct).channel, ct.slug);
    assert.equal(Learning.read(ct).updatedAt, null, "learning weights cannot leak");

    for (const area of ["growth", "memory"]) assert.notEqual(Store.dirs(bto)[area], Store.dirs(ct)[area]);
  } finally {
    if (savedRoot === undefined) delete process.env.GROWTH_STATE_ROOT; else process.env.GROWTH_STATE_ROOT = savedRoot;
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
});

test("The Hidden Logic of Things quota ledger is isolated while shared-project totals remain intentional", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "bto-quota-isolation-"));
  try {
    const fake = (slug, directory) => ({ slug, paths: { state: path.join(root, directory) }, credentials: () => ({ clientId: "12345-shared.apps.googleusercontent.com" }) });
    const bto = fake("behind-the-ordinary", "bto");
    const ct = fake("critical-thread", "ct");
    const now = new Date("2026-10-03T12:00:00Z");
    Quota.record(bto, "videos.insert", { now });
    assert.equal(Quota.readLedger(bto).channel, "behind-the-ordinary");
    assert.deepEqual(Quota.readLedger(ct).days, {}, "physical quota ledger cannot leak");
    assert.equal(Quota.usedToday(bto, [bto, ct], { now }), Quota.cost("videos.insert"), "portfolio accounting intentionally sums same-project ledgers");
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
