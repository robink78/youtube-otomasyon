"use strict";

// Growth engine (PHASE 35). Every test writes to a temporary GROWTH_STATE_ROOT
// sandbox and never touches the network or production state.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), "growth-test-"));
process.env.GROWTH_STATE_ROOT = SANDBOX;

const Channel = require("../../core/channel-context");
const Growth = require("../../core/growth");
const Store = require("../../core/growth/store");
const Context = require("../../core/growth/context");
const Hooks = require("../../core/growth/hooks");
const FirstSeconds = require("../../core/growth/first-seconds");
const Readiness = require("../../core/growth/readiness");
const Analytics = require("../../core/growth/analytics");
const Diagnosis = require("../../core/growth/diagnosis");
const Learning = require("../../core/growth/learning");
const Experiments = require("../../core/growth/experiments");
const Funnel = require("../../core/growth/funnel");
const Lane = require("../../core/growth/lane");
const Longform = require("../../core/growth/longform");
const Research = require("../../core/growth/research");
const Titles = require("../../core/growth/titles");
const Config = require("../../core/growth/config");
const Performance = require("../../core/growth/performance");

const SLUGS = ["failure-reconstructed", "impossible-brief", "critical-thread"];
const ch = (slug) => Channel.getChannel(slug);
const FR = () => ch("failure-reconstructed");
const IB = () => ch("impossible-brief");
const CT = () => ch("critical-thread");
const contexts = {};
const ctxFor = (slug) => (contexts[slug] = contexts[slug] || Context.build(ch(slug)));
const frTopic = (slug = "chernobyl-1986") => ctxFor("failure-reconstructed").inventory.find((topic) => topic.slug === slug);
const sampleRow = (channel, videoId, contentType, metrics, extra = {}) => ({ videoId, channel, contentType, metrics, ...extra });

test("growth config enforces candidate, experiment, hook, title and subscriber-weight invariants", () => {
  const config = Config.forChannel(FR());
  assert.equal(Config.validate(config), config);
  assert.throws(() => Config.validate({ ...config, selection: { ...config.selection, exploreRatio: 0.5 } }), /exploitRatio/);
  assert.throws(() => Config.validate({ ...config, candidatePool: { ...config.candidatePool, minimum: 10 } }), /candidatePool/);
});

// ---------------------------------------------------------------- isolation
test("multi-channel state isolation: every growth path is derived from one channel", () => {
  const dirs = SLUGS.map((slug) => Store.dirs(ch(slug)));
  for (const area of ["growth", "shorts", "longform", "memory", "reports"]) assert.equal(new Set(dirs.map((d) => d[area])).size, 3, area);
  for (const d of dirs) for (const other of dirs) if (d !== other) assert.ok(!d.growth.startsWith(other.growth));
  Store.writeState(FR(), "growth", "probe.json", { channel: "failure-reconstructed" });
  assert.equal(Store.readState(IB(), "growth", "probe.json", null), null);
  assert.throws(() => Store.assertSameChannel(FR(), { channel: "impossible-brief" }), /CROSS_CHANNEL_WRITE_BLOCKED/);
});

test("multi-channel learning isolation: foreign records are rejected and memory is per channel", () => {
  assert.throws(() => Learning.learn(FR(), [sampleRow("impossible-brief", "x1", "short", { views: 100 })]), /CROSS_CHANNEL_WRITE_BLOCKED/);
  Learning.learn(FR(), [sampleRow("failure-reconstructed", "f1", "short", { views: 1000, averagePercentageViewed: 80 })]);
  assert.equal(Learning.read(IB()).shorts.sampleSize, 0);
  Store.writeState(IB(), "memory", Learning.FILE, { channel: "failure-reconstructed", shorts: {}, longform: {} });
  assert.throws(() => Learning.read(IB()), /LEARNING_ISOLATION_VIOLATION/);
  fs.rmSync(Store.file(IB(), "memory", Learning.FILE));
});

test("multi-channel analytics isolation: a record stamped for another channel cannot be registered", () => {
  assert.throws(() => Analytics.registerVideo(FR(), { videoId: "v1", channel: "critical-thread", contentType: "short" }), /CROSS_CHANNEL_WRITE_BLOCKED/);
  Analytics.registerVideo(FR(), { videoId: "fr-v1", channel: "failure-reconstructed", contentType: "short", hookType: "hidden_cause" });
  assert.equal(Analytics.readAll(ch("critical-thread")).length, 0);
  assert.equal(Analytics.readAll(FR()).length, 1);
});

test("wrong-channel plan protection: a topic from another channel cannot be planned", () => {
  const foreign = { ...frTopic(), channel: "impossible-brief" };
  assert.throws(() => Growth.planShort(FR(), foreign, {}), /CROSS_CHANNEL_PLAN_BLOCKED/);
});

// ---------------------------------------------------------------- selection
test("duplicate production: published topics are never selected; duplicates block readiness", () => {
  const ctx = ctxFor("failure-reconstructed");
  const published = new Set(ctx.history.published.map((row) => row.slug));
  const selection = Growth.selectShortTopic(FR(), { date: "2026-10-01", ranked: Context.rank(FR(), { context: ctx }) });
  assert.ok(selection.selected);
  assert.ok(!published.has(selection.selected.topic.slug));
  const plan = Growth.planShort(FR(), frTopic(), { context: ctx, duplicate: "already produced" });
  assert.equal(plan.readiness.decision, "BLOCK");
  assert.ok(plan.readiness.hardFails.some((item) => /duplicate/.test(item)));
});

