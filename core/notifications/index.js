"use strict";

const { getChannel } = require("../channel-context");

function prefix(message, channel = getChannel()) {
  return `[${channel.name}] ${String(message || "").replace(/^\[[^\]]+\]\s*/, "")}`;
}

function event(type, message, channel = getChannel(), details = {}) {
  return { channel: channel.slug, channelName: channel.name, type, title: prefix(message, channel), details, createdAt: new Date().toISOString() };
}

module.exports = { prefix, event };
