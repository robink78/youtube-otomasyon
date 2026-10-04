"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");
const Generator = require("../../scripts/generate-behind-the-ordinary-topics");
const Builder = require("../../scripts/ib-ct-library/build");
const Channel = require("../../core/channel-context");
const OAuthHealth = require("../../oauth-health");
const universe = () => JSON.parse(fs.readFileSync(path.join(ROOT, "channels/behind-the-ordinary/topics/topic-universe.json"), "utf8"));

test("BTO inventory: 500+ unique, grammatical research questions that never pre-claim an answer", () => {
  const { topics } = universe();
  assert.ok(topics.length >= 500);
  assert.equal(new Set(topics.map((topic) => topic.slug)).size, topics.length, "unique slugs");
  for (const topic of topics.filter((item) => item.researchStatus === "QUESTION_ONLY")) {
    assert.match(topic.coreQuestion, /^[A-Z][^?]*: what explains [^?]+\?$/, topic.coreQuestion);
    assert.equal(topic.productionReady, false);
    assert.deepEqual([topic.facts.length, topic.sources.length], [0, 0], "no unverified answer is stored");
  }
  assert.ok(!topics.some((topic) => /\bWhy Do The\b|\bUse Its\b/.test(topic.topic)), "no broken templated English");
});

test("BTO inventory: regenerating keeps every researched record (by inventory id)", () => {
  const current = universe();
  const regenerated = Generator.generate(current);
  const verified = (list) => list.filter((topic) => topic.researchStatus === "VERIFIED").map((topic) => `${topic.id}:${topic.slug}`).sort();
  assert.deepEqual(verified(regenerated.topics), verified(current.topics));
  assert.equal(regenerated.topics.length, current.topics.length);
});

test("BTO production-ready records carry primary sources and verbatim-quoted facts", () => {
  const ready = universe().topics.filter((topic) => topic.productionReady === true);
  assert.ok(ready.length >= 7, `launch batch present (${ready.length})`);
  for (const topic of ready) {
    assert.equal(topic.researchStatus, "VERIFIED");
    assert.ok(topic.sources.length >= 2, topic.slug);
    for (const source of topic.sources) assert.ok(Builder.hostAllowed(new URL(source.url).hostname, Builder.BTO_PRIMARY_HOSTS), `${topic.slug}: ${source.url}`);
    assert.ok(topic.facts.length >= 5, topic.slug);
    if (topic.slug !== "why-jeans-have-a-tiny-pocket") for (const fact of topic.facts) assert.ok(String(fact.quote || "").split(/\s+/).length >= 5, `${topic.slug}: fact without verbatim quote`);
    assert.ok(topic.narration.length >= 5 && topic.narration.length <= 8, topic.slug);
  }
});

test("the research builder's quote check tolerates typography but not paraphrase", () => {
  const source = "Kardach was later quoted as saying, “King Harald Bluetooth…was famous for uniting Scandinavia.”  It couldn’t be completed in time.";
  assert.ok(Builder.quoteFound(source, "it couldn't be completed in time"));
  assert.ok(Builder.quoteFound(source, "was famous for uniting   Scandinavia"));
  assert.ok(!Builder.quoteFound(source, "was known for uniting Scandinavia"), "a paraphrase is not a quote");
});

test("an onboarding channel with no credentials is 'setup pending', not a failure; partial setup is still CRITICAL", async () => {
  const bto = Channel.getChannel("behind-the-ordinary");
  const empty = { ...bto, credentials: () => ({}), expectedChannelId: () => null };
  const pending = await OAuthHealth.check(empty, { now: new Date("2026-10-03T12:00:00Z") });
  assert.equal(pending.status, "NOT_CONFIGURED");
  assert.equal(pending.uploadAllowed, false);
  assert.equal(OAuthHealth.aggregateReport([pending], []).status, "HEALTHY", "portfolio health stays green while setup is pending");
  const partial = { ...bto, credentials: () => ({ clientId: "123-x.apps.googleusercontent.com" }), expectedChannelId: () => null };
  const result = await OAuthHealth.check(partial, { now: new Date("2026-10-03T12:00:00Z"), inventory: { readyShorts: 5 } });
  assert.equal(result.status, "CRITICAL");
  const established = Channel.getChannel("critical-thread");
  assert.notEqual(established.config.onboarding, true, "existing channels are never treated as onboarding");
});

