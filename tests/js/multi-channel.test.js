"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const Channel = require("../../core/channel-context");
const Publishing = require("../../core/publishing");
const Research = require("../../core/research");
const Scripting = require("../../core/scripting");
const Quality = require("../../core/quality/impossible-brief");
const CriticalQuality = require("../../core/quality/critical-thread");
const BehindQuality = require("../../core/quality/behind-the-ordinary");
const SharedQuality = require("../../core/quality");
const Discovery = require("../../core/discovery");
const Library = require("../../core/analytics/library-health");
const Scheduler = require("../../core/scheduling");
const Simulation = require("../../core/simulation/two-channel");
const Rendering = require("../../core/rendering");
const Retention = require("../../core/retention");
const Notifications = require("../../core/notifications");

const ROOT = path.resolve(__dirname, "..", "..");

test("channel registry defaults safely and parses --channel in both forms", () => {
  const registry = Channel.registry();
  assert.equal(registry.defaultChannel, "failure-reconstructed");
  assert.deepEqual(Object.keys(registry.channels).sort(), ["behind-the-ordinary", "critical-thread", "failure-reconstructed", "impossible-brief"]);
  assert.deepEqual(Channel.parseChannelArgv(["--channel", "impossible-brief", "--due"]), { slug: "impossible-brief", argv: ["--due"] });
  assert.deepEqual(Channel.parseChannelArgv(["--channel=failure-reconstructed", "x"]), { slug: "failure-reconstructed", argv: ["x"] });
  assert.throws(() => Channel.parseChannelArgv(["--channel", "unknown"]), /Unknown channel/);
});

test("channel data roots, analytics, memory, production, and state never overlap", () => {
  const channels = ["failure-reconstructed", "impossible-brief", "critical-thread", "behind-the-ordinary"].map(Channel.getChannel);
  for (const key of ["topics", "analytics", "state", "memory", "reports", "packages", "production", "secrets"]) {
    assert.equal(new Set(channels.map((channel) => channel.paths[key])).size, 4, key);
  }
  const ib = channels[1];
  const ct = channels[2];
  assert.ok(ib.paths.state.startsWith(path.join(ROOT, "channels", "impossible-brief")));
  assert.ok(!ib.paths.state.includes(path.join(ROOT, "icerik")));
  assert.ok(ct.paths.state.startsWith(path.join(ROOT, "channels", "critical-thread")));
  assert.ok(channels[3].paths.state.startsWith(path.join(ROOT, "channels", "behind-the-ordinary")));
});

test("YouTube credentials are namespaced; isolated channels cannot inherit legacy secrets", () => {
  const keys = ["YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN", "FR_YT_CLIENT_ID", "FR_YT_CLIENT_SECRET", "FR_YT_REFRESH_TOKEN", "IB_CLIENT_ID", "IB_CLIENT_SECRET", "IB_YT_REFRESH_TOKEN", "CT_CLIENT_ID", "CT_CLIENT_SECRET", "CT_YT_REFRESH_TOKEN", "BTO_YT_CLIENT_ID", "BTO_YT_CLIENT_SECRET", "BTO_YT_REFRESH_TOKEN"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.YT_CLIENT_ID = "legacy-id";
    process.env.YT_CLIENT_SECRET = "legacy-secret";
    process.env.YT_REFRESH_TOKEN = "legacy-token";
    process.env.IB_CLIENT_ID = "ib-id";
    process.env.IB_CLIENT_SECRET = "ib-secret";
    process.env.IB_YT_REFRESH_TOKEN = "ib-token";
    process.env.CT_CLIENT_ID = "ct-id";
    process.env.CT_CLIENT_SECRET = "ct-secret";
    process.env.CT_YT_REFRESH_TOKEN = "ct-token";
    process.env.BTO_YT_CLIENT_ID = "bto-id";
    process.env.BTO_YT_CLIENT_SECRET = "bto-secret";
    process.env.BTO_YT_REFRESH_TOKEN = "bto-token";
    const fr = Channel.getChannel("failure-reconstructed").credentials();
    const ib = Channel.getChannel("impossible-brief").credentials();
    const ct = Channel.getChannel("critical-thread").credentials();
    const bto = Channel.getChannel("behind-the-ordinary").credentials();
    assert.equal(fr.clientId, "legacy-id", "legacy fallback remains only for original channel");
    assert.equal(ib.clientId, "ib-id");
    assert.equal(ct.clientId, "ct-id");
    assert.equal(bto.clientId, "bto-id");
    delete process.env.IB_CLIENT_ID;
    assert.equal(Channel.getChannel("impossible-brief").credentials().clientId, "", "no fallback to shared credential");
    delete process.env.CT_CLIENT_ID;
    assert.equal(Channel.getChannel("critical-thread").credentials().clientId, "", "CriticalThread cannot inherit another identity");
    delete process.env.BTO_YT_CLIENT_ID;
    assert.equal(Channel.getChannel("behind-the-ordinary").credentials().clientId, "", "The Hidden Logic of Things cannot inherit another identity");
  } finally {
    for (const key of keys) saved[key] == null ? delete process.env[key] : process.env[key] = saved[key];
  }
});

