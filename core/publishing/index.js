"use strict";

const Channel = require("../channel-context");

function assertUploadTarget(authenticatedChannelId, channel = Channel.getChannel()) {
  const expected = channel.expectedChannelId();
  if (!expected) throw new Error(`CHANNEL_ID_MISSING: ${channel.credentialNames.channelId[0]} is required; upload blocked`);
  if (authenticatedChannelId !== expected) throw new Error(`CHANNEL_MISMATCH: authenticated ${authenticatedChannelId}, expected ${expected} for ${channel.slug}; upload blocked`);
  return { ok: true, channel: channel.slug, authenticatedChannelId, expectedChannelId: expected };
}

async function validateBeforeUpload(api, channel = Channel.getChannel()) {
  return require("../../lib/yt").verifyChannelIdentity(api, channel);
}

module.exports = { assertUploadTarget, validateBeforeUpload };
