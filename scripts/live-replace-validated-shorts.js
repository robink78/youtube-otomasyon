"use strict";

// One-shot, fail-closed replacement publisher for the three Shorts whose old
// public versions failed the new visual/editorial standard. It renders and
// validates the replacement first, uploads it PRIVATE+scheduled, verifies the
// returned YouTube object and channel identity, and only then makes the old
// public video PRIVATE. It never deletes a YouTube video.

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const Channel = require("../core/channel-context");
const Discovery = require("../core/discovery");
const Rendering = require("../core/rendering");
const Scripting = require("../core/scripting");
const Growth = require("../core/growth");
const Pipeline = require("../core/pipeline/impossible-brief");
const Calendar = require("../core/scheduling/calendar");
const YT = require("../lib/yt");

const ROOT = Channel.ROOT;
const TARGET_DAY = "2026-10-04";
const TARGETS = [
  {
    channel: "impossible-brief",
    slug: "what-if-the-dinosaur-killing-asteroid-hit-today",
    oldVideoId: "u0iftg8gF5w",
    title: "What If the Dinosaur Asteroid Hit Earth Today",
    reason: "Re-rendered after semantic opening validation and rendered visual-quality gating were hardened; the prior public package had no rendered visual audit evidence.",
  },
  {
    channel: "critical-thread",
    slug: "what-quietly-depends-on-uninterruptible-power-supply",
    oldVideoId: "hsuWhB8lCvU",
    title: "What Happens to Data Centres When the Grid Fails?",
    reason: "Re-rendered with corrected spoken-English opening, stronger title competition, semantic visual matching and final rendered visual-quality evidence.",
  },
  {
    channel: "behind-the-ordinary",
    slug: "why-the-bluetooth-logo-looks-like-that",
    oldVideoId: "I9Lcpi9kPYs",
    title: "Why the Bluetooth Logo Looks Like That",
    reason: "Replaces the weak road-stud package whose opening visual was unrelated; a stronger topic passed the viral and rendered visual-quality gates.",
  },
];

function read(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}
function localHour(value, zone = "Europe/Istanbul") {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "2-digit" }).format(new Date(value)));
}
function publishedRows(channel) {
  const file = path.join(channel.paths.state, channel.config.pathMode === "legacy-adapter" ? "yayinlananlar.json" : "published.json");
  return { file, rows: read(file, []) || [] };
}
function newestReplacementRow(channel, target) {
  const { rows } = publishedRows(channel);
  return rows.filter((row) => row && row.videoId && row.slug === target.slug)
    .sort((a, b) => String(b.tarih || b.generatedAt || "").localeCompare(String(a.tarih || a.generatedAt || "")))[0] || null;
}
function youtubeWritableStatus(status, privacyStatus) {
  const out = { privacyStatus };
  for (const key of ["license", "embeddable", "publicStatsViewable", "selfDeclaredMadeForKids", "containsSyntheticMedia"]) {
    if (status && status[key] !== undefined) out[key] = status[key];
  }
  return out;
}
async function getVideo(api, id) {
  const response = await api.data(`videos?part=snippet,status,contentDetails&id=${encodeURIComponent(id)}`);
  if (!response.ok) throw new Error(`VIDEOS_READ_FAILED ${id}: ${response.kod || response.neden || response.durum}`);
  return response.veri && response.veri.items && response.veri.items[0] || null;
}

