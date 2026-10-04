#!/usr/bin/env node
// SEED COMMENT — ImpossibleBrief / CriticalThread: the channel's first comment
// on each public Short opens a discussion (the topic's myth or its central
// question) and asks for the next topic. Comments are an algorithm signal and
// a source of topic ideas. Failure Reconstructed uses pinned-comment.js.
//
// The YouTube API cannot pin comments: pinning is one click in Studio, and the
// log prints the link. A comment is written only on a public video, and never
// when the channel already has a top-level comment there (state can be stale;
// YouTube is the authority). If comments cannot be read, nothing is written.
//
// Usage: node seed-comment.js --channel impossible-brief [--dry-run]
"use strict";

const fs = require("fs");
const path = require("path");
const Channel = require("./core/channel-context");
const Discovery = require("./core/discovery");

const CLOSINGS = {
  "impossible-brief": [
    "Which impossible scenario should we test next? Name it below.",
    "What should we break next: the Moon, the Sun, or gravity itself?",
    "Give us a \"what if\" and we'll run the physics.",
  ],
  "critical-thread": [
    "Which hidden system should we trace next? Name it below.",
    "What everyday thing do you think has the most fragile supply chain?",
    "Name a system you rely on daily, and we'll follow the thread.",
  ],
  "behind-the-ordinary": [
    "Which ordinary object should we look at next?",
    "Name a tiny design detail you have always wondered about.",
    "What everyday thing deserves a closer look?",
  ],
};

function pick(list, key) {
  const hash = [...String(key)].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 7);
  return list[hash % list.length];
}

function text(topic, channelSlug) {
  const parts = [];
  if (topic.misconception) parts.push(`Myth check: ${topic.misconception}`);
  else if (topic.coreQuestion) parts.push(`The question behind this one: ${topic.coreQuestion}`);
  const closings = CLOSINGS[channelSlug];
  if (closings) parts.push(pick(closings, topic.slug || topic.id));
  return parts.join("\n\n");
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

async function seed(channel, options = {}) {
  if (channel.config.pathMode === "legacy-adapter") throw new Error("Failure Reconstructed uses pinned-comment.js");
  if (!CLOSINGS[channel.slug]) throw new Error(`no seed-comment closings for ${channel.slug}`);
  const stateFile = path.join(channel.paths.state, "seeded-comments.json");
  const state = readJson(stateFile, {});
  const topics = Discovery.universe(channel).topics || [];
  const records = readJson(path.join(channel.paths.state, "published.json"), [])
    .filter((row) => row && row.videoId && row.slug && (row.format || "short") === "short" && !state[row.videoId]);
  if (!records.length) { console.log(`[${channel.name}] no Short waiting for a seed comment`); return state; }
  const yt = options.yt || require("./lib/yt");
  // A YouTube write: refresh and pin the authenticated identity to this
  // channel before reading or posting anything.
  const { api } = await yt.getYouTubeClient(channel);
  const videos = await yt.videolar(api, records.map((row) => row.videoId));
  for (const row of records) {
    const video = videos.find((item) => item.id === row.videoId);
    if (!video || video.status.privacyStatus !== "public") { console.log(`  - ${row.slug}: not public yet`); continue; }
    const existing = await api.data(`commentThreads?part=snippet&maxResults=100&videoId=${row.videoId}`);
    if (!existing.ok) { console.log(`  - ${row.slug}: comments unreadable (${existing.neden}); skipped for safety`); continue; }
    const own = (existing.veri.items || []).find((thread) => {
      const author = thread.snippet.topLevelComment.snippet.authorChannelId;
      return author && author.value === thread.snippet.channelId;
    });
    if (own) {
      state[row.videoId] = { slug: row.slug, commentId: own.id, source: "existing" };
      console.log(`  = ${row.slug}: channel comment already present`);
      continue;
    }
    const topic = topics.find((item) => item.slug === row.slug) || {};
    const body = text(topic, channel.slug);
    if (!body) continue;
    if (options.dryRun) { console.log(`  ~ ${row.slug} (dry run):\n${body}`); continue; }
    const result = await api.post("commentThreads?part=snippet", { snippet: { videoId: row.videoId, topLevelComment: { snippet: { textOriginal: body } } } });
    if (result.ok) {
      state[row.videoId] = { slug: row.slug, commentId: result.veri.id, date: new Date().toISOString() };
      console.log(`  ✓ ${row.slug}: comment posted — pin it in Studio: https://studio.youtube.com/video/${row.videoId}/comments`);
    } else console.log(`  ✗ ${row.slug}: ${result.neden}`);
  }
  if (!options.dryRun) {
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2) + "\n");
  }
  return state;
}

module.exports = { CLOSINGS, text, seed };

if (require.main === module) {
  const selected = Channel.selectFromArgv(process.argv.slice(2));
  seed(selected.channel, { dryRun: selected.argv.includes("--dry-run") }).catch((error) => { console.error(`[seed-comment] ${error.message}`); process.exitCode = 1; });
}
