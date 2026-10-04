"use strict";

// SHORT → LONG FUNNEL and LONG → LONG SESSION ENGINE (PHASE 32D–32H, 32R).
//
// channels/<slug>/state/growth/relationships.json
//   { shortToLong: [...], longToLong: [...], manualActions: [...] }
// channels/<slug>/state/growth/clusters.json
//
// Cross-channel links are rejected at write time. YouTube's public Data API
// exposes no Shorts "Related Video" field (audited 2026-09-29), so every
// short→long link also produces a RELATED_VIDEO_MANUAL_ACTION_REQUIRED task.
// When YouTube ships an official field, setRelatedVideo() is the only place
// that needs to change.

const M = require("../../lib/metin");
const Config = require("./config");
const Store = require("./store");

const FILE = "relationships.json";
const TYPES = ["SOURCE_LONGFORM", "TOPIC_EXPANSION", "SAME_EVENT", "SAME_SYSTEM", "SAME_SERIES"];

function load(channel) {
  const value = Store.readState(channel, "growth", FILE, null) || { channel: channel.slug, shortToLong: [], longToLong: [], manualActions: [] };
  if (value.channel !== channel.slug) throw new Error(`FUNNEL_ISOLATION_VIOLATION: relationships for ${channel.slug} contain ${value.channel}`);
  return value;
}

function save(channel, value) { return Store.writeState(channel, "growth", FILE, value); }

function assertSameChannel(channel, a, b) {
  for (const item of [a, b]) {
    if (item && item.channel && item.channel !== channel.slug) {
      throw new Error(`CROSS_CHANNEL_LINK_BLOCKED: ${item.videoId || item.slug || "video"} belongs to ${item.channel}, not ${channel.slug}`);
    }
  }
}

// Relationship strength from shared facts: same subject/event, same system,
// same cluster. Returns null below the configured floor — never link
// unrelated videos to farm traffic.
function relate(shortTopic, longItem) {
  const subjectOverlap = M.kelimeBenzerlik(shortTopic.subject || "", longItem.subject || "");
  const titleOverlap = M.kelimeBenzerlik(shortTopic.title || "", longItem.title || "");
  const sameCluster = shortTopic.cluster && shortTopic.cluster === longItem.cluster;
  let type = null;
  let score = 0;
  if (longItem.derivedShortSlugs && longItem.derivedShortSlugs.includes(shortTopic.slug)) { type = "SOURCE_LONGFORM"; score = 1; }
  else if (subjectOverlap >= 0.6 || (shortTopic.subject && longItem.subject && shortTopic.subject.toLowerCase() === longItem.subject.toLowerCase())) {
    type = shortTopic.channel === "critical-thread" ? "SAME_SYSTEM" : "SAME_EVENT"; score = 0.85;
  } else if (sameCluster && (subjectOverlap >= 0.25 || titleOverlap >= 0.25)) { type = "TOPIC_EXPANSION"; score = 0.6; }
  else if (sameCluster) { type = "SAME_SERIES"; score = 0.4; }
  return type ? { type, score: Math.round(score * 100) / 100, reason: `${type.toLowerCase().replace(/_/g, " ")}; subject overlap ${subjectOverlap.toFixed(2)}${sameCluster ? ", same cluster " + shortTopic.cluster : ""}` } : null;
}

// Published long-form episodes for this channel (from the long-form lane).
function publishedLongs(channel) {
  const lane = Store.readState(channel, "longform", "episodes.json", []);
  return lane.filter((item) => item.channel === channel.slug && item.videoId && item.status === "PUBLISHED");
}

function relatedLongFor(channel, shortTopic, options = {}) {
  const config = Config.forChannel(channel);
  const candidates = (options.longs || publishedLongs(channel)).filter((item) => !item.channel || item.channel === channel.slug);
  let best = null;
  for (const item of candidates) {
    const rel = relate(shortTopic, item);
    if (!rel || rel.score < config.funnel.minimumRelationshipScore) continue;
    if (!best || rel.score > best.relationship.score) best = { long: item, relationship: rel };
  }
  return best;
}

