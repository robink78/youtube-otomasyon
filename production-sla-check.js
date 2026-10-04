// PRODUCTION SLA CHECK — one machine-readable answer for the daily watchdog.
//
// Exit codes:
//   0 = every production and notification assertion passed
//   2 = the SLA is not healthy (JSON is still emitted)
//   1 = the checker itself failed
//
// Usage:
//   node production-sla-check.js --channel failure-reconstructed
//   node production-sla-check.js --channel failure-reconstructed --verify-youtube
//   node production-sla-check.js --date 2026-09-27 --github-output
"use strict";

const fs = require("fs");
const path = require("path");
const Channel = require("./core/channel-context");
const Calendar = require("./core/scheduling/calendar");
const { jsonOku, jsonYaz, videoIdGecerli } = require("./lib/ortak");

function argValue(argv, name) {
  const exact = argv.indexOf(name);
  if (exact >= 0 && argv[exact + 1] && !argv[exact + 1].startsWith("--")) return argv[exact + 1];
  const inline = argv.find((item) => item.startsWith(name + "="));
  return inline ? inline.slice(name.length + 1) : null;
}

function ids(rows) {
  return new Set((Array.isArray(rows) ? rows : []).map((item) => typeof item === "string" ? item : item && (item.slug || item.topicId)).filter(Boolean));
}

// "Today" is the channel's local calendar day (Europe/Istanbul), never a
// rolling 24-hour window and never the runner's time zone. A publish instant
// is read in the publish zone: 18:00 New York on D is 01:00 Istanbul on D+1
// but still belongs to production day D.
function recordForDate(records, date, timeZone = Calendar.DEFAULT_TIME_ZONE, publishTimeZone = timeZone) {
  const rows = (Array.isArray(records) ? records : []).filter((item) => item && item.format !== "long");
  const scheduled = rows.filter((item) => Calendar.dayKey(item.publishAt, publishTimeZone) === date);
  const produced = rows.filter((item) => Calendar.dayKey(item.tarih || item.generatedAt, timeZone) === date);
  return (scheduled.length ? scheduled : produced).sort((a, b) => String(a.tarih || "").localeCompare(String(b.tarih || ""))).pop() || null;
}

function qualityFor(channel, slug) {
  if (!slug) return null;
  return jsonOku(path.join(channel.paths.packages, slug, "quality-gate.json"), null);
}

function isoDay(value, timeZone = Calendar.DEFAULT_TIME_ZONE) {
  return value ? Calendar.dayKey(value, timeZone) : null;
}

function durationSeconds(value) {
  const match = String(value || "").match(/^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/);
  if (!match) return null;
  return (+match[1] || 0) * 86400 + (+match[2] || 0) * 3600 + (+match[3] || 0) * 60 + (+match[4] || 0);
}

// The repository commit is useful operational state, but it cannot be the
// duplicate-prevention authority: an upload may have succeeded immediately
// before its state commit failed. The authenticated YouTube channel is the
// source of truth for whether today's Short slot is already occupied.
function youtubeVideoForDate(videos, date, timeZone = Calendar.DEFAULT_TIME_ZONE, publishTimeZone = timeZone) {
  return (Array.isArray(videos) ? videos : [])
    .filter((video) => {
      const seconds = durationSeconds(video && video.contentDetails && video.contentDetails.duration);
      const short = seconds != null && seconds <= 180;
      const day = isoDay(video && video.status && video.status.publishAt, publishTimeZone)
        || isoDay(video && video.snippet && video.snippet.publishedAt, publishTimeZone);
      return short && day === date;
    })
    .sort((a, b) => String((a.status && a.status.publishAt) || (a.snippet && a.snippet.publishedAt) || "")
      .localeCompare(String((b.status && b.status.publishAt) || (b.snippet && b.snippet.publishedAt) || "")))
    .pop() || null;
}