test("topic decision pool: 20–50 inspectable candidates and deterministic 75/25 mode", () => {
  const selection = Growth.selectShortTopic(FR(), { date: "2026-10-02", ranked: Context.rank(FR(), { context: ctxFor("failure-reconstructed") }) });
  assert.ok(selection.candidatePool.count >= 20 && selection.candidatePool.count <= 50);
  assert.equal(selection.candidatePool.candidates.length, selection.candidatePool.count);
  assert.ok(["EXPLOIT", "EXPLORE"].includes(selection.mode));
  assert.ok(selection.candidatePool.candidates.every((row) => row.viralScore != null && row.selectionScore != null && row.viralComponents));
  assert.equal(Config.forChannel(FR()).selection.exploitRatio, 0.75);
  assert.equal(Config.forChannel(FR()).selection.exploreRatio, 0.25);
});

test("topic scoring: editorial case scores A/B; templated or mechanism-less topics fall to D", () => {
  const ctx = ctxFor("failure-reconstructed");
  const good = Context.evaluate(frTopic(), ctx);
  assert.ok(["A", "B"].includes(good.score.bucket));
  assert.ok(good.score.VideoPotentialScore >= 70);
  for (const key of ["CuriosityScore", "HookPotentialScore", "SourceQualityScore"]) assert.ok(key in good.score.factors, key);
  const weak = Context.evaluate({ ...frTopic(), mechanism: "", id: "weak", slug: "weak" }, ctx, { skipDuplicate: true });
  assert.equal(weak.score.bucket, "D");
});

test("hook scoring: ≥10 candidates across families; forbidden and date openings are blocked", () => {
  const ctx = ctxFor("failure-reconstructed");
  const { hooks } = Context.evaluate(frTopic(), ctx);
  assert.ok(hooks.candidateCount >= 10);
  assert.ok(hooks.familyCount >= 5);
  assert.ok(hooks.selected && !hooks.selected.blocked);
  const config = Config.forChannel(FR());
  const hook = (spoken) => ({ family: "shocking_consequence", spoken, onScreen: "TEST", fields: ["consequence"], editorial: false });
  assert.ok(Hooks.score(hook("On April 26, 1986, a reactor exploded."), frTopic(), config).blocked, "date opening must be blocked");
  assert.ok(Hooks.score(hook("Subscribe to see why this reactor exploded."), frTopic(), config).blocked, "CTA opening must be blocked");
  assert.ok(!Hooks.score(hook("Chernobyl reactor 4 exploded during a safety test."), frTopic(), config).blocked);
});

test("first-3-sec planning: real evidence frame, on-screen text, cuts inside 3 s", () => {
  const ctx = ctxFor("failure-reconstructed");
  const { hooks } = Context.evaluate(frTopic(), ctx);
  const plan = FirstSeconds.plan(frTopic(), hooks, Config.forChannel(FR()), {});
  assert.ok(plan.score >= 70);
  const f = plan.First3SecondPlan;
  assert.ok(f.narration && f.onScreenText);
  assert.ok(f.cutTiming.every((t) => t <= 3));
  assert.notEqual(f.firstFrame.sourceClass, undefined);
});

test("quality block: hard fails force BLOCK regardless of the weighted score", () => {
  const plan = Growth.planShort(FR(), frTopic(), { context: ctxFor("failure-reconstructed"), render: { completed: true, syntheticVoice: false, hasAudio: true, width: 1080, height: 1920, durationSeconds: 30 } });
  assert.equal(plan.readiness.decision, "BLOCK");
  assert.ok(plan.readiness.hardFails.some((item) => /broken audio/.test(item)));
  const wrong = Readiness.shorts({ ...{ channel: "failure-reconstructed", topicScore: plan.topicScore, hooks: plan.hooks, script: plan.script.retention, firstSeconds: plan.first3Seconds, factual: plan.factual, integrity: plan.integrity, sourceQuality: { score: 90 }, pacing: plan.pacing, durationRange: [20, 40] }, metadata: { uploadChannel: "critical-thread" } }, Config.forChannel(FR()));
  assert.equal(wrong.decision, "BLOCK");
});

test("final readiness requires real rendered visual evidence and honors visual BLOCK", () => {
  const base = Growth.planShort(FR(), frTopic(), { context: ctxFor("failure-reconstructed") });
  const input = { channel: "failure-reconstructed", topicScore: base.topicScore, hooks: base.hooks, titles: base.titles,
    script: base.script.retention, firstSeconds: base.first3Seconds, factual: base.factual, integrity: base.integrity,
    sourceQuality: { score: 90 }, metadata: { uploadChannel: "failure-reconstructed" }, pacing: base.pacing, durationRange: [20, 40] };
  const missing = Readiness.shorts({ ...input, render: { completed: true, syntheticVoice: true, hasAudio: true, captionsBurned: true, width: 1080, height: 1920, durationSeconds: 30 } }, Config.forChannel(FR()));
  assert.equal(missing.decision, "BLOCK");
  assert.ok(missing.hardFails.some((item) => /missing measured rendered visual/.test(item)));
  const blocked = Readiness.shorts({ ...input, render: { completed: true, syntheticVoice: true, hasAudio: true, captionsBurned: true, width: 1080, height: 1920, durationSeconds: 30,
    visualQuality: { decision: "BLOCK", score: 40, reasons: ["semantic opening mismatch"] } } }, Config.forChannel(FR()));
  assert.equal(blocked.decision, "BLOCK");
  assert.ok(blocked.hardFails.some((item) => /semantic opening mismatch/.test(item)));
});