function setRelatedVideo(channel, shortVideoId, longVideoId, context = {}) {
  const config = Config.forChannel(channel);
  if (config.funnel.relatedVideoApiSupported) {
    // Deliberately unimplemented until YouTube documents an official field.
    throw new Error("RELATED_VIDEO_API_NOT_IMPLEMENTED: enable only after an official API field exists");
  }
  return {
    status: "RELATED_VIDEO_MANUAL_ACTION_REQUIRED",
    channel: channel.slug,
    short_video_id: shortVideoId,
    target_long_video_id: longVideoId,
    target_long_video_title: context.longTitle || null,
    instruction: "YouTube Studio → Content → Short → Details → Related video → select the target long-form video on this same channel.",
  };
}

function linkShortToLong(channel, shortItem, longItem, relationship, options = {}) {
  assertSameChannel(channel, shortItem, longItem);
  if (!relationship || !TYPES.includes(relationship.type)) throw new Error("Invalid relationship type");
  const value = load(channel);
  const key = `${shortItem.videoId || shortItem.slug}->${longItem.videoId || longItem.slug}`;
  const existing = value.shortToLong.find((row) => row.key === key);
  const row = {
    key,
    channel: channel.slug,
    short_video_id: shortItem.videoId || null,
    short_slug: shortItem.slug,
    long_video_id: longItem.videoId || null,
    long_slug: longItem.slug,
    relationship_type: relationship.type,
    relationship_reason: relationship.reason,
    relationship_score: relationship.score,
    topic_cluster: shortItem.cluster || longItem.cluster || null,
    created_at: existing ? existing.created_at : (options.now || new Date()).toISOString(),
  };
  value.shortToLong = value.shortToLong.filter((item) => item.key !== key).concat(row);
  if (row.short_video_id && row.long_video_id) {
    const action = setRelatedVideo(channel, row.short_video_id, row.long_video_id, { longTitle: longItem.title });
    if (!value.manualActions.some((item) => item.short_video_id === action.short_video_id && item.target_long_video_id === action.target_long_video_id)) {
      value.manualActions.push({ ...action, created_at: row.created_at, done: false });
    }
  }
  if (options.write !== false) save(channel, value);
  return row;
}

// LONG → LONG: choose the next episode by narrative continuity (same event,
// same system, same cluster), never at random. Also returns a secondary.
function nextVideos(channel, longItem, library) {
  const candidates = (library || []).filter((item) => item.slug !== longItem.slug && (!item.channel || item.channel === channel.slug));
  const scored = candidates.map((item) => {
    const rel = relate({ ...longItem, channel: channel.slug }, item);
    const subject = M.kelimeBenzerlik(longItem.mechanism || "", item.mechanism || "");
    const score = (rel ? rel.score : 0) + subject * 0.3 + (item.videoId ? 0.1 : 0);
    return { item, score: Math.round(score * 100) / 100, reason: rel ? rel.reason : subject > 0 ? `shared mechanism vocabulary ${subject.toFixed(2)}` : null };
  }).filter((row) => row.reason).sort((a, b) => b.score - a.score);
  return {
    primary_next_video: scored[0] ? { slug: scored[0].item.slug, videoId: scored[0].item.videoId || null, title: scored[0].item.title, reason: scored[0].reason, score: scored[0].score } : null,
    secondary_next_video: scored[1] ? { slug: scored[1].item.slug, videoId: scored[1].item.videoId || null, title: scored[1].item.title, reason: scored[1].reason, score: scored[1].score } : null,
  };
}

function linkLongToLong(channel, fromItem, toItem, reason, options = {}) {
  assertSameChannel(channel, fromItem, toItem);
  const value = load(channel);
  const key = `${fromItem.slug}->${toItem.slug}`;
  value.longToLong = value.longToLong.filter((item) => item.key !== key).concat({ key, channel: channel.slug, from_slug: fromItem.slug, from_video_id: fromItem.videoId || null, to_slug: toItem.slug, to_video_id: toItem.videoId || null, reason, created_at: (options.now || new Date()).toISOString() });
  if (options.write !== false) save(channel, value);
  return value.longToLong[value.longToLong.length - 1];
}