function evaluateSnapshot(snapshot) {
  const timeZone = snapshot.timeZone || Calendar.DEFAULT_TIME_ZONE;
  const record = recordForDate(snapshot.published, snapshot.date, timeZone, snapshot.publishTimeZone || timeZone);
  const slug = record && record.slug || null;
  const quality = snapshot.quality || null;
  const decision = quality && (quality.karar || quality.decision) || record && record.kalite || null;
  const finalGate = !quality || quality.asama === "final" || quality.stage === "final";
  const generated = ids(snapshot.generated);
  const produced = !!(slug && (generated.has(slug) || record));
  const remoteTodayVideo = snapshot.remoteTodayVideo || null;
  const videoId = record && record.videoId || remoteTodayVideo && remoteTodayVideo.id || null;
  const uploaded = !!(videoId && videoIdGecerli(videoId));
  const remotePublishAt = remoteTodayVideo && remoteTodayVideo.status && remoteTodayVideo.status.publishAt || null;
  const publishTimeZone = snapshot.publishTimeZone || timeZone;
  const scheduled = !!((record && record.publishAt && isoDay(record.publishAt, publishTimeZone) === snapshot.date)
    || (remotePublishAt && isoDay(remotePublishAt, publishTimeZone) === snapshot.date));
  const qualityPassed = !!(decision && decision !== "BLOCK" && finalGate);
  const notificationExists = !!(videoId && snapshot.notifications && snapshot.notifications["video:" + videoId]);
  const videoIdExists = uploaded && snapshot.remoteVideoExists !== false;
  const youtubeVerified = !!snapshot.youtubeVerified;
  const youtubeTodayExists = youtubeVerified && !!remoteTodayVideo;
  // Fail closed. An API/authentication failure is never interpreted as an
  // empty day, because doing so could upload a duplicate after a state-commit
  // failure. Recovery is authorized only by a successful remote absence check.
  const safeToRecover = youtubeVerified && !youtubeTodayExists;
  const productionReady = produced && uploaded && scheduled && videoIdExists && qualityPassed;
  const healthy = productionReady && notificationExists;
  return {
    date: snapshot.date,
    timeZone,
    deadlineUtc: snapshot.deadlineUtc || "16:30",
    channel: snapshot.channel,
    slug,
    produced,
    topicSelected: !!slug,
    scriptReady: produced,
    assetsReady: produced,
    renderReady: produced,
    uploaded,
    scheduled,
    youtubeUploaded: uploaded,
    youtubeScheduled: scheduled,
    videoId,
    videoIdExists,
    publishAt: record && record.publishAt || remotePublishAt,
    quality: decision,
    qualityGate: decision,
    qualityPassed,
    notificationExists,
    productionReady,
    youtubeVerified,
    youtubeTodayExists,
    remoteTodayVideoId: remoteTodayVideo && remoteTodayVideo.id || null,
    safeToRecover,
    automaticRecoveryStarted: !!snapshot.automaticRecoveryStarted,
    healthy,
    verification: youtubeVerified ? "youtube-api" : "repository-state",
  };
}