test("malformed English editorial hooks cannot override a better valid candidate", () => {
  const Hooks = require("../../core/growth/hooks");
  assert.deepEqual(Hooks.languageProblems("Why servers get only 5 to 15 minutes?"), ["malformed English question (missing auxiliary verb)"]);
  const channel = CT();
  const source = ctxFor("critical-thread").inventory.find((item) => item.slug === "what-quietly-depends-on-uninterruptible-power-supply");
  const topic = JSON.parse(JSON.stringify(source));
  topic.openingLine = "Why servers get only 5 to 15 minutes.";
  topic.narration[0] = topic.openingLine;
  topic.narrationBeats[0].text = topic.openingLine;
  assert.ok(topic);
  const plan = Growth.planShort(channel, topic, { context: ctxFor("critical-thread"), skipDuplicate: true });
  const malformed = plan.hooks.candidates.find((item) => /Why servers get only/.test(item.spoken));
  assert.ok(malformed && malformed.blocked);
  assert.doesNotMatch(plan.hooks.selected.spoken, /Why servers get only/);
  assert.equal(plan.script.claims[0].text, plan.hooks.selected.spoken);
});

test("Shorts regression safety: Failure Reconstructed source stays immutable while the selected factual hook is promoted", () => {
  const topic = frTopic();
  const original = [...topic.narration];
  const plan = Growth.planShort(FR(), topic, { context: ctxFor("failure-reconstructed") });
  assert.equal(plan.script.generator, "editorial case file + selected hook");
  assert.deepEqual(plan.script.originalLines, original);
  assert.deepEqual(topic.narration, original, "source case file must never be mutated");
  assert.equal(plan.script.lines[0].replace(/\.$/, ""), plan.hooks.selected.spoken.replace(/\.$/, ""));
  assert.ok(plan.script.openingRewrite.changed || plan.script.lines[0] === original[0]);
  const overlay = Growth.applyLegacyOverlay({ ...topic.raw, slug: topic.slug }, plan);
  assert.equal(overlay.sahneler[0].metin.replace(/\.$/, ""), plan.hooks.selected.spoken.replace(/\.$/, ""));
  assert.equal(overlay.baslik, plan.titles.selected.title);
  assert.equal(overlay.hook, plan.hooks.selected.onScreen || plan.hooks.selected.spoken);
  assert.equal(plan.readiness.decision, "PUBLISH");
});

// ---------------------------------------------------------------- analytics
test("missing analytics metrics stay UNAVAILABLE (never zero) and diagnosis waits for data", () => {
  const snap = Analytics.snapshot({ metrikler: { views: { durum: "ok", deger: 50 }, averageViewPercentage: { durum: "yetki yok", neden: "scope" } } });
  assert.equal(snap.metrics.average_percentage_viewed.value, null);
  assert.equal(snap.metrics.average_percentage_viewed.status, "UNAVAILABLE");
  assert.equal(snap.metrics.ctr.status, "NOT_COLLECTED");
  const d = Diagnosis.diagnose({ videoId: "a", channel: "failure-reconstructed", contentType: "short", metrics: Analytics.flatMetrics(snap) }, { short: {}, long: {} }, Config.forChannel(FR()));
  assert.deepEqual(d.diagnoses.map((row) => row.code), ["INSUFFICIENT_DATA"]);
});

test("legacy net subscriber snapshots are never mislabeled as gross acquisition", () => {
  const raw = { metrics: { views: { value: 1000, status: "DIRECTLY_MEASURED" }, subscribers_gained: { value: 2, status: "DIRECTLY_MEASURED", source: "Analytics API (net)" } } };
  const flat = Performance.flatSnapshot(raw);
  assert.equal(flat.subscribersGained, null);
  assert.equal(flat.netSubscribers, 2);
});