// END SCREEN PLAN (PHASE 32H). The API cannot write end screens; the plan is a
// Studio task plus the narration bridge the script ends on.
function endScreenPlan(channel, longItem, next, options = {}) {
  const durationSeconds = options.durationSeconds || null;
  const start = durationSeconds ? Math.max(0, Math.round(durationSeconds - 20)) : null;
  const bridge = next && next.primary_next_video
    ? bridgeLine(channel.slug, longItem, next.primary_next_video)
    : null;
  return {
    primary_next_video: next ? next.primary_next_video : null,
    secondary_next_video: next ? next.secondary_next_video : null,
    playlist: options.playlist || longItem.cluster || null,
    subscribe_element: true,
    timing: { startSeconds: start, durationSeconds: 20, note: "final 20 s; narration must not end abruptly" },
    final_narration_transition: bridge,
    apiSupport: "UNSUPPORTED — YouTube Data API v3 has no end-screen write endpoint; configure in Studio (task emitted).",
  };
}

function bridgeLine(slug, from, to) {
  if (slug === "failure-reconstructed") return `And ${from.subject || "this"} wasn't the only time a hidden weakness decided everything — ${to.title} is next.`;
  if (slug === "impossible-brief") return `That is one impossible change. The next one — ${to.title} — breaks something different.`;
  if (slug === "behind-the-ordinary") return `That is one ordinary detail explained. ${to.title} hides the next reason in plain sight.`;
  return `And this is only one thread. ${to.title} shows what it connects to.`;
}

// CONTENT CLUSTERS (PHASE 32R): 1 long-form anchor + Shorts + future longs.
function updateCluster(channel, cluster, entry, options = {}) {
  if (entry.channel && entry.channel !== channel.slug) throw new Error(`CROSS_CHANNEL_CLUSTER_BLOCKED: ${entry.channel} → ${channel.slug}`);
  const clusters = Store.readState(channel, "growth", "clusters.json", { channel: channel.slug, clusters: {} });
  if (clusters.channel !== channel.slug) throw new Error("CLUSTER_ISOLATION_VIOLATION");
  const row = clusters.clusters[cluster] || { id: cluster, anchorLong: null, longs: [], shorts: [], futureLongs: [] };
  const list = entry.type === "long" ? row.longs : entry.type === "future-long" ? row.futureLongs : row.shorts;
  if (!list.some((item) => item.slug === entry.slug)) list.push({ slug: entry.slug, videoId: entry.videoId || null, title: entry.title || null });
  else list.forEach((item) => { if (item.slug === entry.slug && entry.videoId) item.videoId = entry.videoId; });
  if (entry.type === "long" && !row.anchorLong) row.anchorLong = entry.slug;
  clusters.clusters[cluster] = row;
  if (options.write !== false) Store.writeState(channel, "growth", "clusters.json", clusters);
  return row;
}

function clusterIntegrity(channel) {
  const clusters = Store.readState(channel, "growth", "clusters.json", { channel: channel.slug, clusters: {} });
  const problems = [];
  for (const [id, row] of Object.entries(clusters.clusters || {})) {
    if (row.anchorLong && !row.longs.some((item) => item.slug === row.anchorLong)) problems.push(`${id}: anchor ${row.anchorLong} not in longs`);
    // A topic may appear once as a Short AND once as its long-form episode
    // (that is the funnel); duplicates are only within the same content type.
    for (const [type, list] of [["long", row.longs], ["short", row.shorts]]) {
      const slugs = list.map((item) => item.slug);
      if (new Set(slugs).size !== slugs.length) problems.push(`${id}: duplicate ${type} member`);
    }
  }
  return { ok: problems.length === 0, problems, count: Object.keys(clusters.clusters || {}).length };
}

module.exports = {
  FILE, TYPES, load, save, relate, relatedLongFor, publishedLongs, setRelatedVideo, linkShortToLong,
  nextVideos, linkLongToLong, endScreenPlan, updateCluster, clusterIntegrity, assertSameChannel,
};
