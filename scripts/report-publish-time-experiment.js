"use strict";

const fs = require("fs");
const path = require("path");
const Channel = require("../core/channel-context");
const Experiment = require("../core/growth/publish-time-experiment");

function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; } }

const records = [];
for (const slug of Object.keys(Channel.registry().channels)) {
  const channel = Channel.getChannel(slug);
  const performance = read(path.join(channel.paths.state, "growth", "performance.json"), []);
  const published = read(path.join(channel.paths.state, channel.config.pathMode === "legacy-adapter" ? "yayinlananlar.json" : "published.json"), []);
  const byId = new Map(performance.map((row) => [row.videoId, row]));
  for (const publication of published) {
    if (!publication.videoId) continue;
    const existing = byId.get(publication.videoId) || {};
    records.push({ ...existing, channel: slug, videoId: publication.videoId, contentType: publication.format || existing.contentType || "short",
      title: publication.baslik || publication.title || existing.title, publishAt: publication.publishAt || existing.publishAt,
      topicCluster: existing.topicCluster || publication.topicCluster || null });
  }
}

const report = { generatedAt: new Date().toISOString(), ...Experiment.compare(records) };
const target = path.join(Channel.ROOT, "reports", "publish-time-experiment.json");
fs.writeFileSync(target, JSON.stringify(report, null, 2) + "\n");
console.log(target);