test("age normalization, subscriber conversion, plateau and breakout classification", () => {
  const metric = (value) => ({ value, status: "DIRECTLY_MEASURED" });
  const snap = (views, subscribers, avp, likes = 30) => ({ metrics: { views: metric(views), subscribers_gained: metric(subscribers), average_percentage_viewed: metric(avp), likes: metric(likes), comments: metric(2), shares: metric(1) } });
  const rows = [
    { videoId: "plateau", channel: "failure-reconstructed", contentType: "short", topicCluster: "spaceflight", checkpoints: { "12h": snap(1200, 1, 65), "24h": snap(1240, 1, 65) } },
    { videoId: "base-a", channel: "failure-reconstructed", contentType: "short", topicCluster: "aviation", checkpoints: { "12h": snap(800, 0, 60), "24h": snap(1000, 0, 60) } },
    { videoId: "base-b", channel: "failure-reconstructed", contentType: "short", topicCluster: "aviation", checkpoints: { "12h": snap(850, 0, 62), "24h": snap(1100, 0, 62) } },
    { videoId: "breakout", channel: "failure-reconstructed", contentType: "short", topicCluster: "spaceflight", checkpoints: { "12h": snap(1800, 12, 95, 220), "24h": snap(5000, 20, 95, 300) } },
  ];
  Performance.analyze(rows, Config.forChannel(FR()));
  assert.equal(rows[0].normalized.viewsPerHour, 51.67);
  assert.equal(rows[0].performance.plateau.code, "EARLY_DISTRIBUTION_PLATEAU");
  assert.equal(rows[0].performance.classification, "FAILED_TEST");
  assert.equal(rows[3].performance.classification, "BREAKOUT");
  assert.equal(rows[3].normalized.subscribersPer1000Views, 4);
  assert.ok(Config.forChannel(FR()).performance.growthScoreWeights.subscriberConversion > Config.forChannel(FR()).performance.growthScoreWeights.views);
});

test("historical legacy backfill imports only real files and preserves missing checkpoints", () => {
  const analyticsDir = fs.mkdtempSync(path.join(os.tmpdir(), "growth-backfill-"));
  fs.mkdirSync(path.join(analyticsDir, "video-real"));
  fs.writeFileSync(path.join(analyticsDir, "video-real", "1d.json"), JSON.stringify({ format: "short", sureSn: 31, toplandi: "2026-09-02T00:00:00.000Z", metrikler: { views: { durum: "ok", deger: 900, kaynak: "Data API" } } }));
  const base = FR();
  const channel = { ...base, paths: { ...base.paths, analytics: analyticsDir } };
  const result = Analytics.backfillLegacy(channel, { context: { history: { published: [{ videoId: "video-real", slug: "real-case", publishAt: "2026-09-01T00:00:00.000Z", format: "short" }] }, inventory: [{ slug: "real-case", cluster: "aviation" }] } });
  const row = Analytics.readAll(channel).find((item) => item.videoId === "video-real");
  assert.equal(result.snapshots, 1);
  assert.equal(row.checkpoints["24h"].metrics.views.value, 900);
  assert.equal(row.checkpoints["1h"], undefined);
});

test("Failure Reconstructed durable inventory contains 500 unique source-verified records", () => {
  const universe = require("../../core/growth/topic-model").durableInventory(FR());
  assert.ok(universe.stats.total >= 500);
  assert.equal(new Set(universe.topics.map((row) => row.topic_id)).size, universe.topics.length);
  assert.ok(universe.topics.every((row) => row.qualification_status === "QUALIFIED_SOURCE_VERIFIED" && row.sources.length));
  assert.ok(universe.stats.production_ready >= 377);
});

test("diagnosis thresholds: hook and retention failures fire only on the measured metric", () => {
  const config = Config.forChannel(FR());
  const t = config.diagnosis.shorts;
  const row = { videoId: "b", channel: "failure-reconstructed", contentType: "short", durationSeconds: 30, retention: [{ oran: 0.1, izleme: t.hookFailureRetentionAt3s - 0.1 }, { oran: 1, izleme: 0.2 }], metrics: { views: 5000, averagePercentageViewed: t.retentionFailureAvp - 5 } };
  const codes = Diagnosis.diagnose(row, { short: { n: 3 }, long: {} }, config).diagnoses.map((item) => item.code);
  assert.ok(codes.includes("HOOK_FAILURE"));
  assert.ok(codes.includes("RETENTION_FAILURE"));
  const healthy = Diagnosis.diagnose({ ...row, retention: null, metrics: { views: 5000, averagePercentageViewed: t.goodAvp + 5 } }, { short: { n: 3 }, long: {} }, config).diagnoses.map((item) => item.code);
  assert.ok(!healthy.includes("HOOK_FAILURE") && !healthy.includes("RETENTION_FAILURE"));
});

test("Shorts and long-form analytics separation: baselines are computed per content type", () => {
  const rows = [
    sampleRow("failure-reconstructed", "s1", "short", { views: 1000, averagePercentageViewed: 90 }),
    sampleRow("failure-reconstructed", "s2", "short", { views: 3000, averagePercentageViewed: 70 }),
    sampleRow("failure-reconstructed", "l1", "long", { views: 200, averagePercentageViewed: 40 }),
  ];
  const b = Analytics.baselines(FR(), rows);
  assert.equal(b.short.n, 2);
  assert.equal(b.long.n, 1);
  assert.equal(b.long.views, 200);
  assert.notEqual(b.short.averagePercentageViewed, b.long.averagePercentageViewed);
});

