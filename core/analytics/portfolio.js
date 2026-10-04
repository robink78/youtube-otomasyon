"use strict";

const fs = require("fs");
const path = require("path");
const Channel = require("../channel-context");
const Library = require("./library-health");

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function latestChannelSnapshot(channel) {
  const dir = path.join(channel.paths.analytics, "kanal");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((file) => file.endsWith(".json")).sort() : [];
  return files.length ? read(path.join(dir, files[files.length - 1]), null) : read(path.join(channel.paths.analytics, "baseline.json"), null);
}

function channelMetrics(channel) {
  const snapshot = latestChannelSnapshot(channel) || {};
  const published = read(path.join(channel.paths.state, channel.config.pathMode === "legacy-adapter" ? "yayinlananlar.json" : "published.json"), []);
  const health = Library.calculate(channel);
  return {
    channel: channel.slug,
    name: channel.name,
    subscribers: snapshot.subscribers ?? null,
    views: snapshot.views ?? null,
    watchHours: snapshot.watchHours ?? null,
    shortsFeedPercent: snapshot.shortsFeedPercent ?? null,
    ctr: snapshot.ctr ?? null,
    averagePercentViewed: snapshot.averagePercentViewed ?? null,
    subscribersPer1000Views: snapshot.subscribersPer1000Views ?? null,
    publishingSuccess: published.length ? Math.round(published.filter((item) => item.videoId).length / published.length * 1000) / 10 : null,
    libraryDaysRemaining: health.daysOfInventory,
    bestTopic: snapshot.bestTopic ?? null,
    bestCategory: snapshot.bestCategory ?? null,
    productionCost: snapshot.productionCost ?? null,
    systemHealth: health.acceptance.passes ? "healthy" : "library-low",
  };
}

function compare(rows) {
  const valid = (key) => rows.filter((row) => row[key] != null).sort((a, b) => b[key] - a[key]);
  const leader = (key) => valid(key)[0] ? valid(key)[0].channel : "unavailable";
  return { fasterGrowth: leader("subscribers"), betterRetention: leader("averagePercentViewed"), betterSubscriberConversion: leader("subscribersPer1000Views"), cheaperToProduce: valid("productionCost").sort((a, b) => a.productionCost - b.productionCost)[0]?.channel || "unavailable" };
}

function build() {
  const rows = Object.keys(Channel.registry().channels).map((slug) => channelMetrics(Channel.getChannel(slug)));
  return { generatedAt: new Date().toISOString(), channels: rows, comparison: compare(rows) };
}

module.exports = { latestChannelSnapshot, channelMetrics, compare, build };
