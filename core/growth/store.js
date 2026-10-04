"use strict";

// Channel-isolated growth state. Every path is derived from one channel slug;
// there is no API that reads or writes another channel's state.
//
//   channels/<slug>/state/growth/      shorts plans, performance, relationships
//   channels/<slug>/state/longform/    long-form lane (cycles, packages)
//   channels/<slug>/memory/growth-learning.json   shorts + longform learning
//
// GROWTH_STATE_ROOT redirects everything (tests and the 30-day simulation)
// so simulated data never touches production state.

const fs = require("fs");
const path = require("path");
const Channel = require("../channel-context");

function root(channel) {
  if (process.env.GROWTH_STATE_ROOT) return path.join(process.env.GROWTH_STATE_ROOT, channel.slug);
  return null;
}

function dirs(channel = Channel.getChannel()) {
  const sandbox = root(channel);
  const base = sandbox || path.join(Channel.ROOT, "channels", channel.slug);
  return Object.freeze({
    growth: path.join(base, "state", "growth"),
    shorts: path.join(base, "state", "growth", "shorts"),
    longform: path.join(base, "state", "longform"),
    memory: sandbox ? path.join(base, "memory") : channel.paths.memory,
    reports: sandbox ? path.join(base, "reports") : path.join(Channel.ROOT, "channels", channel.slug, "reports"),
  });
}

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporary, typeof value === "string" ? value : JSON.stringify(value, null, 2) + "\n");
  fs.renameSync(temporary, file);
  return file;
}

function file(channel, area, name) {
  const d = dirs(channel);
  if (!d[area]) throw new Error("Unknown growth state area: " + area);
  return path.join(d[area], name);
}

function readState(channel, area, name, fallback) { return read(file(channel, area, name), fallback); }
function writeState(channel, area, name, value) { return write(file(channel, area, name), value); }

// Guard used by every writer that receives a record: a record stamped with a
// different channel can never be written into this channel's state.
function assertSameChannel(channel, record, label = "record") {
  if (record && record.channel && record.channel !== channel.slug) {
    throw new Error(`CROSS_CHANNEL_WRITE_BLOCKED: ${label} belongs to ${record.channel}, not ${channel.slug}`);
  }
  return true;
}

module.exports = { dirs, read, write, file, readState, writeState, assertSameChannel };