test("Shorts and long-form learning separation: each block learns only from its own type", () => {
  const records = [
    ...Array.from({ length: 6 }, (_, i) => sampleRow("failure-reconstructed", `s${i}`, "short", { views: 1000 + i, averagePercentageViewed: 70 + i }, { hookType: "hidden_cause" })),
    ...Array.from({ length: 2 }, (_, i) => sampleRow("failure-reconstructed", `l${i}`, "long", { views: 300, averagePercentageViewed: 40, watchHoursPer1000Views: 50 }, { coldOpenType: "hidden_cause" })),
  ];
  const learned = Learning.learn(FR(), records, { write: false });
  assert.equal(learned.shorts.sampleSize, 6);
  assert.equal(learned.longform.sampleSize, 2);
  assert.ok(learned.shorts.observations.every((row) => Learning.DIMENSIONS.shorts.includes(row.dimension)));
});

test("experiment metadata: one variable, deterministic arm, idempotent assignment", () => {
  assert.throws(() => Experiments.create(FR(), { contentType: "short", variable: ["hook_style", "duration"] }), /one variable/);
  const exp = Experiments.create(FR(), { contentType: "short", variable: "hook_style", hypothesis: "hidden-cause hooks retain better", control: "shocking_consequence", variant: "hidden_cause", metric: "averagePercentageViewed" });
  assert.equal(exp.status, "RUNNING");
  const a = Experiments.assign(FR(), "short", "chernobyl-1986");
  const b = Experiments.assign(FR(), "short", "chernobyl-1986");
  assert.deepEqual(a, b);
  assert.ok(["control", "variant"].includes(a.arm));
  assert.throws(() => Experiments.create(FR(), { contentType: "short", variable: "duration" }), /already running/);
  assert.equal(Experiments.load(IB()).experiments.length, 0);
});

// ---------------------------------------------------------------- long-form
test("LongFormPotentialScore: factors, bucket and deterministic ranking", () => {
  const ctx = ctxFor("failure-reconstructed");
  const p = Context.evaluateLong(frTopic("challenger-1986"), ctx);
  assert.ok(Number.isFinite(p.LongFormPotentialScore));
  assert.ok(["A", "B", "C", "D"].includes(p.bucket));
  for (const key of ["DepthPotential", "SourceDepth", "EngineeringOrScientificDepth", "ShortsEvidence"]) assert.ok(key in p.factors, key);
  const list = Lane.candidates(FR(), ctx);
  assert.ok(list.length > 10);
  for (let i = 1; i < list.length; i++) assert.ok({ A: 0, B: 1, C: 2 }[list[i - 1].potential.bucket] <= { A: 0, B: 1, C: 2 }[list[i].potential.bucket]);
});

function seedDeep(channel, topic, count = 90) {
  const claims = Array.from({ length: count }, (_, i) => ({ text: `Deep fact number ${i} about the ${topic.subject} case establishes one specific detail of evidence here.`, role: ["event", "cause", "background", "aftermath"][i % 4], section: "Investigation", source: `Wikipedia — ${topic.subject}`, url: "https://en.wikipedia.org/wiki/X", verbatim: false, licence: "CC BY-SA 4.0" }));
  Store.writeState(channel, "longform", `research/${topic.slug}.deep.json`, { channel: channel.slug, slug: topic.slug, article: String(topic.subject), claims, status: "OK" });
}

// A writer that paraphrases (never repeats 9 consecutive source words) and
// cites claim ids — the contract the real LLM writer must meet.
function paraphraseWriter(wordsPerClaim) {
  return async ({ pkg, plan }) => ({
    generator: "test-writer",
    sections: plan.sections.map((section) => ({
      section: section.section,
      // Distinct per claim (reversed word order + neutral connective words),
      // so no 9-word run matches the source and every scene has its own subject.
      paragraphs: section.claimIds.slice(0, 12).map((id) => {
        const source = pkg.claims.find((claim) => claim.id === id).text.replace(/[.!?]$/, "").split(/\s+/).reverse();
        const filler = ["and", "so", "then", "which", "meant", "that", "here"];
        const out = [];
        for (let k = 0; out.length < wordsPerClaim; k++) { out.push(source[k % source.length]); if (k % 3 === 2) out.push(filler[k % filler.length]); }
        return { claims: [id], text: out.join(" ") + "." };
      }),
    })),
  });
}

test("long-form quality gate: too little evidence is blocked, never padded", async () => {
  const pkg = await Longform.buildPackage(FR(), "challenger-1986", { research: false, write: false });
  assert.equal(pkg.readiness.decision, "BLOCK");
  assert.ok(pkg.readiness.hardFails.some((item) => /INSUFFICIENT_DEPTH/.test(item)));
  assert.equal(pkg.script.generator, "deterministic-evidence");
});

test("long-form quality gate: encyclopedia wording copied into narration is COPY_RISK", async () => {
  const topic = frTopic("columbia-2003");
  seedDeep(FR(), topic);
  const copier = async ({ pkg, plan }) => ({ generator: "copier", sections: plan.sections.map((section) => ({ section: section.section, paragraphs: section.claimIds.map((id) => ({ claims: [id], text: pkg.claims.find((c) => c.id === id).text })) })) });
  const pkg = await Longform.buildPackage(FR(), topic, { llm: copier, write: false });
  assert.equal(pkg.readiness.decision, "BLOCK");
  assert.ok(pkg.readiness.hardFails.some((item) => /COPY_RISK/.test(item)));
});

