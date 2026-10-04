"use strict";

const fs = require("fs");
const path = require("path");

function load(channel) {
  const file = path.join(path.dirname(channel.paths.topicUniverse), "quality-overrides.json");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return {}; }
}

function applyRaw(topic, patch) {
  if (!patch) return topic;
  const next = { ...topic, ...patch };
  delete next.narrationFirst;
  if (patch.narrationFirst && Array.isArray(topic.narration) && topic.narration.length) {
    next.narration = [{ ...topic.narration[0], text: patch.narrationFirst }, ...topic.narration.slice(1)];
  }
  return next;
}

function apply(channel, topics) {
  const overrides = load(channel);
  if (!Object.keys(overrides).length) return topics;
  return (topics || []).map((topic) => applyRaw(topic, overrides[topic.slug] || overrides[topic.id]));
}

module.exports = { load, applyRaw, apply };
