// PUBLISH SAFETY — idempotent, fail-closed YouTube uploads (shared by all channels).
//
// The failure that matters: YouTube accepted the video but the run died before
// local state was committed (or the network dropped while the body was in
// flight). A naive retry then opens a NEW upload session and the channel gets
// a duplicate. This module prevents that:
//
//   1. idempotencyKey = SHA256(channel_id | media_sha256 | normalized_title | publish_at)
//   2. an intent journal (<channel state>/upload-state.json) is written BEFORE
//      the upload session opens and records the resumable session URL
//   3. before any (re)upload: (a) a completed intent is re-committed locally,
//      (b) an open session is queried and RESUMED, (c) the channel's recent
//      uploads are reconciled by normalized title OR identical scheduled
//      publishAt (one Short per slot per channel)
//   4. if the remote state cannot be read, the upload does not happen
//      (fail closed) — a skipped day is recoverable, a duplicate is not
//   5. failures are classified; only transient ones are retried, with bounded
//      exponential backoff and full jitter
//
// Never logs tokens, session URLs or response bodies (they can carry upload IDs
// bound to credentials); only classified codes and HTTP statuses.
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const JOURNAL_FILE = "upload-state.json";
// Resumable session URLs carry an upload_id that authorises writes to that
// session. The journal is committed to a public repository, so session URLs
// live in a separate git-ignored file in the same folder.
const SESSIONS_FILE = ".upload-sessions.json";
const MAX_JOURNAL_ENTRIES = 60;