async function check(options = {}) {
  const channel = options.channel || Channel.getChannel();
  const legacy = channel.config.pathMode === "legacy-adapter";
  const timeZone = channel.config.timezone || Calendar.DEFAULT_TIME_ZONE;
  const publishTimeZone = Calendar.shortSchedule(channel).publishTimeZone;
  const date = options.date || Calendar.dayKey(new Date(), timeZone);
  const deadlineUtc = options.deadlineUtc || process.env.PRODUCTION_DEADLINE_UTC || "16:30";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(deadlineUtc)) throw new Error("PRODUCTION_DEADLINE_UTC must be HH:MM");
  const published = jsonOku(path.join(channel.paths.state, legacy ? "yayinlananlar.json" : "published.json"), []);
  const generated = jsonOku(path.join(channel.paths.state, legacy ? "uretilenler.json" : "generated.json"), []);
  const notificationsState = jsonOku(path.join(channel.paths.state, legacy ? "bildirim-durum.json" : "notification-state.json"), { gonderilen: {} });
  const record = recordForDate(published, date, timeZone, publishTimeZone);
  let remoteVideoExists;
  let remoteTodayVideo = null;
  let youtubeVerified = false;
  let youtubeError = null;
  if (options.verifyYouTube) {
    try {
      const yt = options.youtube || require("./lib/yt");
      const token = await yt.token(undefined, channel);
      const api = yt.istemci(token);
      await yt.verifyChannelIdentity(api, channel);
      const uploads = await yt.yuklemeler(api, 100);
      const idsToRead = [...new Set([...(uploads.ids || []), record && record.videoId].filter(Boolean))];
      const videos = idsToRead.length ? await yt.videolar(api, idsToRead) : [];
      remoteTodayVideo = youtubeVideoForDate(videos, date, timeZone, publishTimeZone);
      const recordedRemoteVideo = record && record.videoId ? videos.find((item) => item.id === record.videoId) : null;
      remoteVideoExists = record && record.videoId ? !!recordedRemoteVideo : !!remoteTodayVideo;
      // YouTube can omit status.publishAt after a scheduled video becomes
      // public. If the authenticated API still proves the exact registry ID
      // exists and the registry slot is today, prefer skipping to a duplicate.
      if (!remoteTodayVideo && recordedRemoteVideo && isoDay(record.publishAt, publishTimeZone) === date) remoteTodayVideo = recordedRemoteVideo;
      youtubeVerified = true;
    } catch (error) {
      remoteVideoExists = false;
      youtubeError = String(error.message || error).slice(0, 240);
    }
  }
  const result = evaluateSnapshot({
    date,
    timeZone,
    publishTimeZone,
    deadlineUtc,
    channel: channel.slug,
    published,
    generated,
    notifications: notificationsState.gonderilen || {},
    quality: qualityFor(channel, record && record.slug),
    remoteVideoExists,
    remoteTodayVideo,
    youtubeVerified,
    automaticRecoveryStarted: options.automaticRecoveryStarted,
  });
  if (youtubeError) result.youtubeError = youtubeError;
  return result;
}

function writeGitHubOutput(result, outputPath = process.env.GITHUB_OUTPUT) {
  if (!outputPath) return;
  const values = {
    healthy: result.healthy,
    production_ready: result.productionReady,
    today_video_scheduled: result.scheduled,
    youtube_verified: result.youtubeVerified,
    youtube_today_exists: result.youtubeTodayExists,
    safe_to_recover: result.safeToRecover,
    slug: result.slug || "",
    video_id: result.videoId || "",
    publish_at: result.publishAt || "",
  };
  fs.appendFileSync(outputPath, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(""));
}

async function main(argv = process.argv.slice(2)) {
  const selected = Channel.selectFromArgv(argv);
  const date = argValue(selected.argv, "--date") || Calendar.dayKey(new Date(), selected.channel.config.timezone || Calendar.DEFAULT_TIME_ZONE);
  const result = await check({
    channel: selected.channel,
    date,
    verifyYouTube: selected.argv.includes("--verify-youtube"),
    automaticRecoveryStarted: selected.argv.includes("--recovery-started"),
  });
  if (selected.argv.includes("--simulate-missing")) {
    result.produced = false;
    result.topicSelected = false;
    result.scriptReady = false;
    result.assetsReady = false;
    result.renderReady = false;
    result.uploaded = false;
    result.scheduled = false;
    result.youtubeUploaded = false;
    result.youtubeScheduled = false;
    result.videoId = null;
    result.videoIdExists = false;
    result.publishAt = null;
    result.quality = null;
    result.qualityGate = null;
    result.qualityPassed = false;
    result.notificationExists = false;
    result.productionReady = false;
    result.healthy = false;
    result.youtubeVerified = true;
    result.youtubeTodayExists = false;
    result.safeToRecover = true;
    result.verification = "simulated-scheduler-failure";
  }
  const output = argValue(selected.argv, "--output");
  if (output) jsonYaz(path.resolve(output), result);
  if (selected.argv.includes("--github-output")) writeGitHubOutput(result);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  return result.healthy ? 0 : 2;
}

module.exports = { argValue, recordForDate, youtubeVideoForDate, evaluateSnapshot, check, writeGitHubOutput, main };

if (require.main === module) main().then((code) => { process.exitCode = code; }).catch((error) => {
  process.stderr.write(JSON.stringify({ healthy: false, checkerError: String(error.message || error) }) + "\n");
  process.exitCode = 1;
});
