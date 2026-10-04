"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Stock = require("../../core/rendering/stock-footage");
const Nasa = require("../../core/rendering/nasa-images");
const TopicVisuals = require("../../core/rendering/topic-visuals");

const wiki = (title) => ({ url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` });
const tunnel = { topic: "Inside the System Built Around Road Tunnel Ventilation", canonicalTopic: "road tunnel ventilation system", facts: [wiki("Mont Blanc Tunnel")] };
const video = (id, slug, extra = {}) => ({ id, duration: 12, url: `https://www.pexels.com/video/${slug}-${id}/`,
  video_files: [{ width: 1080, height: 1920, file_type: "video/mp4", link: `https://videos.pexels.com/${id}.mp4` }], user: { name: "Author" }, ...extra });

test("stock footage: the page slug must name the topic, and people clips are rejected", () => {
  const terms = Nasa.topicTerms(tunnel);
  assert.deepEqual(Stock.slugWords("https://www.pexels.com/video/cars-driving-through-a-tunnel-5527770/"), ["cars", "driving", "through", "tunnel"]);
  assert.equal(Stock.accept(video(1, "cars-driving-through-a-tunnel"), terms), true);
  assert.equal(Stock.accept(video(2, "woman-walking-in-a-tunnel"), terms), false, "people");
  assert.equal(Stock.accept(video(3, "sunset-over-the-beach"), terms), false, "off topic");
  assert.equal(Stock.accept(video(4, "cars-driving-through-a-tunnel", { duration: 3 }), terms), false, "too short");
  // Seen in the first real dry run (2026-10-01): a place-name match and a uniformed crew.
  const subject = Stock.subjectTerms(tunnel);
  assert.equal(Stock.accept(video(5, "helicopter-on-a-landing-pad-near-mont-blanc"), terms, subject), false, "place name is not the subject");
  assert.equal(Stock.accept(video(6, "firefighter-loading-equipment-in-a-tunnel"), terms, subject), false, "uniformed crew");
  assert.equal(Stock.accept(video(7, "car-entering-a-road-tunnel-in-snow"), terms, subject), true);
  // Second dry run (run 36920857486): a metro station for an Alpine road tunnel.
  const roadTopic = "inside the system built around road tunnel ventilation road tunnel ventilation system roads and bridges";
  assert.equal(Stock.accept(video(8, "a-subway-train-is-traveling-through-a-tunnel"), terms, subject, roadTopic), false, "metro for a road tunnel");
  assert.equal(Stock.accept(video(9, "a-train-entering-a-tunnel"), terms, subject, roadTopic + " rail"), true, "train fits a rail topic");
  assert.equal(Stock.modeConflict(["cargo", "ship", "at", "port"], "the ports that move global trade"), false);
  // Third real render (2026-10-02): dolphins on Earth for Europa's buried ocean.
  const europa = "what if we swam in europa's ocean space";
  const europaSubject = new Set(["swam", "europa", "ocean"]);
  assert.equal(Stock.accept(video(10, "dolphins-leaping-in-open-ocean-at-sunset"), terms, europaSubject, europa), false, "Earth ocean for an off-world ocean");
  assert.equal(Stock.accept(video(11, "ocean-waves-and-currents"), terms, europaSubject, europa), false);
  assert.equal(Stock.offWorldConflict(["ocean", "planet", "from", "space"], europa), false, "space footage still fits");
  assert.equal(Stock.offWorldConflict(["ocean", "waves"], "how rogue waves sink ships"), false, "Earth topics keep Earth footage");

  // Regression: a road-stud/cat's-eye topic must not admit generic road footage.
  const studs = { topic: "Why Cat's Eyes Clean Themselves", canonicalTopic: "road cat's eyes", subject: "road stud", designDetail: "self-cleaning reflector mechanism" };
  const studTerms = Nasa.topicTerms(studs);
  const studSubject = Stock.subjectTerms(studs);
  assert.equal(Stock.accept(video(20, "aerial-view-of-a-road"), studTerms, studSubject, "road studs cat's eye reflectors"), false, "generic road alone is insufficient");
  assert.equal(Stock.accept(video(21, "close-up-road-stud-reflector"), studTerms, studSubject, "road studs cat's eye reflectors"), true, "distinctive stud/reflector evidence passes");
  const evidence = Stock.relevanceEvidence(video(20, "aerial-view-of-a-road"), studSubject);
  assert.deepEqual(evidence.matchedStrongTerms, []);
  assert.ok(evidence.genericTermsIgnored.includes("road"));
});