function renderValidated(channel, target) {
  const topic = (Discovery.universe(channel).topics || []).find((item) => item.slug === target.slug || item.id === target.slug);
  if (!topic) throw new Error(`TOPIC_NOT_FOUND ${channel.slug}/${target.slug}`);
  const pre = Growth.planShort(channel, topic.id, { legacyTitles: Scripting.titleCandidates(topic), skipDuplicate: true, assignExperiment: true, write: true });
  if (pre.readiness.decision === "BLOCK") throw new Error(`PRE_RENDER_BLOCK ${pre.readiness.ProductionReadinessScore}: ${(pre.readiness.hardFails || []).join("; ")}`);

  const output = path.join(channel.paths.production, topic.slug);
  const result = Rendering.buildPackage(topic, channel, output, { render: true, growthPlan: pre });
  const failed = Object.entries(result.validations || {}).filter(([, ok]) => !ok).map(([name]) => name);
  if (failed.length) throw new Error(`PACKAGE_VALIDATION_FAILED: ${failed.join(", ")}`);
  if (!result.render || !result.render.completed || !result.render.video || !result.render.video.visualQuality) throw new Error("RENDER_EVIDENCE_MISSING");

  const finalPlan = Growth.planShort(channel, topic.id, {
    legacyTitles: Scripting.titleCandidates(topic), skipDuplicate: true, stage: "final", assignExperiment: true, write: true,
    selection: pre.topicDecision,
    render: {
      completed: true,
      syntheticVoice: result.render.audio && result.render.audio.syntheticVoice,
      hasAudio: result.render.video.hasAudio,
      captionsBurned: result.render.video.captionsBurned,
      width: result.render.video.width,
      height: result.render.video.height,
      durationSeconds: result.render.video.durationSeconds,
      visualQuality: result.render.video.visualQuality,
    },
  });
  if (finalPlan.readiness.decision !== "PUBLISH") throw new Error(`FINAL_READINESS_${finalPlan.readiness.decision} ${finalPlan.readiness.ProductionReadinessScore}: ${(finalPlan.readiness.hardFails || []).join("; ")}`);
  if (result.render.video.visualQuality.decision !== "PUBLISH") throw new Error(`VISUAL_QUALITY_${result.render.video.visualQuality.decision}`);

  Pipeline.writeCompatibilityFiles(result, topic, channel);
  write(path.join(output, "readiness.json"), finalPlan.readiness);
  Pipeline.writeValidationEvidence(result, topic, channel, output);

  // Replacement identity is part of the idempotency key and must be present in
  // the actual upload job, not just in an audit report.
  const konuFile = path.join(output, "konu.json");
  const konu = read(konuFile, {});
  Object.assign(konu, {
    replacementForVideoId: target.oldVideoId,
    originalVideoId: target.oldVideoId,
    replacementReason: target.reason,
    replacementVersion: 1,
  });
  write(konuFile, konu);

  // Lock the already-reviewed title so the replacement cannot reconcile to the
  // old upload merely because a later title competition picked its old title.
  const uploadFile = path.join(output, "YUKLEME.json");
  const upload = read(uploadFile, {});
  upload.baslik = target.title;
  write(uploadFile, upload);

  return {
    topic,
    output,
    title: target.title,
    durationSeconds: result.render.video.durationSeconds,
    distinctVisuals: result.render.video.distinctVisuals,
    visualQuality: result.render.video.visualQuality,
    readiness: finalPlan.readiness,
  };
}

function upload(channel, target) {
  const result = cp.spawnSync(process.execPath, [path.join(ROOT, "youtube-yukle.js"), "--channel", channel.slug, target.slug], {
    cwd: ROOT,
    env: { ...process.env, PUBLISH_MODE: "live", YT_PRIVACY: "private", PROVENANCE_REQUIRED: process.env.PROVENANCE_REQUIRED || "0" },
    encoding: "utf8",
    timeout: 15 * 60 * 1000,
  });
  process.stdout.write(result.stdout || "");
  process.stderr.write(result.stderr || "");
  if (result.status !== 0) throw new Error(`UPLOAD_FAILED exit=${result.status}`);
}

