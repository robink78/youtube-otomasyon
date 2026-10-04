#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const Channel = require("./core/channel-context");
const Discovery = require("./core/discovery");
const Rendering = require("./core/rendering");

const channel = Channel.getChannel("impossible-brief");
const render = process.argv.includes("--render");
const wanted = [
  ["SPACE", "What If the Moon Disappeared Tonight?"],
  ["EARTH", "What If Earth Stopped Spinning for One Second?"],
  ["PHYSICS", "What If Gravity Doubled Tomorrow?"],
];
const topics = Discovery.universe(channel).topics || [];
const root = path.join(channel.paths.reports, "dry-runs");
const results = wanted.map(([category, title]) => {
  const topic = topics.find((item) => item.category === category && item.topic === title);
  if (!topic) throw new Error(`Missing dry-run topic: ${category} / ${title}`);
  return Rendering.buildPackage(topic, channel, path.join(root, topic.slug), { render });
});
const pass = results.every((result) => Object.values(result.validations).every(Boolean));
const portableResults = results.map((result) => {
  const copy = JSON.parse(JSON.stringify(result));
  copy.outputDirectory = path.relative(Channel.ROOT, result.outputDirectory);
  for (const key of ["audio", "video", "thumbnail"]) {
    if (copy.render[key] && copy.render[key].file) copy.render[key].file = path.relative(Channel.ROOT, copy.render[key].file);
  }
  return copy;
});
const report = { channel: channel.slug, dryRun: true, uploadAttempted: false, rendered: render, generatedAt: new Date().toISOString(), pass, results: portableResults };
fs.mkdirSync(channel.paths.reports, { recursive: true });
fs.writeFileSync(path.join(channel.paths.reports, "e2e-results.json"), JSON.stringify(report, null, 2) + "\n");
for (const result of results) console.log(`[${result.category}] ${result.slug}: ${Object.values(result.validations).every(Boolean) ? "PASS" : "FAIL"}${render ? " (rendered)" : ""}`);
console.log(`ImpossibleBrief E2E: ${pass ? "PASS" : "FAIL"} — upload disabled`);
if (!pass) process.exitCode = 4;
