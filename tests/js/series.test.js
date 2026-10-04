"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Series = require("../../core/series");
const Rendering = require("../../core/rendering");

const fake = (slug) => ({ slug, config: { pathMode: slug === "failure-reconstructed" ? "legacy-adapter" : "isolated" }, paths: { state: "/nonexistent" } });

test("episode numbers: next Short is published count + 1; a published topic keeps its number", () => {
  const rows = [{ slug: "a", videoId: "x1" }, { slug: "b", videoId: "x2" }, { slug: "long", videoId: "x3", format: "long" }].filter((row) => (row.format || "short") === "short");
  assert.equal(Series.episodeNumber(fake("failure-reconstructed"), "new", rows), 3);
  assert.equal(Series.episodeNumber(fake("failure-reconstructed"), "a", rows), 1);
  assert.equal(Series.label(fake("critical-thread"), "new", rows), "CRITICAL THREAD #3");
  assert.equal(Series.descriptionLine(fake("impossible-brief"), "b", rows), "Impossible Brief · Episode 2 · One impossible scenario, worked through with real science, every day.");
  assert.equal(Series.label(fake("unknown-channel"), "x", rows), null);
});

test("the series tag sits above the hook in the channel accent for the first two seconds", () => {
  const overlay = Rendering.overlayText({ channel: "critical-thread", thumbnailText: "TUNNEL FIRE" }, 30, "number", "licensed-still", "CRITICAL THREAD #3");
  assert.match(overlay, /text='CRITICAL THREAD #3':fontcolor=0xffb347:fontsize=44.*y=262:enable='lt\(t,2\)'/);
  assert.ok(overlay.indexOf("CRITICAL THREAD #3") < overlay.indexOf("TUNNEL FIRE"));
  assert.doesNotMatch(Rendering.overlayText({ channel: "critical-thread", thumbnailText: "X" }, 30, "motion"), /THREAD #/, "no label, no tag");
});

test("Failure Reconstructed shows FAILURE FILE #n above its hook and in the description", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../shorts-yap.js"), "utf8");
  assert.match(source, /const SERI = require\("\.\/core\/series"\)\.label\(/);
  assert.match(source, /\\\\1c&H3687D8&\\\\fad\(0,220\)\}\$\{assKacis\(SERI\)\}/);
  const K = require("../../lib/kutuphane");
  const topic = K.konular().find((item) => item.slug === "lower-van-norman-dam-1971");
  const text = require("../../description-engine").olustur(topic, { format: "short", plan: { kumeler: [] } }).metin;
  assert.match(text, /Failure File · Episode \d+ · A new engineering failure, reconstructed every day\./);
  assert.match(text.trim().split("\n").pop(), /^#shorts #engineering #VanNormanDam #infrastructure #history$/, "five hashtags remain the last line");
  assert.equal((text.match(/#\w+/g) || []).length, 5, "the series line adds no hashtag");
});
