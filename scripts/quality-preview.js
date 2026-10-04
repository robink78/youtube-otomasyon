#!/usr/bin/env node
"use strict";

// QUALITY PREVIEW — renders one ImpossibleBrief / CriticalThread Short on the
// production path (growth plan + buildPackage) without uploading, so a render
// change can be inspected before it reaches a channel.
//
//   node scripts/quality-preview.js --channel impossible-brief <slug>
//
// Output: <channel reports>/previews/<slug>/ (MP4, render.json, validations).

const path = require("path");
const Channel = require("../core/channel-context");
const Discovery = require("../core/discovery");
const Rendering = require("../core/rendering");
const Scripting = require("../core/scripting");
const Growth = require("../core/growth");

const selected = Channel.selectFromArgv(process.argv.slice(2));
const channel = selected.channel;
if (channel.config.pathMode === "legacy-adapter") throw new Error("Failure Reconstructed previews run through shorts-sira.js <slug>");
const slug = selected.argv.find((arg) => !arg.startsWith("--"));
const topic = (Discovery.universe(channel).topics || []).find((item) => item.slug === slug || item.id === slug);
if (!topic) throw new Error(`Unknown ${channel.slug} topic: ${slug}`);

const plan = Growth.planShort(channel, topic.id, { legacyTitles: Scripting.titleCandidates(topic), skipDuplicate: true });
const outputDirectory = path.join(channel.paths.reports, "previews", topic.slug);
const result = Rendering.buildPackage(topic, channel, outputDirectory, { render: true, growthPlan: plan });
const failed = Object.entries(result.validations).filter(([, value]) => !value).map(([name]) => name);
console.log(`${channel.name} preview: ${topic.slug} — ${failed.length ? "FAIL " + failed.join(", ") : "PASS"}; upload disabled`);
console.log(JSON.stringify(result.render && result.render.video ? {
  durationSeconds: result.render.audio && result.render.audio.durationSeconds,
  distinctVisuals: result.render.video.distinctVisuals,
  realImageCount: result.render.video.realImageCount,
  visualChanges: result.render.video.visualChanges,
  opening: result.render.video.opening,
  visualQuality: result.render.video.visualQuality,
} : result.render, null, 2));
if (failed.length) process.exitCode = 4;