test("all twelve wrong-channel upload directions are blocked before mutation", async () => {
  const keys = ["FR_YT_CHANNEL_ID", "IB_YT_CHANNEL_ID", "CT_YT_CHANNEL_ID", "BTO_YT_CHANNEL_ID"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  process.env.FR_YT_CHANNEL_ID = "UC_FAILURE_RECONSTRUCTED";
  process.env.IB_YT_CHANNEL_ID = "UC_IMPOSSIBLE_BRIEF";
  process.env.CT_YT_CHANNEL_ID = "UC_CRITICAL_THREAD";
  process.env.BTO_YT_CHANNEL_ID = "UC_BEHIND_THE_ORDINARY";
  try {
    const channels = ["failure-reconstructed", "impossible-brief", "critical-thread", "behind-the-ordinary"].map(Channel.getChannel);
    for (const target of channels) {
      assert.equal(Publishing.assertUploadTarget(target.expectedChannelId(), target).ok, true);
      for (const source of channels.filter((channel) => channel.slug !== target.slug)) {
        assert.throws(() => Publishing.assertUploadTarget(source.expectedChannelId(), target), /CHANNEL_MISMATCH/);
      }
    }
    const yt = require("../../lib/yt");
    await assert.rejects(() => yt.verifyChannelIdentity({ data: async () => ({ ok: true, veri: { items: [{ id: "UC_FAILURE_RECONSTRUCTED", snippet: { title: "Failure Reconstructed" } }] } }) }, Channel.getChannel("impossible-brief")), /upload\/write blocked/);
  } finally { for (const key of keys) saved[key] == null ? delete process.env[key] : process.env[key] = saved[key]; }
});

test("library has 500 qualified, source-based, non-duplicate topics in the target mix", () => {
  const channel = Channel.getChannel("impossible-brief");
  const universe = Discovery.universe(channel);
  assert.equal(universe.count, 500);
  assert.equal(new Set(universe.topics.map((topic) => topic.id)).size, 500);
  assert.equal(new Set(universe.topics.map((topic) => topic.topic.toLowerCase())).size, 500);
  assert.deepEqual(Object.fromEntries(Object.entries(universe.categoryTargets)), { SPACE: 125, EARTH: 100, PHYSICS: 100, HUMAN: 50, "FUTURE TECHNOLOGY": 50, "EXTREME SCIENCE": 50, OTHER: 25 });
  for (const topic of universe.topics) {
    assert.equal(Research.auditTopic(topic).pass, true, topic.id);
    assert.notEqual(Quality.evaluateTopic(topic, universe.topics).decision, "BLOCK", topic.id);
    assert.ok(topic.visualPotential.score >= 70 && topic.quality.nonDuplicate);
  }
  const health = Library.calculate(channel);
  assert.ok(health.qualifiedTopics >= 365);
  assert.ok(health.daysOfInventory >= 365);
  assert.equal(health.duplicateTopics, 0);
});

test("ImpossibleBrief package enforces claims, hooks, 20 titles, visuals, metadata and no upload", () => {
  const channel = Channel.getChannel("impossible-brief");
  assert.equal(channel.config.retentionRules.openingMaxSeconds, 3);
  assert.equal(channel.config.retentionRules.secondBeatMaxSeconds, 8);
  const topic = Discovery.universe(channel).topics.find((item) => item.topic === "What If Gravity Doubled Tomorrow?");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ib-e2e-"));
  try {
    const result = Rendering.buildPackage(topic, channel, temp, { render: false });
    assert.ok(Object.values(result.validations).every(Boolean));
    assert.equal(Scripting.titleCandidates(topic).length, 20);
    assert.equal(Scripting.shortScript(topic).forbiddenOpening, false);
    const metadata = JSON.parse(fs.readFileSync(path.join(temp, "metadata.json"), "utf8"));
    assert.equal(metadata.uploadEnabled, false);
    assert.equal(metadata.uploadChannel, "impossible-brief");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("CriticalThread has 500+ distinct sourced topics and an isolated launch package", () => {
  const channel = Channel.getChannel("critical-thread");
  const universe = Discovery.universe(channel);
  assert.ok(universe.count >= 500);
  assert.equal(new Set(universe.topics.map((topic) => topic.canonicalTopic.toLowerCase())).size, universe.count);
  assert.equal(new Set(universe.topics.map((topic) => topic.slug)).size, universe.count);
  for (const topic of universe.topics) {
    assert.equal(Research.auditTopic(topic).pass, true, topic.id);
    assert.notEqual(CriticalQuality.evaluateTopic(topic, universe.topics).decision, "BLOCK", topic.id);
  }
  const topic = universe.topics.find((item) => item.topic === "The Machine the Entire Chip Industry Depends On");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ct-e2e-"));
  try {
    const result = Rendering.buildPackage(topic, channel, temp, { render: false });
    assert.ok(Object.values(result.validations).every(Boolean));
    assert.ok(result.qualityGate.checked.includes("technical-credibility"));
    assert.equal(SharedQuality.engineFor("critical-thread"), CriticalQuality);
    assert.equal(Scripting.titleCandidates(topic).length, 20);
    assert.equal(Scripting.longToShortFactory(topic).length, 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, "thumbnail.json"), "utf8")).concepts.length, 5);
    const longForm = JSON.parse(fs.readFileSync(path.join(temp, "long-form-outline.json"), "utf8"));
    assert.deepEqual(longForm.targetMinutes, [8, 18]);
    assert.equal(longForm.sections.length, 8);
    assert.equal(longForm.titleCandidates.length, 20);
    assert.equal(longForm.standaloneShorts.length, 4);
    assert.ok(longForm.evidence.length >= 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, "metadata.json"), "utf8")).uploadChannel, "critical-thread");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("The Hidden Logic of Things has 500+ unique research questions and an evidence-gated launch batch", () => {
  const channel = Channel.getChannel("behind-the-ordinary");
  const universe = Discovery.universe(channel);
  assert.equal(universe.stats.total, 525);
  assert.equal(universe.stats.validated_candidates, 525);
  assert.equal(new Set(universe.topics.map((topic) => topic.question.toLowerCase())).size, 525);
  assert.deepEqual(universe.stats.categories, {
    "EVERYDAY MYSTERIES": 105, "HIDDEN ENGINEERING": 105, "STRANGE ORIGINS": 105, "DESIGN DECISIONS": 105, "ORDINARY SYSTEMS": 105,
  });
  for (const topic of universe.topics) assert.notEqual(BehindQuality.evaluateTopic(topic, universe.topics).decision, "BLOCK", topic.id);
  const discovered = Discovery.discover(channel, { limit: 50 });
  const used = Discovery.usedIds(channel);
  assert.equal(discovered.length, universe.topics.filter((item) => item.productionReady === true && !used.has(item.id)).length, "unresearched or already-used questions cannot enter production discovery");
  assert.ok(discovered.every((item) => item.researchStatus === "VERIFIED"));
  const topic = discovered[0];
  assert.ok(topic, "at least one verified unused BTO topic must remain discoverable");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "bto-e2e-"));
  try {
    const plan = require("../../core/growth").planShort(channel, topic.id, { skipDuplicate: true });
    const result = Rendering.buildPackage(topic, channel, temp, { render: false, growthPlan: plan });
    assert.ok(Object.values(result.validations).every(Boolean));
    assert.equal(SharedQuality.engineFor("behind-the-ordinary"), BehindQuality);
    assert.equal(Scripting.titleCandidates(topic).length, 20);
    assert.equal(Scripting.longToShortFactory(topic).length, 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, "thumbnail.json"), "utf8")).maxWords, 4);
    assert.equal(JSON.parse(fs.readFileSync(path.join(temp, "metadata.json"), "utf8")).uploadChannel, "behind-the-ordinary");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("ImpossibleBrief pipeline persists named validation evidence", () => {
  const channel = Channel.getChannel("impossible-brief");
  const topic = Discovery.universe(channel).topics.find((item) => item.topic === "What If Gravity Doubled Tomorrow?");
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "ib-validation-"));
  try {
    require("../../core/pipeline/impossible-brief").writeValidationEvidence({ validations: { science: true, timing: false } }, topic, channel, output);
    const evidence = JSON.parse(fs.readFileSync(path.join(output, "validations.json"), "utf8"));
    assert.equal(evidence.passed, false);
    assert.deepEqual(evidence.failed, ["timing"]);
    assert.deepEqual(evidence.checks, { science: true, timing: false });
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
});

