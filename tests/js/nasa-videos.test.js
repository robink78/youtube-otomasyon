"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Videos = require("../../core/rendering/nasa-videos");
const TopicVisuals = require("../../core/rendering/topic-visuals");

const wiki = (title) => ({ url: `https://en.wikipedia.org/wiki/${title.replace(/ /g, "_")}` });
const sun = { topic: "If the Sun vanished right now, what would change first?", facts: [wiki("Sun")] };
const video = (title, extra = {}) => ({ media_type: "video", nasa_id: title.replace(/\W+/g, "_"), center: "GSFC", keywords: ["Sun"], description: "", ...extra, title });

test("NASA videos: data visualizations pass, broadcasts and people stories do not", () => {
  const terms = require("../../core/rendering/nasa-images").topicTerms(sun);
  assert.equal(Videos.acceptVideo(video("Active Region on the Sun Emits Another Flare", { keywords: ["Sun", "SDO"], description: "SDO captured this imagery." }), terms), true);
  assert.equal(Videos.acceptVideo(video("Sun-Earth Day 2009 Promo 1", { description: "A visualization promo." }), terms), false, "promo");
  assert.equal(Videos.acceptVideo(video("Will the Sun Ever Burn Out | We Asked a NASA Expert", { description: "animation" }), terms), false, "expert talk");
  assert.equal(Videos.acceptVideo(video("Sun mission launch coverage", { description: "visualization" }), terms), false, "broadcast");
  assert.equal(Videos.acceptVideo(video("The Sun in 3D", { description: "Scientists explain the new visualization." }), terms), false, "people story");
  assert.equal(Videos.acceptVideo(video("Gradient Sun", { description: "Solar wind particles." }), terms), false, "no visualization cue");
  assert.equal(Videos.acceptVideo({ ...video("Sun imagery"), media_type: "image" }, terms), false, "images are nasa-images.js");
});

test("NASA videos: renditions prefer ~medium then ~small MP4 over https", () => {
  assert.deepEqual(Videos.pickRenditions(["http://x/a~orig.mp4", "http://x/a~small.mp4", "http://x/a~medium.mp4", "http://x/a~mobile.mp4", "http://x/a.srt"]),
    ["https://x/a~medium.mp4", "https://x/a~small.mp4"]);
});

test("NASA videos: oversize renditions, short or black clips are skipped; credits recorded", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nasa-video-"));
  try {
    const items = [
      { title: "Huge Sun Flare Visualization", id: "BIG" },
      { title: "Short Sun Flare Visualization", id: "SHORT" },
      { title: "Dark Sun Flare Visualization", id: "DARK" },
      { title: "Graceful Sun Eruption Visualization", id: "GOOD" },
    ];
    const get = async (url, options = {}) => {
      if (url.includes("/search?")) return { status: 200, body: JSON.stringify({ collection: { items: items.map((item) => ({ href: `https://images-assets.nasa.gov/video/${item.id}/collection.json`, data: [video(item.title, { nasa_id: item.id, description: "SDO visualization" })] })) } }) };
      if (url.endsWith("collection.json")) { const id = url.split("/")[4]; return { status: 200, body: JSON.stringify([`http://images-assets.nasa.gov/video/${id}/${id}~medium.mp4`]) }; }
      if (options.method === "HEAD") return { status: 200, headers: { "content-length": String(url.includes("BIG") ? Videos.MAX_BYTES + 1 : 1000) } };
      return { status: 200, body: Buffer.from("mp4") };
    };
    const clips = await Videos.search(sun, directory, {
      get,
      probe: (file) => ({ duration: file.includes("SHORT") ? 4 : 30, width: 1280, height: 720 }),
      luma: (file) => ({ mean: file.includes("DARK") ? 6 : 60, min: 5 }),
    });
    assert.deepEqual(clips.map((clip) => clip.id), ["nasa-GOOD"]);
    assert.equal(clips[0].landscape, true);
    assert.equal(clips[0].origin, "nasa-video");
    assert.match(clips[0].sourceUrl, /images\.nasa\.gov\/details\/GOOD$/);
    assert.match(TopicVisuals.attributionLines([], clips)[0], /^- NASA video: NASA GOOD - Graceful Sun Eruption Visualization — /);
    assert.equal(fs.readdirSync(directory).filter((file) => file.endsWith(".mp4")).length, 1, "rejected downloads are deleted");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
