"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Channel = require("../../core/channel-context");
const Discovery = require("../../core/discovery");
const Growth = require("../../core/growth");
const Scripting = require("../../core/scripting");
const Rendering = require("../../core/rendering");
const TopicVisuals = require("../../core/rendering/topic-visuals");
const Seed = require("../../seed-comment");

test("researched IB/CT titles compete on quality instead of receiving an unconditional editorial lock", () => {
  for (const slug of ["impossible-brief", "critical-thread"]) {
    const channel = Channel.getChannel(slug);
    const topic = Discovery.universe(channel).topics.find((item) => item.researched && (item.editorialTitles || []).length);
    const plan = Growth.planShort(channel, topic.id, { legacyTitles: Scripting.titleCandidates(topic), skipDuplicate: true });
    const first = plan.titles.candidates[0];
    assert.equal(first.misleading, false);
    assert.ok(first.adjustedTotal >= 70);
    const bestEditorial = plan.titles.candidates.find((item) => item.source === "editorial" && !item.misleading);
    if (first.source !== "editorial" && bestEditorial) {
      assert.ok(first.adjustedTotal >= bestEditorial.adjustedTotal, `${slug}: weaker non-editorial title beat editorial`);
    }
  }
});

test("opening experiment: deterministic 50/50 and a motion opening leads with footage or a photo", () => {
  const counts = { motion: 0, number: 0 };
  for (let index = 0; index < 400; index += 1) counts[TopicVisuals.openingVariant({ slug: `topic-${index}` })] += 1;
  assert.ok(counts.motion > 160 && counts.number > 160, JSON.stringify(counts));
  assert.equal(TopicVisuals.openingVariant({ slug: "x" }), TopicVisuals.openingVariant({ slug: "x" }));
  const script = { targetSeconds: 12, claims: [{ text: "Up to 25% of northern heat rides one current.", start: 0, end: 4 }, { text: "Models say it weakens.", start: 4, end: 12 }] };
  const stills = [{ file: "Chart.png" }, { file: "Ocean.jpg" }];
  const clip = [{ id: 1, duration: 10 }];
  const motion = TopicVisuals.buildVisualPlan({ id: "IB-O" }, script, stills, [3, 3, 3, 3], 12, clip, { opening: "motion" });
  assert.equal(motion[0].type, "stock-video");
  const motionPhoto = TopicVisuals.buildVisualPlan({ id: "IB-O" }, script, stills, [3, 3, 3, 3], 12, [], { opening: "motion" });
  assert.equal(motionPhoto[0].type, "licensed-still");
  assert.equal(motionPhoto[0].kind, "photo");
  const number = TopicVisuals.buildVisualPlan({ id: "IB-O" }, script, stills, [3, 3, 3, 3], 12, clip, { opening: "number" });
  assert.equal(number[0].type, "number-card");
  assert.equal(TopicVisuals.evaluateVisualQuality(TopicVisuals.visualMetrics(motion)).reasons.includes("first visual does not cover the opening hook"), false);
});

test("on-screen words: the hook is up from the first frame; no dimmed end card stops the loop", () => {
  const motion = Rendering.overlayText({ channel: "impossible-brief", thumbnailText: "Atlantic current stops" }, 30, "motion");
  assert.match(motion, /text='ATLANTIC CURRENT STOPS'.*enable='lt\(t,2\)'/);
  // A photo opening on the "number" variant still shows the hook words.
  assert.match(Rendering.overlayText({ channel: "critical-thread", thumbnailText: "TUNNEL FIRE" }, 30, "number", "licensed-still"), /TUNNEL FIRE/);
  // A number-card opening already is the hook.
  assert.doesNotMatch(Rendering.overlayText({ channel: "critical-thread", thumbnailText: "ONE MACHINE" }, 30, "number", "number-card"), /ONE MACHINE/);
  for (const channel of ["impossible-brief", "critical-thread"]) {
    const text = Rendering.overlayText({ channel, thumbnailText: "X" }, 30, "motion");
    assert.doesNotMatch(text, /COMMENT BELOW|NEXT\?|drawbox/, channel);
  }
  assert.equal(Rendering.overlayText({ channel: "failure-reconstructed" }, 30, "number"), "");
});