test("long-form: deterministic writer never narrates verbatim:false research", async () => {
  const topic = frTopic("columbia-2003");
  seedDeep(FR(), topic);
  const pkg = await Longform.buildPackage(FR(), topic, { write: false });
  const text = pkg.script.sections.flatMap((s) => s.paragraphs.map((p) => p.text)).join(" ");
  assert.ok(!/Deep fact number/.test(text));
  assert.ok(pkg.readiness.notes.some((note) => /LLM writer/.test(note)));
});

test("ResearchPackage reuse: same topic → cached package, reuse counted", async () => {
  const topic = frTopic("apollo-13-1970");
  const first = Longform.researchPackage(FR(), topic, {});
  const second = Longform.researchPackage(FR(), topic, {});
  assert.equal(second.id, first.id);
  assert.equal(second.reuseCount, 1);
  await assert.rejects(Longform.buildPackage(IB(), topic, { research: false, write: false }), /CROSS_CHANNEL_LONGFORM_BLOCKED/);
});

test("research deepening: sections become roled, sourced, rewrite-only claims; reference sections dropped", () => {
  const extract = "The bridge collapsed in 1907 during construction and killed seventy five workers on site.\n== Background ==\nThe cantilever design was chosen to cross the wide St. Lawrence river at Quebec.\n== Cause ==\nInvestigators found the chord members were undersized for the actual dead load.\n== References ==\nSmith, J. (1908). Report of the commission on the collapse of the bridge. Ottawa.";
  const claims = Research.claimsFromExtract(extract, "Quebec Bridge");
  assert.deepEqual(claims.map((c) => c.role), ["consequence", "background", "cause"]);
  assert.ok(claims.every((c) => c.verbatim === false && /wikipedia\.org/.test(c.url)));
  assert.ok(Research.copyRisk("Engineers said investigators found the chord members were undersized for the actual dead load.", claims));
  assert.equal(Research.copyRisk("The compression members were too small for the weight they carried.", claims), null);
});

test("thumbnail planning: ≥5 truthful concepts, mobile-readable text", async () => {
  const pkg = await Longform.buildPackage(FR(), "challenger-1986", { research: false, write: false });
  assert.ok(pkg.thumbnails.concepts.length >= Config.forChannel(FR()).longform.thumbnailConceptsMinimum);
  assert.ok(pkg.thumbnails.concepts.every((c) => c.truthfulness && c.textWords <= 4));
  assert.ok(pkg.thumbnails.selected);
});

test("long-form title engine: many candidates, truthful, no unsupported words", () => {
  const titles = Titles.generate(frTopic("challenger-1986"), Config.forChannel(FR()), "long", {});
  assert.ok(titles.count >= 15);
  assert.ok(titles.selected && !titles.selected.misleading);
  assert.deepEqual(titles.selected.unsupportedWords, []);
});

test("end-screen planning: same-channel next video, final 20 s, subscribe element", async () => {
  const pkg = await Longform.buildPackage(FR(), "challenger-1986", { research: false, write: false });
  const end = pkg.endScreenPlan;
  assert.ok(end.primary_next_video);
  assert.equal(end.timing.durationSeconds, 20);
  assert.equal(end.subscribe_element, true);
  const inventory = new Set(ctxFor("failure-reconstructed").inventory.map((topic) => topic.slug));
  assert.ok(inventory.has(end.primary_next_video.slug));
});

test("Short → Long relationship mapping: same event, series, and unrelated → no link", () => {
  const long = { slug: "challenger-1986", title: "Challenger", subject: "Challenger", cluster: "spaceflight-disasters" };
  assert.equal(Funnel.relate({ slug: "c", title: "Challenger", subject: "Challenger", cluster: "spaceflight-disasters", channel: "failure-reconstructed" }, long).type, "SAME_EVENT");
  assert.equal(Funnel.relate({ slug: "a", title: "Apollo 13", subject: "Apollo 13", cluster: "spaceflight-disasters" }, long).type, "SAME_SERIES");
  assert.equal(Funnel.relate({ slug: "t", title: "Tay Bridge", subject: "Tay Bridge", cluster: "bridge-failures" }, long), null);
});

test("cross-channel relationship blocking: links and clusters never cross channels", () => {
  const shortItem = { slug: "s", videoId: "S1", channel: "failure-reconstructed" };
  const longItem = { slug: "l", videoId: "L1", channel: "impossible-brief", title: "x" };
  assert.throws(() => Funnel.linkShortToLong(FR(), shortItem, longItem, { type: "SAME_EVENT", score: 0.9 }), /CROSS_CHANNEL_LINK_BLOCKED/);
  assert.throws(() => Funnel.linkLongToLong(FR(), { slug: "a", channel: "failure-reconstructed" }, longItem, "x"), /CROSS_CHANNEL/);
  const ok = Funnel.linkShortToLong(FR(), shortItem, { ...longItem, channel: "failure-reconstructed" }, { type: "SAME_EVENT", score: 0.9, reason: "same" });
  assert.ok(ok);
  const rel = Funnel.load(FR());
  assert.ok(rel.manualActions.some((item) => /RELATED_VIDEO/.test(item.type || item.code || JSON.stringify(item))));
  assert.equal(Funnel.load(IB()).shortToLong.length, 0);
});