function normalizeTitle(title) {
  return String(title || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(file, "r");
  try {
    const buffer = Buffer.alloc(1 << 20);
    let read;
    while ((read = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, read));
  } finally { fs.closeSync(fd); }
  return hash.digest("hex");
}

function idempotencyKey({ channelId, mediaSha256, title, publishAt, replacementForVideoId = null, replacementVersion = null }) {
  if (!channelId || !mediaSha256) throw new Error("idempotency key needs channelId and mediaSha256");
  return crypto.createHash("sha256")
    .update([channelId, mediaSha256, normalizeTitle(title), publishAt || "unscheduled", replacementForVideoId || "original", replacementVersion || 0].join("|"))
    .digest("hex");
}

function replacementCheck(job, mediaSha256) {
  const fields = ["replacementForVideoId", "replacementReason", "replacementVersion", "originalVideoId"];
  const present = fields.filter((key) => job && job[key] != null && job[key] !== "");
  if (!present.length) return { ok: true, replacement: null };
  const missing = fields.filter((key) => !job || job[key] == null || job[key] === "");
  if (missing.length) return { ok: false, code: "REPLACEMENT_METADATA_INCOMPLETE", detail: `missing ${missing.join(", ")}` };
  if (job.replacementForVideoId !== job.originalVideoId) return { ok: false, code: "REPLACEMENT_ORIGINAL_MISMATCH", detail: "replacementForVideoId must equal originalVideoId" };
  if (!/^[A-Za-z0-9_-]{6,20}$/.test(String(job.originalVideoId))) return { ok: false, code: "REPLACEMENT_VIDEO_ID_INVALID", detail: "originalVideoId is invalid" };
  if (!Number.isInteger(Number(job.replacementVersion)) || Number(job.replacementVersion) < 1) return { ok: false, code: "REPLACEMENT_VERSION_INVALID", detail: "replacementVersion must be a positive integer" };
  if (String(job.replacementReason).trim().length < 12) return { ok: false, code: "REPLACEMENT_REASON_MISSING", detail: "replacementReason must explain the correction" };
  if (job.originalMediaSha256 && job.originalMediaSha256 === mediaSha256) return { ok: false, code: "REPLACEMENT_IDENTICAL_MEDIA", detail: "replacement media hash equals the original" };
  return { ok: true, replacement: Object.fromEntries(fields.map((key) => [key, job[key]])) };
}

// ---------------------------------------------------------------------------
// Failure classification and backoff

const CLASSES = Object.freeze({
  NETWORK: { retryable: true },
  RATE_LIMIT: { retryable: true },
  SERVER: { retryable: true },
  QUOTA: { retryable: false },
  AUTH: { retryable: false },
  VALIDATION: { retryable: false },
  PERMANENT: { retryable: false },
});

function classifyFailure({ status, body, error } = {}) {
  const text = String(body || "");
  let reason = "";
  try { const parsed = JSON.parse(text); reason = JSON.stringify((parsed.error && (parsed.error.errors || parsed.error.status || parsed.error.message)) || ""); } catch (e) { reason = text.slice(0, 300); }
  let kind;
  if (error || !status) kind = "NETWORK";
  else if (status === 429) kind = "RATE_LIMIT";
  else if (status === 403 && /quotaExceeded|dailyLimitExceeded|uploadLimitExceeded/i.test(reason)) kind = "QUOTA";
  else if (status === 403 && /rateLimitExceeded|userRateLimitExceeded/i.test(reason)) kind = "RATE_LIMIT";
  else if (status === 401 || status === 403) kind = "AUTH";
  else if (status === 408 || status >= 500) kind = "SERVER";
  else if (status === 400 || status === 404 || status === 409 || status === 413 || status === 422) kind = "VALIDATION";
  else kind = "PERMANENT";
  return { kind, retryable: CLASSES[kind].retryable, status: status || null };
}

// Full jitter: random in [0, min(cap, base * 2^(attempt-1))].
function backoffDelay(attempt, { baseMs = 2000, capMs = 60000, random = Math.random } = {}) {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(random() * ceiling);
}

// ---------------------------------------------------------------------------
// Intent journal (per channel)

function journalPath(channel) { return path.join(channel.paths.state, JOURNAL_FILE); }

function readJournal(channel) {
  try {
    const value = JSON.parse(fs.readFileSync(journalPath(channel), "utf8"));
    return { channel: channel.slug, ...value, intents: Array.isArray(value.intents) ? value.intents : [] };
  } catch (error) { return { channel: channel.slug, intents: [] }; }
}

function writeJournal(channel, journal) {
  journal.intents = journal.intents.slice(-MAX_JOURNAL_ENTRIES);
  fs.mkdirSync(path.dirname(journalPath(channel)), { recursive: true });
  const temporary = journalPath(channel) + ".tmp";
  fs.writeFileSync(temporary, JSON.stringify(journal, null, 2) + "\n");
  fs.renameSync(temporary, journalPath(channel));
}

function sessionsPath(channel) { return path.join(channel.paths.state, SESSIONS_FILE); }
function readSessions(channel) {
  try { return JSON.parse(fs.readFileSync(sessionsPath(channel), "utf8")); } catch (error) { return {}; }
}
function writeSession(channel, key, sessionUrl) {
  const sessions = readSessions(channel);
  if (sessionUrl) sessions[key] = sessionUrl; else delete sessions[key];
  fs.mkdirSync(path.dirname(sessionsPath(channel)), { recursive: true });
  fs.writeFileSync(sessionsPath(channel), JSON.stringify(sessions, null, 2) + "\n", { mode: 0o600 });
}

function findIntent(channel, key) {
  const intent = readJournal(channel).intents.find((item) => item.key === key) || null;
  if (!intent) return null;
  const sessionUrl = readSessions(channel)[key];
  return sessionUrl ? { ...intent, sessionUrl } : intent;
}

function upsertIntent(channel, key, inputPatch) {
  const { sessionUrl, ...patch } = inputPatch;
  if (sessionUrl !== undefined) { writeSession(channel, key, sessionUrl); patch.sessionOpen = !!sessionUrl; }
  if (patch.state === "COMPLETED" || patch.state === "FAILED") writeSession(channel, key, null);
  const journal = readJournal(channel);
  const index = journal.intents.findIndex((intent) => intent.key === key);
  const now = new Date().toISOString();
  const next = { ...(index >= 0 ? journal.intents[index] : { key, createdAt: now }), ...patch, updatedAt: now };
  if (index >= 0) journal.intents[index] = next; else journal.intents.push(next);
  journal.lastAttempt = now;
  if (patch.state === "COMPLETED") journal.lastSuccess = now;
  writeJournal(channel, journal);
  return next;
}

// ---------------------------------------------------------------------------
// Remote reconciliation

// recent: [{ id, title, publishAt }] from the channel's uploads playlist.
function matchRemote(recent, { title, publishAt }) {
  const wanted = normalizeTitle(title);
  const byTitle = (recent || []).find((video) => normalizeTitle(video.title) === wanted);
  if (byTitle) return { videoId: byTitle.id, matchedBy: "title" };
  if (publishAt) {
    const at = Date.parse(publishAt);
    const bySlot = (recent || []).find((video) => video.publishAt && Math.abs(Date.parse(video.publishAt) - at) < 60000);
    if (bySlot) return { videoId: bySlot.id, matchedBy: "publishAt" };
  }
  return null;
}

// Recent uploads (uploads playlist, then videos.list for scheduled publishAt).
// Throws on any API failure: the caller must fail closed.
async function recentUploads(api, limit = 50) {
  const channel = await api.data("channels?part=contentDetails&mine=true");
  const playlist = channel.ok && channel.veri && channel.veri.items && channel.veri.items[0] && channel.veri.items[0].contentDetails.relatedPlaylists.uploads;
  if (!playlist) throw Object.assign(new Error("uploads playlist unavailable"), { code: "RECONCILE_UNAVAILABLE" });
  const items = await api.data(`playlistItems?part=snippet&maxResults=${Math.min(50, limit)}&playlistId=${encodeURIComponent(playlist)}`);
  if (!items.ok) throw Object.assign(new Error(`playlistItems.list failed (${items.durum || "?"})`), { code: "RECONCILE_UNAVAILABLE" });
  const rows = (items.veri.items || []).map((item) => ({ id: item.snippet.resourceId.videoId, title: item.snippet.title }));
  if (!rows.length) return rows;
  const details = await api.data(`videos?part=status&id=${rows.map((row) => row.id).join(",")}`);
  if (!details.ok) throw Object.assign(new Error(`videos.list failed (${details.durum || "?"})`), { code: "RECONCILE_UNAVAILABLE" });
  const publishAt = new Map((details.veri.items || []).map((video) => [video.id, video.status && video.status.publishAt || null]));
  return rows.map((row) => ({ ...row, publishAt: publishAt.get(row.id) || null }));
}

// Resumable session status (YouTube resumable protocol: an empty PUT with
// "Content-Range: bytes */<size>"). 200/201 → finished (video resource);
// 308 → incomplete, Range tells how many bytes arrived; 404/410 → expired.
async function sessionStatus(put, sessionUrl, size) {
  const response = await put(sessionUrl, { "Content-Length": 0, "Content-Range": `bytes */${size}` });
  if (response.durum === 200 || response.durum === 201) {
    let video = null; try { video = JSON.parse(response.govde); } catch (error) {}
    return { state: "COMPLETE", videoId: video && video.id || null };
  }
  if (response.durum === 308) {
    const range = String((response.basliklar || {}).range || "");
    const match = range.match(/bytes=0-(\d+)/);
    return { state: "INCOMPLETE", received: match ? Number(match[1]) + 1 : 0 };
  }
  if (response.durum === 404 || response.durum === 410) return { state: "EXPIRED" };
  return { state: "UNKNOWN", status: response.durum };
}

// ---------------------------------------------------------------------------
// Upload loop (network calls injected, so the duplicate-prevention logic is
// testable without YouTube):
//   openSession()                → session URL (journaled before any byte is sent)
//   sendBody(url, offset)        → { durum, govde }
//   statusOf(url)                → sessionStatus() result
//   sleep(ms)
// A body failure never opens a new session before asking the old one: if
// YouTube already holds the whole file, that video is the result.
async function runUpload({ channel, key, openSession, sendBody, statusOf, sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  maxAttempts = 5, backoff = { baseMs: 4000, capMs: 90000 }, resumeFrom = null, onRetry = () => {} }) {
  let url = resumeFrom ? resumeFrom.url : null;
  let offset = resumeFrom ? resumeFrom.offset : 0;
  let failure = null;
  let sessionsOpened = 0;
  const done = (videoId, attempts, via) => ({ ok: true, videoId, attempts, sessionsOpened, via });
  const askSession = async (sessionUrl) => {
    if (!sessionUrl) return { state: "UNKNOWN" };
    try { return await statusOf(sessionUrl); } catch (error) { return { state: "UNKNOWN" }; }
  };
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response = null;
    try {
      if (!url) {
        url = await openSession();
        sessionsOpened += 1;
        offset = 0;
        upsertIntent(channel, key, { sessionUrl: url, sessionOpenedAt: new Date().toISOString() });
      }
      response = await sendBody(url, offset);
      if (response.durum === 200 || response.durum === 201) {
        let video = null; try { video = JSON.parse(response.govde); } catch (error) {}
        if (video && video.id) return done(video.id, attempt, "upload");
        failure = { kind: "PERMANENT", retryable: false, status: response.durum };
        break;
      }
      failure = classifyFailure({ status: response.durum, body: response.govde });
    } catch (error) {
      failure = classifyFailure({ error });
    }
    if (!failure.retryable) break;
    const state = await askSession(url);
    if (state.state === "COMPLETE" && state.videoId) return done(state.videoId, attempt, "session-reconcile");
    if (state.state === "INCOMPLETE") offset = state.received;
    else if (state.state === "EXPIRED") url = null;
    // UNKNOWN: keep the same session; never open a second one blindly.
    onRetry({ attempt, kind: failure.kind, status: failure.status });
    if (attempt < maxAttempts) await sleep(backoffDelay(attempt, backoff));
  }
  return { ok: false, failure, attempts: maxAttempts, sessionsOpened };
}