async function verifyAndRetireOld(channel, target, rendered) {
  const row = newestReplacementRow(channel, target);
  if (!row || !row.videoId || row.videoId === target.oldVideoId) throw new Error("NEW_VIDEO_ID_NOT_RECORDED");
  if (row.replacementForVideoId !== target.oldVideoId || Number(row.replacementVersion) !== 1) throw new Error("REPLACEMENT_METADATA_NOT_RECORDED");
  if (!row.publishAt) throw new Error("REPLACEMENT_NOT_SCHEDULED");

  const client = await YT.getYouTubeClient(channel);
  const fresh = await getVideo(client.api, row.videoId);
  if (!fresh) throw new Error(`NEW_VIDEO_NOT_FOUND ${row.videoId}`);
  if (!fresh.snippet || fresh.snippet.channelId !== client.identity.actual) throw new Error("NEW_VIDEO_CHANNEL_MISMATCH");
  if (!fresh.status || fresh.status.privacyStatus !== "private" || !fresh.status.publishAt) throw new Error("NEW_VIDEO_NOT_PRIVATE_SCHEDULED");
  if (Math.abs(Date.parse(fresh.status.publishAt) - Date.parse(row.publishAt)) > 60000) throw new Error("PUBLISH_AT_MISMATCH");

  const scheduledDay = Calendar.dayKey(fresh.status.publishAt, "Europe/Istanbul");
  const scheduledHour = localHour(fresh.status.publishAt);
  const todayAtNine = scheduledDay === TARGET_DAY && scheduledHour === 21;
  const old = await getVideo(client.api, target.oldVideoId);
  if (!old) throw new Error(`OLD_VIDEO_NOT_FOUND ${target.oldVideoId}`);

  let oldRetired = false;
  let retireReason = null;
  // Never create a gap if rendering/uploading missed today's target slot.
  if (todayAtNine) {
    if (old.status && old.status.privacyStatus !== "private") {
      const response = await client.api.put("videos?part=status", { id: target.oldVideoId, status: youtubeWritableStatus(old.status, "private") });
      if (!response.ok) throw new Error(`OLD_VIDEO_PRIVATE_FAILED ${response.kod || response.neden || response.durum}`);
      const check = await getVideo(client.api, target.oldVideoId);
      if (!check || !check.status || check.status.privacyStatus !== "private") throw new Error("OLD_VIDEO_PRIVATE_VERIFY_FAILED");
      oldRetired = true;
    } else {
      oldRetired = true;
    }
  } else {
    retireReason = `replacement scheduled ${fresh.status.publishAt}; old kept public to avoid a content gap`;
  }

  return {
    channel: channel.slug,
    oldVideoId: target.oldVideoId,
    newVideoId: row.videoId,
    title: target.title,
    publishAt: fresh.status.publishAt,
    scheduledForTarget21: todayAtNine,
    oldRetiredToPrivate: oldRetired,
    retireReason,
    durationSeconds: rendered.durationSeconds,
    distinctVisuals: rendered.distinctVisuals,
    visualQuality: rendered.visualQuality.score,
    readiness: rendered.readiness.ProductionReadinessScore,
  };
}

async function one(target) {
  const channel = Channel.getChannel(target.channel);
  console.log(`\n=== ${channel.name}: replacement ${target.slug} ===`);
  // Auth, scopes and channel ID must pass before spending render time.
  const client = await YT.getYouTubeClient(channel);
  console.log(`identity PASS: ${client.identity.title || channel.name} (${client.identity.actual})`);
  const old = await getVideo(client.api, target.oldVideoId);
  if (!old || !old.snippet || old.snippet.channelId !== client.identity.actual) throw new Error("OLD_VIDEO_CHANNEL_MISMATCH");

  const rendered = renderValidated(channel, target);
  console.log(`render PASS: visual=${rendered.visualQuality.score} distinct=${rendered.distinctVisuals} readiness=${rendered.readiness.ProductionReadinessScore}`);
  upload(channel, target);
  return verifyAndRetireOld(channel, target, rendered);
}

(async () => {
  const report = {
    schema: "live-replacement-run/1",
    startedAt: new Date().toISOString(),
    targetLocalTime: `${TARGET_DAY} 21:00 Europe/Istanbul`,
    policy: "upload+verify replacement first; old video PRIVATE only after verified same-day 21:00 schedule; never delete",
    keptExisting: [{ channel: "failure-reconstructed", videoId: "4Mo58FxCr4A", reason: "Existing Rana Plaza render already had full pre-publication visual checks; avoid destroying a valid public Short merely to chase a packaging improvement." }],
    results: [],
  };
  for (const target of TARGETS) {
    try {
      report.results.push({ ok: true, ...(await one(target)) });
    } catch (error) {
      console.error(`${target.channel}: ${error.message}`);
      report.results.push({ ok: false, channel: target.channel, oldVideoId: target.oldVideoId, error: error.message });
    }
  }
  report.finishedAt = new Date().toISOString();
  write(path.join(ROOT, "reports", "live-replacements-2026-10-04.json"), report);
  console.log("\n" + JSON.stringify(report, null, 2));
  if (report.results.some((row) => !row.ok)) process.exitCode = 1;
})().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