test("content cluster integrity: members unique, anchor must be a long member", () => {
  Funnel.updateCluster(FR(), "spaceflight-disasters", { type: "long", slug: "challenger-1986", videoId: "L9", title: "Challenger", channel: "failure-reconstructed" });
  Funnel.updateCluster(FR(), "spaceflight-disasters", { type: "short", slug: "apollo-13-1970", videoId: "S9", title: "Apollo 13", channel: "failure-reconstructed" });
  const integrity = Funnel.clusterIntegrity(FR());
  assert.ok(integrity.ok, integrity.problems.join("; "));
  assert.throws(() => Funnel.updateCluster(FR(), "x", { type: "long", slug: "q", channel: "critical-thread" }), /CROSS_CHANNEL/);
});

test("long-form state isolation and scheduling isolation: lanes are per channel and idempotent per week", async () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const before = Lane.status(IB(), now);
  const first = await Lane.runCycle(FR(), { force: true, dryRun: true, research: false, now, maxCandidates: 1 });
  assert.ok(first.cycle.evaluated.length === 1);
  assert.ok(first.ran);
  assert.ok(Lane.TERMINAL.has(first.cycle.status), first.cycle.status);
  assert.deepEqual(Lane.status(IB(), now), before);
  const again = await Lane.runCycle(FR(), { now });
  assert.equal(again.ran, false);
  assert.match(again.status.reason, /already/);
  Store.writeState(IB(), "longform", "lane.json", { channel: "failure-reconstructed", cycles: [] });
  assert.throws(() => Lane.status(IB(), now), /LONGFORM_ISOLATION_VIOLATION/);
  fs.rmSync(Store.file(IB(), "longform", "lane.json"));
});

test("scheduler recovery: a cycle interrupted mid-run (RUNNING) is retried, a finished one is not", async () => {
  const now = new Date("2026-10-08T10:00:00Z");
  const cycleId = Lane.isoWeek(now);
  Store.writeState(IB(), "longform", "lane.json", { channel: "impossible-brief", cycles: [{ cycleId, status: "RUNNING", channel: "impossible-brief" }] });
  assert.equal(Lane.status(IB(), now).due, true);
  const run = await Lane.runCycle(IB(), { dryRun: true, research: false, now, maxCandidates: 1 });
  assert.ok(run.ran);
  assert.equal(Lane.status(IB(), now).due, false);
});

test("long-form duplicate prevention: a published episode leaves the candidate list and blocks as duplicate", async () => {
  const channel = ch("critical-thread");
  const ctx = ctxFor("critical-thread");
  const candidate = Lane.candidates(channel, ctx)[0];
  assert.ok(candidate);
  Store.writeState(channel, "longform", "episodes.json", [{ channel: "critical-thread", slug: candidate.topic.slug, status: "PUBLISHED", videoId: "LX", publishAt: "2026-09-01T00:00:00Z" }]);
  assert.ok(!Lane.candidates(channel, ctx).some((row) => row.topic.slug === candidate.topic.slug));
  const pkg = await Longform.buildPackage(channel, candidate.topic, { context: ctx, research: false, write: false });
  assert.ok(pkg.readiness.hardFails.some((item) => /duplicate episode/.test(item)));
  fs.rmSync(Store.file(channel, "longform", "episodes.json"));
});

test("long-form gate can PUBLISH when sourced, rewritten evidence supports the target length", async () => {
  const topic = frTopic("apollo-13-1970");
  seedDeep(FR(), topic, 140);
  const pkg = await Longform.buildPackage(FR(), topic, { llm: paraphraseWriter(26), write: false });
  assert.ok(pkg.script.estimatedMinutes >= 8 * 0.85, `minutes ${pkg.script.estimatedMinutes}`);
  assert.deepEqual(pkg.readiness.hardFails, []);
  assert.equal(pkg.readiness.decision, "PUBLISH", `score ${pkg.readiness.LongFormProductionReadinessScore}: ${JSON.stringify(pkg.readiness.dimensions)}`);
});

test("long-form source policy: fewer than two sources or no primary source is a hard block", async () => {
  const base = frTopic("apollo-13-1970");
  const wiki = base.sources.find((s) => /wikipedia/.test(s.url || "")) || base.sources[0];
  const topic = { ...base, raw: { ...base.raw, sourceProbe: true }, sources: [wiki] };
  const pkg = await Longform.buildPackage(FR(), topic, { research: false, write: false });
  assert.ok(pkg.readiness.hardFails.some((item) => /insufficient source coverage/.test(item)));
});

// ---------------------------------------------------------------- researched IB / CT records
test("researched CriticalThread record: editorial narration becomes layered, timed claims and the spoken opening is the hook", () => {
  const channel = ch("critical-thread");
  const ctx = ctxFor("critical-thread");
  const topic = ctx.inventory.find((item) => item.raw && item.raw.researched && item.narrationBeats.length);
  assert.ok(topic, "at least one researched CriticalThread record exists");
  const plan = Growth.planShort(channel, topic, { context: ctx, skipDuplicate: true });
  assert.equal(plan.script.generator, "editorial (researched record)");
  assert.deepEqual(plan.script.claims.map((claim) => claim.text.replace(/\.$/, "")), topic.narration.map((line) => line.replace(/\.$/, "")));
  assert.ok(plan.script.claims.every((claim) => claim.layer && claim.end > claim.start));
  assert.equal(plan.hooks.selected.spoken.replace(/\.$/, ""), topic.narration[0].replace(/\.$/, ""));
  assert.equal(plan.readiness.decision, "PUBLISH", plan.readiness.hardFails.join("; "));
  assert.ok(["A", "B"].includes(plan.topicScore.bucket));
});

