"use strict";

const fs = require("fs");
const path = require("path");
const { getChannel } = require("../channel-context");

function assign(videoId, type, variants, channel = getChannel()) {
  const file = path.join(channel.paths.memory, "experiments.json");
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {}
  const variant = variants[Math.abs([...videoId].reduce((sum, char) => sum + char.charCodeAt(0), 0)) % variants.length];
  const row = { channel: channel.slug, videoId, type, variant, assignedAt: new Date().toISOString() };
  rows = rows.filter((item) => !(item.videoId === videoId && item.type === type));
  rows.push(row);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(rows, null, 2) + "\n");
  return row;
}

module.exports = { assign };