test("loop ending: the last shot returns to the opening picture", () => {
  const stills = ["Portal.jpg", "Entrance.jpg", "Valley.jpg", "Ticket.jpg", "Ridge.jpg", "Fans.jpg", "Shelter.jpg"].map((file) => ({ file }));
  const claims = Array.from({ length: 7 }, (_, index) => ({ text: `Line ${index}.`, start: index * 3, end: index * 3 + 3 }));
  const plan = TopicVisuals.buildVisualPlan({ id: "CT-LOOP" }, { targetSeconds: 21, claims }, stills, Array(7).fill(3), 21, [], { opening: "motion" });
  const first = plan[0], last = plan[plan.length - 1];
  assert.equal(first.type, "licensed-still");
  assert.equal(last.loopBack, true);
  assert.equal(last.still, first.still);
  assert.notEqual(last.motion, first.motion, "a different camera move");
  assert.equal(TopicVisuals.evaluateVisualQuality(TopicVisuals.visualMetrics(plan)).decision, "PUBLISH");
  // Diagram or number-card openings are not echoed.
  const card = TopicVisuals.buildVisualPlan({ id: "CT-LOOP" }, { targetSeconds: 21, claims: [{ text: "It is 11.6 kilometres long.", start: 0, end: 3 }, ...claims.slice(1)] }, stills, Array(7).fill(3), 21, [], { opening: "number" });
  assert.equal(card[0].type, "number-card");
  assert.notEqual(card[card.length - 1].loopBack, true);
  // Too few pictures: variety wins over the loop.
  const few = TopicVisuals.buildVisualPlan({ id: "CT-LOOP" }, { targetSeconds: 15, claims: claims.slice(0, 5) }, stills.slice(0, 5), Array(5).fill(3), 15, [], { opening: "motion" });
  assert.notEqual(few[few.length - 1].loopBack, true);
  assert.equal(TopicVisuals.evaluateVisualQuality(TopicVisuals.visualMetrics(few)).decision, "PUBLISH");
});

function fakeYouTube({ privacy = "public", ownComment = false, readable = true } = {}) {
  const posts = [];
  const api = {
    data: async () => (readable ? { ok: true, veri: { items: ownComment ? [{ id: "own", snippet: { channelId: "UC1", topLevelComment: { snippet: { authorChannelId: { value: "UC1" } } } } }] : [] } } : { ok: false, neden: "403" }),
    post: async (url, body) => { posts.push(body); return { ok: true, veri: { id: "new-comment" } }; },
  };
  return { posts, yt: { getYouTubeClient: async () => ({ api }), videolar: async (unused, ids) => ids.map((id) => ({ id, status: { privacyStatus: privacy } })) } };
}

function tempChannel(slug, published) {
  const base = Channel.getChannel(slug);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "seed-"));
  fs.writeFileSync(path.join(state, "published.json"), JSON.stringify(published));
  return { channel: { ...base, paths: { ...base.paths, state } }, state };
}

test("seed comment: one discussion comment per public Short, never a second, never on private videos", async () => {
  const topic = Discovery.universe(Channel.getChannel("impossible-brief")).topics.find((item) => item.researched && item.misconception);
  const body = Seed.text(topic, "impossible-brief");
  assert.match(body, /^Myth check: /);
  assert.ok(Seed.CLOSINGS["impossible-brief"].some((line) => body.endsWith(line)));
  const rows = [{ format: "short", slug: topic.slug, videoId: "VID00000001" }];

  let { channel, state } = tempChannel("impossible-brief", rows);
  let fake = fakeYouTube({ privacy: "private" });
  await Seed.seed(channel, { yt: fake.yt });
  assert.equal(fake.posts.length, 0, "scheduled (private) videos wait");

  fake = fakeYouTube({ ownComment: true });
  await Seed.seed(channel, { yt: fake.yt });
  assert.equal(fake.posts.length, 0, "the channel's existing comment is respected");
  assert.equal(JSON.parse(fs.readFileSync(path.join(state, "seeded-comments.json"), "utf8")).VID00000001.source, "existing");

  ({ channel, state } = tempChannel("impossible-brief", rows));
  fake = fakeYouTube({ readable: false });
  await Seed.seed(channel, { yt: fake.yt });
  assert.equal(fake.posts.length, 0, "unreadable comments: nothing is written");

  fake = fakeYouTube();
  await Seed.seed(channel, { yt: fake.yt });
  assert.equal(fake.posts.length, 1);
  assert.equal(fake.posts[0].snippet.videoId, "VID00000001");
  await Seed.seed(channel, { yt: fake.yt });
  assert.equal(fake.posts.length, 1, "state prevents a second comment");
  await assert.rejects(Seed.seed(Channel.getChannel("failure-reconstructed"), { yt: fake.yt }), /pinned-comment/);
});