test("stock footage: only portrait HD MP4 files are used, closest to 1920 tall", () => {
  const file = Stock.pickFile({ video_files: [
    { width: 1920, height: 1080, file_type: "video/mp4", link: "landscape" },
    { width: 540, height: 960, file_type: "video/mp4", link: "sd" },
    { width: 2160, height: 3840, file_type: "video/mp4", link: "uhd" },
    { width: 1080, height: 1920, file_type: "video/mp4", link: "hd" },
  ] });
  assert.equal(file.link, "hd");
  assert.equal(Stock.pickFile({ video_files: [{ width: 1920, height: 1080, file_type: "video/mp4", link: "x" }] }), null);
});

test("stock footage: search authenticates only against the API, skips dark clips, and records credits", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stock-"));
  try {
    const calls = [];
    const get = async (url, options = {}) => {
      calls.push({ url, auth: options.headers && options.headers.Authorization });
      if (url.startsWith(Stock.API)) return { status: 200, body: JSON.stringify({ videos: [video(11, "tunnel-entrance-at-night"), video(12, "traffic-in-a-road-tunnel"), video(13, "man-in-a-tunnel")] }) };
      return { status: 200, body: Buffer.from("mp4") };
    };
    const clips = await Stock.search(tunnel, directory, "KEY", { get, brightness: (file) => (file.includes("11") ? 12 : 90) });
    assert.deepEqual(clips.map((clip) => clip.id), [12], "dark #11 and people #13 are skipped");
    assert.equal(clips[0].licence, "Pexels License");
    assert.match(clips[0].sourceUrl, /pexels\.com\/video\/traffic-in-a-road-tunnel-12/);
    assert.ok(calls.filter((call) => call.auth).every((call) => call.url.startsWith(Stock.API)), "the key is sent to the API only");
    assert.deepEqual(await Stock.search(tunnel, directory, "", { get }), [], "no key, no footage");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("visual plan places each clip once, spaced out, and counts footage as real imagery", () => {
  const claims = Array.from({ length: 6 }, (_, index) => ({ text: `Line ${index}.`, start: index * 5, end: index * 5 + 5 }));
  const stills = [{ file: "Tunnel.jpg" }, { file: "Fan.jpg" }];
  const clips = [{ id: 1, duration: 10 }, { id: 2, duration: 10 }, { id: 3, duration: 10 }, { id: 4, duration: 10 }];
  const plan = TopicVisuals.buildVisualPlan({ id: "CT-X" }, { targetSeconds: 30, claims }, stills, Array(12).fill(2.5), 30, clips);
  const shots = plan.map((shot, index) => ({ index, shot })).filter(({ shot }) => shot.type === "stock-video");
  assert.equal(shots[0].index, 1, "footage opens the body");
  assert.ok(shots.every(({ index }, i) => !i || index - shots[i - 1].index >= 4), "spaced at least four cuts apart");
  assert.equal(new Set(shots.map(({ shot }) => shot.clip.id)).size, shots.length, "no clip twice");
  assert.equal(TopicVisuals.visualMetrics(plan).realImageCount, 2 + shots.length);
  assert.ok(TopicVisuals.attributionLines([], [{ author: "A", licence: "Pexels License", sourceUrl: "u" }])[0].startsWith("- Stock footage: Pexels / A"));
});
