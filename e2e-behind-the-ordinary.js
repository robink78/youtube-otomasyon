#!/usr/bin/env node
"use strict";

// The Hidden Logic of Things end-to-end package dry run. It follows the same shared
// discovery → growth → render-package path as the other isolated channels and
// deliberately never calls the uploader.

const fs = require("fs");
const path = require("path");
const Channel = require("./core/channel-context");
const Discovery = require("./core/discovery");
const Growth = require("./core/growth");
const Rendering = require("./core/rendering");
const Scripting = require("./core/scripting");

const channel = Channel.getChannel("behind-the-ordinary");
const render = process.argv.includes("--render");
const requested = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const topic = Discovery.discover(channel, { limit: 50 }).find((item) => !requested || item.slug === requested || item.id === requested);
if (!topic) throw new Error(`Missing production-ready The Hidden Logic of Things topic: ${requested || "launch topic"}`);

const plan = Growth.planShort(channel, topic.id, {
  legacyTitles: Scripting.titleCandidates(topic),
  skipDuplicate: true,
  disclosureEnabled: true,
});
const outputDirectory = path.join(channel.paths.reports, "dry-runs", topic.slug);
const result = Rendering.buildPackage(topic, channel, outputDirectory, { render, growthPlan: plan });
const failed = Object.entries(result.validations).filter(([, value]) => !value).map(([name]) => name);
const report = {
  channel: channel.slug,
  dryRun: true,
  uploadAttempted: false,
  rendered: render,
  generatedAt: new Date().toISOString(),
  topicId: topic.id,
  topic: topic.topic,
  growthDecision: plan.readiness.decision,
  packageDecision: result.qualityGate.decision,
  pass: failed.length === 0,
  failed,
  result: {
    ...result,
    outputDirectory: path.relative(Channel.ROOT, result.outputDirectory),
  },
};
fs.mkdirSync(channel.paths.reports, { recursive: true });
fs.writeFileSync(path.join(channel.paths.reports, "e2e-results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(`The Hidden Logic of Things E2E: ${report.pass ? "PASS" : "FAIL"} — ${topic.topic}${render ? " (rendered)" : " (package)"}; upload disabled`);
if (failed.length) {
  console.error(`Failed validations: ${failed.join(", ")}`);
  process.exitCode = 4;
}
