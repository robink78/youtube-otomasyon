"use strict";

const fs = require("fs");
const path = require("path");
const { getChannel } = require("../channel-context");
const Overrides = require("../topic-overrides");

function universe(channel = getChannel()) {
  if (!fs.existsSync(channel.paths.topicUniverse)) return { topics: [] };
  const data = JSON.parse(fs.readFileSync(channel.paths.topicUniverse, "utf8"));
  data.topics = Overrides.apply(channel, data.topics || []);
  return data;
}

function usedIds(channel = getChannel()) {
  const files = ["published.json", "generated.json", "blocked.json"];
  const ids = new Set();
  for (const file of files) {
    try {
      const value = JSON.parse(fs.readFileSync(path.join(channel.paths.state, file), "utf8"));
      if (Array.isArray(value)) value.forEach((item) => ids.add(typeof item === "string" ? item : item.topicId));
      else Object.keys(value || {}).forEach((id) => ids.add(id));
    } catch (error) {}
  }
  return ids;
}

function discover(channel = getChannel(), options = {}) {
  const used = usedIds(channel);
  return universe(channel).topics
    .filter((topic) => topic.status === "qualified" && !used.has(topic.id))
    .filter((topic) => channel.slug !== "behind-the-ordinary" || topic.productionReady === true)
    .filter((topic) => !options.category || topic.category === options.category)
    .sort((a, b) => b.curiosityScore + b.visualPotential.score - a.curiosityScore - a.visualPotential.score)
    .slice(0, options.limit || 20);
}

module.exports = { universe, usedIds, discover };