test("The Hidden Logic of Things uses its own light music moods, not the disaster beds", () => {
  const Muzik = require("../../lib/muzik");
  const source = fs.readFileSync(path.join(ROOT, "core/rendering/index.js"), "utf8");
  const block = source.slice(source.indexOf('"behind-the-ordinary": {'), source.indexOf("};", source.indexOf('"behind-the-ordinary": {')));
  const moods = [...block.matchAll(/"(everyday-[a-z]+)"/g)].map((match) => match[1]);
  assert.ok(moods.length >= 5);
  assert.ok(!/failures|disasters|accidents|hazards/.test(block));
  for (const mood of new Set(moods)) assert.ok(Muzik.RUH[mood], mood);
});

test("first-time authorization refuses a YouTube channel that already belongs to another configured channel", () => {
  const source = fs.readFileSync(path.join(ROOT, "youtube-yetki.js"), "utf8");
  const guard = source.indexOf("CHANNEL_ALREADY_ASSIGNED");
  assert.ok(guard > 0);
  assert.ok(guard < source.indexOf("fs.writeFileSync(envYol"), "checked before the token is stored locally");
  assert.ok(guard < source.indexOf("saveGitHub(tokenName"), "checked before anything is written to GitHub");
  assert.match(source, /allChannels\(\)\.filter\(\(item\) => item\.slug !== CHANNEL\.slug\)/);
});

test("BTO pictures come from the record's own articles; a surname match is not the object", () => {
  const Visuals = require("../../core/rendering/topic-visuals");
  assert.ok(Visuals.PERSON_FILE.test("Miss Constance Jeans, gagnante du 60 yards - btv1b530181337.jpg"));
  assert.ok(Visuals.PERSON_FILE.test("ConstanceJeans.jpg"));
  assert.ok(!Visuals.PERSON_FILE.test("Closeup of copper rivet on jeans.jpg"));
  assert.ok(!Visuals.PERSON_FILE.test("Clothing Rack of Jeans.jpg"));
  const rivets = universe().topics.find((topic) => topic.slug === "why-jeans-have-copper-rivets");
  assert.deepEqual(rivets.visualArticles, ["Jeans"]);
  const source = fs.readFileSync(path.join(ROOT, "core/rendering/topic-visuals.js"), "utf8");
  assert.match(source, /topic\.visualArticles/);
});

test("the evidence-gated channel selects from its verified pool; other channels keep the 20-topic minimum", () => {
  const Config = require("../../core/growth/config");
  const Growth = require("../../core/growth");
  const bto = Channel.getChannel("behind-the-ordinary");
  assert.equal(Config.forChannel(bto).candidatePool.minimum, 1);
  for (const slug of ["failure-reconstructed", "impossible-brief", "critical-thread"]) assert.equal(Config.forChannel(Channel.getChannel(slug)).candidatePool.minimum, 20, slug);
  const pick = Growth.selectShortTopic(bto, { date: "2026-10-03" });
  assert.ok(pick.selected, pick.reason);
  assert.equal(pick.selected.topic.channel, "behind-the-ordinary");
  assert.equal(pick.selected.topic.productionReady, true);
});

test("every production-ready BTO record yields at least 20 truthful title candidates (package gate)", () => {
  const os = require("node:os");
  const saved = process.env.GROWTH_STATE_ROOT;
  process.env.GROWTH_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "bto-titles-"));
  try {
    const Growth = require("../../core/growth");
    const bto = Channel.getChannel("behind-the-ordinary");
    for (const topic of universe().topics.filter((item) => item.productionReady === true)) {
      const plan = Growth.planShort(bto, topic.id, { skipDuplicate: true });
      assert.ok(plan.titles.candidates.filter((item) => !item.misleading).length >= 20, topic.slug);
    }
  } finally { if (saved === undefined) delete process.env.GROWTH_STATE_ROOT; else process.env.GROWTH_STATE_ROOT = saved; }
});