test("researched ImpossibleBrief record keeps speculative layers and passes the gate", () => {
  const ctx = ctxFor("impossible-brief");
  const topic = ctx.inventory.find((item) => item.slug === "what-if-the-moon-disappeared-tonight");
  const plan = Growth.planShort(IB(), topic, { context: ctx, skipDuplicate: true });
  const layers = new Set(plan.script.claims.map((claim) => claim.layer));
  assert.ok(layers.has("KNOWN SCIENCE") && layers.has("ESTIMATED CONSEQUENCE"));
  assert.equal(plan.factual.unsupportedNumbers.length, 0);
  assert.equal(plan.readiness.decision, "PUBLISH");
});

test("hook compression never cuts numeric ranges or keeps prepositional fragments", () => {
  assert.equal(Hooks.compress("Ammonia production accounts for 1–2% of global energy consumption, and more.", 9), "Ammonia production accounts for 1–2% of global energy consumption");
  assert.equal(Hooks.compress("Without new EUV tools or service, fabs could not add capacity.", 9), null);
});

test("IB/CT research builder lint: opening budget, word range, layers and fact count", () => {
  const Builder = require("../../scripts/ib-ct-library/build.js");
  const rules = ch("critical-thread").config.retentionRules;
  const bad = Builder.lintRecord("critical-thread", { openingLine: "This opening line is far too long for two seconds of speech", thumbnailText: "X", facts: [], narration: [{ text: "This opening line is far too long for two seconds of speech", layer: "KNOWN SCIENCE", role: "HOOK" }] }, rules);
  assert.ok(bad.errors.some((e) => /opening/.test(e)));
  assert.ok(bad.errors.some((e) => /layer/.test(e)));
  assert.ok(bad.errors.some((e) => /sourced facts/.test(e)));
});

test("titles: a pattern used in the last three published titles loses points", () => {
  const topic = frTopic("challenger-1986");
  const config = Config.forChannel(FR());
  const colon = { title: "Challenger: The Seal That Failed", source: "editorial", pattern: Titles.pattern("Challenger: The Seal That Failed") };
  assert.equal(colon.pattern, "label-colon");
  const recent = ["Vesuvius 1944: An Eruption in the Middle of a War", "28 Volts vs 65: Apollo 13's Hidden Flaw", "General Slocum: The Inspection That Killed",
    "Eastern 212: What Failed First", "Inside Van Norman Dam: The Failure Chain"];
  assert.deepEqual(recent.slice(-3).map(Titles.pattern), ["label-colon", "label-colon", "inside"]);
  const fresh = Titles.scoreOne(colon, topic, config, "short", { publishedTitles: [] });
  const stale = Titles.scoreOne(colon, topic, config, "short", { publishedTitles: recent.slice(0, 4) });
  assert.equal(fresh.patternPenalty, 0);
  assert.equal(stale.patternPenalty, 11, "used 2x in the last three, and last");
  assert.equal(stale.adjustedTotal, Math.max(0, stale.total - 11), "the penalty comes off the same score");
  const why = { title: "Why Challenger Broke Apart 73 Seconds After Launch", source: "editorial", pattern: "why" };
  assert.equal(Titles.scoreOne(why, topic, config, "short", { publishedTitles: recent.slice(0, 4) }).patternPenalty, 0);
});

test("captions: each isolated channel keeps its own look, and CriticalThread has its own voice", () => {
  const Pacing = require("../../core/growth/pacing");
  const claims = [{ text: "A truck fire shut Mont Blanc for 3 years.", start: 0, end: 3 }];
  const ib = Pacing.ass(claims, Config.forChannel(ch("impossible-brief")).captions);
  const ct = Pacing.ass(claims, Config.forChannel(ch("critical-thread")).captions);
  assert.match(ib, /Style: Caption,DejaVu Sans,/);
  assert.match(ct, /Style: Caption,Liberation Sans Narrow,/);
  assert.match(ct, /Dialogue: .*A TRUCK FIRE/, "CriticalThread captions are capitals");
  assert.doesNotMatch(ib, /A TRUCK FIRE/);
  assert.match(ib, /\\c&HFFD200&/, "ImpossibleBrief cyan numbers");
  assert.match(ct, /\\c&H00B0FF&/, "CriticalThread amber numbers");
  assert.notEqual(ib.split("\n").find((line) => line.startsWith("Style:")), ct.split("\n").find((line) => line.startsWith("Style:")));
  const voices = ["failure-reconstructed", "impossible-brief", "critical-thread"].map((slug) => ch(slug).config.voice.voice);
  assert.equal(new Set(voices).size, 3, `three distinct narrators: ${voices.join(", ")}`);
});
