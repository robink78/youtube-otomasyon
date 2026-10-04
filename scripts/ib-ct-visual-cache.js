#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const TopicVisuals = require("../core/rendering/topic-visuals");

async function main(argv = process.argv.slice(2)) {
  const [topicFile, outputDirectory] = argv;
  if (!topicFile || !outputDirectory) throw new Error("Usage: ib-ct-visual-cache.js <topic.json> <production-directory>");
  const topic = JSON.parse(fs.readFileSync(path.resolve(topicFile), "utf8"));
  const manifest = await TopicVisuals.prepareAssets(topic, path.resolve(outputDirectory));
  process.stdout.write(JSON.stringify({ topicId: manifest.topicId, realImageCount: manifest.stills.length }) + "\n");
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { main };
