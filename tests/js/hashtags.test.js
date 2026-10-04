"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

const Hashtags = require("../../core/hashtags");
const Channel = require("../../core/channel-context");
const Discovery = require("../../core/discovery");
const Rendering = require("../../core/rendering");
const K = require("../../lib/kutuphane");
const Description = require("../../description-engine");

const hashtagsIn = (text) => String(text).match(/#[A-Za-z0-9]+/g) || [];

test("subject names become clean CamelCase hashtags", () => {
  assert.equal(Hashtags.toHashtag("Lower Van Norman Dam"), "#LowerVanNormanDam");
  assert.equal(Hashtags.toHashtag("Europa (moon)"), "#Europa");
  assert.equal(Hashtags.toHashtag("the Courrières mines"), "#CourrieresMines");
  assert.equal(Hashtags.toHashtag("Earth's inner core"), "#EarthsInnerCore");
  assert.equal(Hashtags.toHashtag("1999"), null, "a bare number is not a subject");
  assert.equal(Hashtags.toHashtag("A".repeat(40)), null, "over-long names are skipped");
});

test("subject comes from the short case name, then Wikipedia, preferring a letter-led tag", () => {
  assert.equal(Hashtags.subjectHashtag({ names: ["Van Norman Dam"], references: [{ url: "https://en.wikipedia.org/wiki/Lower_Van_Norman_Dam" }] }), "#VanNormanDam");
  assert.equal(Hashtags.subjectHashtag({ references: [{ source: "Wikipedia — Mont Blanc Tunnel" }] }), "#MontBlancTunnel");
  assert.equal(Hashtags.subjectHashtag({ names: ["787 battery", "the Boeing 787 batteries"] }), "#Boeing787Batteries");
  assert.equal(Hashtags.subjectHashtag({ references: [{ url: "https://www.nasa.gov/" }] }), null);
});

test("at most five hashtags: #shorts, broad, subject, category, second broad; no duplicates", () => {
  const broad = ["#science", "#whatif"];
  assert.deepEqual(Hashtags.compose({ format: "short", subject: "#Europa", category: "#space", broad }), ["#shorts", "#science", "#Europa", "#space", "#whatif"]);
  assert.deepEqual(Hashtags.compose({ format: "long", subject: "#Europa", category: "#space", broad }), ["#science", "#Europa", "#space", "#whatif"]);
  assert.deepEqual(Hashtags.compose({ format: "short", subject: null, category: "#Engineering", broad: ["#engineering", "#howitworks"] }), ["#shorts", "#engineering", "#howitworks"]);
  for (const tags of Object.values(Hashtags.BROAD)) assert.ok(tags.every((tag) => !/^#(viral|fyp|trending|foryou)/i.test(tag)), "no spam hashtags");
});

test("every ImpossibleBrief and CriticalThread topic gets a mapped category and three to five hashtags", () => {
  for (const slug of ["impossible-brief", "critical-thread"]) {
    const topics = Discovery.universe(Channel.getChannel(slug)).topics;
    for (const topic of topics) {
      assert.ok(Hashtags.CATEGORY[slug][String(topic.category).toUpperCase()], `${slug} category ${topic.category} has no hashtag`);
      const tags = Hashtags.forTopic(slug, topic);
      assert.ok(tags.length >= 3 && tags.length <= Hashtags.MAX_HASHTAGS, `${topic.slug}: ${tags.join(" ")}`);
      assert.deepEqual(tags.slice(0, 2), ["#shorts", Hashtags.BROAD[slug][0]]);
    }
  }
});

test("ImpossibleBrief and CriticalThread descriptions end with topic hashtags and carry the subject tag", () => {
  for (const [slug, wanted, expected] of [
    ["impossible-brief", "what-if-we-swam-in-europas-ocean", "#shorts #science #Europa #space #whatif"],
    ["critical-thread", "inside-the-system-built-around-road-tunnel-ventilation-system", "#shorts #engineering #MontBlancTunnel #infrastructure #howitworks"],
  ]) {
    const channel = Channel.getChannel(slug);
    const topic = Discovery.universe(channel).topics.find((item) => item.slug === wanted);
    assert.ok(topic, wanted);
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "hashtags-"));
    try {
      Rendering.buildPackage(topic, channel, temp, { render: false });
      const metadata = JSON.parse(fs.readFileSync(path.join(temp, "metadata.json"), "utf8"));
      const lastLine = metadata.description.trim().split("\n").pop();
      assert.equal(lastLine, expected);
      assert.deepEqual(hashtagsIn(lastLine), metadata.hashtags);
      assert.equal(hashtagsIn(metadata.description).length, 5);
      assert.equal(metadata.tags[0], slug === "impossible-brief" ? "Europa" : "Mont Blanc Tunnel");
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});

test("Failure Reconstructed descriptions lead with strong tags, name the case, and stay within five", () => {
  const topic = K.konular().find((item) => item.slug === "lower-van-norman-dam-1971");
  assert.ok(topic);
  const result = Description.olustur(topic, { format: "short", plan: { kumeler: [] } });
  const lastLine = result.metin.trim().split("\n").pop();
  assert.equal(lastLine, "#shorts #engineering #VanNormanDam #infrastructure #history");
  assert.equal(hashtagsIn(result.metin).length, 5);
});
