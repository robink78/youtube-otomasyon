#!/usr/bin/env node
"use strict";

// CriticalThread dry run on the production path: the growth plan supplies the
// editorial script and pacing (as core/pipeline does), and a topic rejected
// only by the rendered-visual gate is skipped for the next qualified topic,
// exactly like a scheduled run. Upload is never attempted.

const fs = require("fs");
const path = require("path");
const Channel = require("./core/channel-context");
const Discovery = require("./core/discovery");
const Rendering = require("./core/rendering");
const Scripting = require("./core/scripting");
const Growth = require("./core/growth");
const { visualRejection, visualShortfall, MAX_VISUAL_PRECHECKS } = require("./core/pipeline/impossible-brief");

const MAX_ATTEMPTS = 3;
const channel = Channel.getChannel("critical-thread");
const render = process.argv.includes("--render");
const requested = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const topics = Discovery.universe(channel).topics || [];
const launch = requested
  ? topics.find((item) => item.slug === requested || item.id === requested)
  : topics.find((item) => item.topic === "The Machine the Entire Chip Industry Depends On");
if (!launch) throw new Error(`Missing CriticalThread dry-run topic: ${requested || "launch topic"}`);

function nextTopic(tried) {
  if (!tried.length) return launch;
  if (requested) return null;
  const selection = Growth.selectShortTopic(channel, { exclude: tried.map((item) => item.topicId) });
  return selection.selected ? topics.find((item) => item.id === selection.selected.topic.id) : null;
}

function portable(result) {
  const copy = JSON.parse(JSON.stringify(result));
  copy.outputDirectory = path.relative(Channel.ROOT, result.outputDirectory);
  for (const key of ["audio", "video", "thumbnail"]) {
    if (copy.render[key] && copy.render[key].file) copy.render[key].file = path.relative(Channel.ROOT, copy.render[key].file);
  }
  return copy;
}

const attempts = [];
let result = null;
let pass = false;
let prechecks = 0;
for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
  const topic = nextTopic(attempts);
  if (!topic) break;
  // Same visual pre-check as production: a picture-poor topic is skipped
  // before rendering and does not use up a render attempt.
  const shortfall = render && !requested ? visualShortfall(topic, path.join(channel.paths.reports, "dry-runs", topic.slug)) : null;
  if (shortfall && prechecks < MAX_VISUAL_PRECHECKS) {
    prechecks += 1;
    attempts.push({ topicId: topic.id, slug: topic.slug, topic: topic.topic, pass: false, visualPrecheck: shortfall });
    console.log(`CriticalThread E2E pre-check: skipped ${topic.topic} — ${shortfall}`);
    attempt -= 1;
    continue;
  }
  const plan = Growth.planShort(channel, topic.id, { legacyTitles: Scripting.titleCandidates(topic), skipDuplicate: true });
  const outputDirectory = path.join(channel.paths.reports, "dry-runs", topic.slug);
  result = Rendering.buildPackage(topic, channel, outputDirectory, { render, growthPlan: plan });
  pass = Object.values(result.validations).every(Boolean);
  const visualReason = !pass && render && !requested ? visualRejection(result, outputDirectory) : null;
  attempts.push({ topicId: topic.id, slug: topic.slug, topic: topic.topic, pass, visualRejection: visualReason });
  console.log(`CriticalThread E2E attempt ${attempt}: ${pass ? "PASS" : "FAIL"} — ${topic.topic}${render ? " (rendered)" : " (package)"}`);
  if (pass || !visualReason) break;
  console.log(`  visual gate BLOCK (controlled, topic skipped): ${visualReason}`);
}

const report = { channel: channel.slug, dryRun: true, uploadAttempted: false, rendered: render, generatedAt: new Date().toISOString(), pass, attempts, result: result && portable(result) };
fs.mkdirSync(channel.paths.reports, { recursive: true });
fs.writeFileSync(path.join(channel.paths.reports, "e2e-results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`CriticalThread E2E: ${pass ? "PASS" : "FAIL"} — ${result ? attempts[attempts.length - 1].topic : "no topic"}; upload disabled`);
if (!pass) {
  if (result) {
    const failed = Object.entries(result.validations).filter(([, value]) => !value).map(([name]) => name);
    console.error(`Failed validations: ${failed.join(", ")}`);
    for (const name of failed) {
      const reasons = result.validationReasons && result.validationReasons[name];
      if (Array.isArray(reasons) && reasons.length) console.error(`  ${name}: ${reasons.join("; ")}`);
    }
    if (render && result.render.video) {
      console.error(`Render evidence: duration=${result.render.video.durationSeconds}s resolution=${result.render.video.width}x${result.render.video.height} audio=${result.render.video.hasAudio} visualChanges=${result.render.video.visualChanges}`);
    }
  }
  process.exitCode = 4;
}