// ---------------------------------------------------------------------------
// Publish job / channel identity

// The job must belong to the channel whose credentials are about to be used.
// A job without a channel tag is accepted only by the legacy channel that
// predates the tag (Failure Reconstructed); every isolated channel writes it.
function jobChannelCheck(job, channel) {
  const jobChannel = job && job.channel;
  if (jobChannel && jobChannel !== channel.slug) return { ok: false, code: "JOB_CHANNEL_MISMATCH", detail: `job for ${jobChannel}, credentials for ${channel.slug}` };
  if (!jobChannel && channel.config.pathMode !== "legacy-adapter") return { ok: false, code: "JOB_CHANNEL_MISSING", detail: `job has no channel tag; ${channel.slug} requires one` };
  if (job && job.expectedYouTubeChannelId && channel.expectedChannelId() && job.expectedYouTubeChannelId !== channel.expectedChannelId()) {
    return { ok: false, code: "JOB_CHANNEL_ID_MISMATCH", detail: "job channel ID differs from the configured channel ID" };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Publish mode

// live (default): upload. shadow: every pre-flight and reconciliation step,
// no upload session. dry-run: local checks only (no API calls).
function publishMode(env = process.env, argv = []) {
  if (argv.includes("--dogrula")) return "dry-run";
  const value = String(env.PUBLISH_MODE || "live").toLowerCase();
  return ["live", "shadow", "dry-run"].includes(value) ? value : "live";
}

module.exports = {
  JOURNAL_FILE, SESSIONS_FILE, CLASSES, normalizeTitle, sha256File, idempotencyKey, classifyFailure, backoffDelay,
  journalPath, readJournal, writeJournal, findIntent, upsertIntent, matchRemote, recentUploads, sessionStatus, runUpload,
  jobChannelCheck, replacementCheck, publishMode,
};