test("portfolio scheduling serializes shared render/upload resources", () => {
  const plan = Scheduler.portfolioPlan(new Date("2030-01-01T12:00:00Z"));
  assert.equal(plan.channels.length, 4);
  assert.equal(plan.resourceLimits.maxConcurrentRenders, 1);
  assert.equal(plan.resourceLimits.maxConcurrentUploads, 1);
  assert.ok(plan.queue.every((task) => task.renderLane === 0 && task.uploadLane === 0));
});

test("retention learning only accepts samples from the selected channel", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ib-memory-"));
  const base = Channel.getChannel("impossible-brief");
  const fake = { ...base, paths: { ...base.paths, memory: temp } };
  try {
    const result = Retention.learn([
      { channel: "failure-reconstructed", hookType: "archive", averagePercentageViewed: 99 },
      { channel: "impossible-brief", hookType: "consequence", averagePercentageViewed: 80 },
    ], fake);
    assert.equal(result.sampleSize, 1);
    assert.equal(result.status, "insufficient-data");
    assert.equal(result.learnedRules.find((rule) => rule.key === "hookType").value, null);
    assert.equal(result.learnedRules.find((rule) => rule.key === "hookType").confidence, "INSUFFICIENT_DATA");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("retention learning waits for a sample floor and aggregates repeated patterns", () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "ib-learning-"));
  const base = Channel.getChannel("impossible-brief");
  const fake = { ...base, paths: { ...base.paths, memory: temp } };
  try {
    const samples = [90, 88, 61, 63, 70].map((score, index) => ({
      channel: "impossible-brief", averagePercentageViewed: score,
      hookType: index < 2 ? "consequence" : index < 4 ? "question" : "statement",
    }));
    const result = Retention.learn(samples, fake);
    const hook = result.learnedRules.find((rule) => rule.key === "hookType");
    assert.equal(result.status, "sample-floor-met");
    assert.equal(hook.value, "consequence");
    assert.equal(hook.weakValue, "question");
    assert.equal(hook.confidence, "SUPPORTED");
    assert.ok(fs.existsSync(path.join(temp, "learning.json")));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("30-day failure simulation preserves four channels and blocks every wrong target", () => {
  const result = Simulation.simulate30Days();
  assert.equal(result.pass, true);
  assert.equal(result.channels["failure-reconstructed"].shorts, 30);
  assert.equal(result.channels["impossible-brief"].shorts, 30);
  assert.equal(result.channels["critical-thread"].shorts, 30);
  // Seven verified records, one quality-blocked: six Shorts, then research
  // gaps; question-only records are never published to fill the slot.
  assert.equal(result.channels["behind-the-ordinary"].shorts, 6);
  assert.equal(result.channels["behind-the-ordinary"].researchGapDays, 24);
  assert.equal(result.checks.behindOrdinaryEvidenceGate, true);
  assert.equal(result.productionReadiness.behindOrdinaryVerifiedInventoryForWindow, false);
  const researched = Simulation.simulate30Days({ initialInventory: { "failure-reconstructed": 38, "impossible-brief": 499, "critical-thread": 522, "behind-the-ordinary": 40 } });
  assert.equal(researched.channels["behind-the-ordinary"].shorts, 30, "a researched pool fills every day");
  assert.equal(result.injectedFailures.length, 13);
  assert.equal(result.wrongChannelGuards.length, 12);
  assert.ok(result.wrongChannelGuards.every((guard) => guard.blocked && !guard.mutationOccurred));
  assert.equal(result.tiktok.endingBacklog, 0);
  assert.equal(result.checks.schedulerRecovery, true);
  assert.equal(result.checks.analyticsCheckpointsScheduled, true);
  assert.equal(result.productionReady, false);
});

test("major CLI modules resolve channel-specific library paths", () => {
  const program = "const C=require('./core/channel-context');C.selectChannel('impossible-brief');const K=require('./lib/kutuphane');console.log(JSON.stringify(K.YOL))";
  const output = cp.execFileSync(process.execPath, ["-e", program], { cwd: ROOT, encoding: "utf8" });
  const paths = JSON.parse(output);
  assert.ok(paths.yayinlananlar.includes("channels/impossible-brief/state/published.json"));
  assert.ok(paths.uretim.includes("channels/impossible-brief/state/production"));
});

test("every notification title carries an unambiguous channel name", () => {
  const fr = Channel.getChannel("failure-reconstructed");
  const ib = Channel.getChannel("impossible-brief");
  const ct = Channel.getChannel("critical-thread");
  const bto = Channel.getChannel("behind-the-ordinary");
  assert.equal(Notifications.prefix("Short scheduled", fr), "[Failure Reconstructed] Short scheduled");
  assert.equal(Notifications.prefix("Short scheduled", ib), "[ImpossibleBrief] Short scheduled");
  assert.equal(Notifications.prefix("Short scheduled", ct), "[CriticalThread] Short scheduled");
  assert.equal(Notifications.prefix("Short scheduled", bto), "[The Hidden Logic of Things] Short scheduled");
});
