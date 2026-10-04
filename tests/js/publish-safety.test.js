"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Safety = require("../../lib/publish-safety");

function tempChannel(slug = "impossible-brief", extra = {}) {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), "publish-safety-"));
  return { slug, paths: { state }, config: { pathMode: slug === "failure-reconstructed" ? "legacy-adapter" : "isolated" }, expectedChannelId: () => "UC_EXPECTED", ...extra };
}
const noSleep = () => Promise.resolve();

test("idempotency key is stable for the same upload and changes with any identity field", () => {
  const base = { channelId: "UC1", mediaSha256: "a".repeat(64), title: "Why the Titanic Sank", publishAt: "2026-10-03T22:00:00.000Z" };
  const key = Safety.idempotencyKey(base);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(Safety.idempotencyKey({ ...base, title: "why  the TITANIC sank!" }), key, "normalized title");
  for (const change of [{ channelId: "UC2" }, { mediaSha256: "b".repeat(64) }, { title: "Why Titanic Broke" }, { publishAt: "2026-10-04T22:00:00.000Z" }]) {
    assert.notEqual(Safety.idempotencyKey({ ...base, ...change }), key, JSON.stringify(change));
  }
  assert.throws(() => Safety.idempotencyKey({ ...base, channelId: "" }));
});

test("intentional replacements require traceable metadata and a new media identity", () => {
  const media = "a".repeat(64);
  const job = { replacementForVideoId: "OLDVID12345", originalVideoId: "OLDVID12345", replacementReason: "Corrected visual and hook quality defects", replacementVersion: 1 };
  assert.equal(Safety.replacementCheck(job, media).ok, true);
  assert.equal(Safety.replacementCheck({ replacementForVideoId: "OLDVID12345" }, media).code, "REPLACEMENT_METADATA_INCOMPLETE");
  assert.equal(Safety.replacementCheck({ ...job, originalMediaSha256: media }, media).code, "REPLACEMENT_IDENTICAL_MEDIA");
  const base = { channelId: "UC1", mediaSha256: media, title: "Replacement", publishAt: "2026-10-05T18:00:00Z" };
  assert.notEqual(Safety.idempotencyKey(base), Safety.idempotencyKey({ ...base, replacementForVideoId: job.originalVideoId, replacementVersion: 1 }));
});

test("failures are classified; only transient ones are retried", () => {
  const c = (args) => Safety.classifyFailure(args);
  assert.deepEqual([c({ error: new Error("ECONNRESET") }).kind, c({ error: new Error("x") }).retryable], ["NETWORK", true]);
  assert.equal(c({ status: 429 }).kind, "RATE_LIMIT");
  assert.equal(c({ status: 503 }).kind, "SERVER");
  assert.equal(c({ status: 403, body: JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }) }).kind, "QUOTA");
  assert.equal(c({ status: 403, body: JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }) }).retryable, false);
  assert.equal(c({ status: 403, body: JSON.stringify({ error: { errors: [{ reason: "userRateLimitExceeded" }] } }) }).kind, "RATE_LIMIT");
  assert.equal(c({ status: 401 }).kind, "AUTH");
  assert.equal(c({ status: 400 }).kind, "VALIDATION");
  assert.equal(c({ status: 400 }).retryable, false);
});

test("backoff is bounded exponential with full jitter", () => {
  assert.equal(Safety.backoffDelay(1, { baseMs: 1000, capMs: 8000, random: () => 1 }), 1000);
  assert.equal(Safety.backoffDelay(3, { baseMs: 1000, capMs: 8000, random: () => 1 }), 4000);
  assert.equal(Safety.backoffDelay(10, { baseMs: 1000, capMs: 8000, random: () => 1 }), 8000, "capped");
  assert.equal(Safety.backoffDelay(3, { baseMs: 1000, capMs: 8000, random: () => 0 }), 0, "jitter can go to zero");
});

test("journal keeps resumable session URLs out of the committed file", () => {
  const channel = tempChannel();
  Safety.upsertIntent(channel, "k1", { state: "IN_FLIGHT", title: "T", sessionUrl: "https://www.googleapis.com/upload/youtube/v3/videos?upload_id=SECRET" });
  const committed = fs.readFileSync(Safety.journalPath(channel), "utf8");
  assert.doesNotMatch(committed, /upload_id|SECRET/);
  assert.equal(Safety.findIntent(channel, "k1").sessionUrl.includes("upload_id=SECRET"), true, "available to the same run");
  Safety.upsertIntent(channel, "k1", { state: "COMPLETED", videoId: "VID" });
  assert.equal(Safety.findIntent(channel, "k1").sessionUrl, undefined, "dropped once finished");
  assert.equal(Safety.readJournal(channel).lastSuccess != null, true);
});

test("remote reconciliation matches by normalized title or by the scheduled slot", () => {
  const recent = [{ id: "A", title: "Old Video", publishAt: null }, { id: "B", title: "Different Title", publishAt: "2026-10-03T22:00:00Z" }];
  assert.deepEqual(Safety.matchRemote(recent, { title: "old video", publishAt: null }), { videoId: "A", matchedBy: "title" });
  assert.deepEqual(Safety.matchRemote(recent, { title: "Renamed by the title engine", publishAt: "2026-10-03T22:00:00.000Z" }), { videoId: "B", matchedBy: "publishAt" });
  assert.equal(Safety.matchRemote(recent, { title: "New", publishAt: "2026-10-04T22:00:00.000Z" }), null);
});

test("reconciliation fails closed when the channel's uploads cannot be read", async () => {
  const api = (responses) => ({ data: async (resource) => responses.find(([prefix]) => resource.startsWith(prefix))[1] });
  const ok = api([
    ["channels", { ok: true, veri: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] } }],
    ["playlistItems", { ok: true, veri: { items: [{ snippet: { title: "T", resourceId: { videoId: "V1" } } }] } }],
    ["videos", { ok: true, veri: { items: [{ id: "V1", status: { publishAt: "2026-10-03T22:00:00Z" } }] } }],
  ]);
  assert.deepEqual(await Safety.recentUploads(ok), [{ id: "V1", title: "T", publishAt: "2026-10-03T22:00:00Z" }]);
  const broken = api([["channels", { ok: true, veri: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] } }], ["playlistItems", { ok: false, durum: 500 }]]);
  await assert.rejects(Safety.recentUploads(broken), /playlistItems\.list failed/);
});

test("resumable session status: complete, incomplete with received bytes, expired", async () => {
  const put = (durum, extra = {}) => async () => ({ durum, ...extra });
  assert.deepEqual(await Safety.sessionStatus(put(200, { govde: JSON.stringify({ id: "VID" }) }), "u", 100), { state: "COMPLETE", videoId: "VID" });
  assert.deepEqual(await Safety.sessionStatus(put(308, { basliklar: { range: "bytes=0-49" } }), "u", 100), { state: "INCOMPLETE", received: 50 });
  assert.deepEqual(await Safety.sessionStatus(put(308, { basliklar: {} }), "u", 100), { state: "INCOMPLETE", received: 0 });
  assert.deepEqual(await Safety.sessionStatus(put(404), "u", 100), { state: "EXPIRED" });
});

test("TEST-02: a network drop after YouTube received the whole file never opens a second session", async () => {
  const channel = tempChannel();
  let sessions = 0;
  const result = await Safety.runUpload({
    channel, key: "k", sleep: noSleep,
    openSession: async () => { sessions += 1; return "https://upload/session-1"; },
    sendBody: async () => { throw new Error("socket hang up"); },
    statusOf: async () => ({ state: "COMPLETE", videoId: "ALREADY_THERE" }),
  });
  assert.deepEqual([result.ok, result.videoId, result.via, sessions], [true, "ALREADY_THERE", "session-reconcile", 1]);
});

test("TEST-05: an interrupted upload resumes from the received byte instead of starting over", async () => {
  const channel = tempChannel();
  const offsets = [];
  let sessions = 0;
  const result = await Safety.runUpload({
    channel, key: "k", sleep: noSleep,
    openSession: async () => { sessions += 1; return "https://upload/session"; },
    sendBody: async (url, offset) => { offsets.push(offset); return offsets.length === 1 ? { durum: 503, govde: "" } : { durum: 201, govde: JSON.stringify({ id: "VID" }) }; },
    statusOf: async () => ({ state: "INCOMPLETE", received: 4096 }),
  });
  assert.deepEqual(offsets, [0, 4096]);
  assert.equal(sessions, 1);
  assert.equal(result.videoId, "VID");
});

test("validation, auth and quota failures are not retried; unknown session state never opens a new session", async () => {
  for (const [durum, govde, kind] of [[400, "", "VALIDATION"], [401, "", "AUTH"], [403, JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), "QUOTA"]]) {
    let sends = 0;
    const result = await Safety.runUpload({ channel: tempChannel(), key: "k", sleep: noSleep, openSession: async () => "u", sendBody: async () => { sends += 1; return { durum, govde }; }, statusOf: async () => ({ state: "UNKNOWN" }) });
    assert.deepEqual([result.ok, result.failure.kind, sends], [false, kind, 1], kind);
  }
  let sessions = 0;
  const result = await Safety.runUpload({ channel: tempChannel(), key: "k", sleep: noSleep, maxAttempts: 3,
    openSession: async () => { sessions += 1; return "u"; }, sendBody: async () => ({ durum: 503, govde: "" }), statusOf: async () => ({ state: "UNKNOWN" }) });
  assert.equal(result.ok, false);
  assert.equal(sessions, 1, "a session whose state is unknown is retried, never duplicated");
});

test("an expired session is replaced only after YouTube says it is gone", async () => {
  let sessions = 0, sends = 0;
  const result = await Safety.runUpload({ channel: tempChannel(), key: "k", sleep: noSleep,
    openSession: async () => { sessions += 1; return `u${sessions}`; },
    sendBody: async () => { sends += 1; return sends === 1 ? { durum: 500, govde: "" } : { durum: 200, govde: JSON.stringify({ id: "V" }) }; },
    statusOf: async () => ({ state: "EXPIRED" }) });
  assert.deepEqual([result.ok, sessions], [true, 2]);
});

test("ID-02: a publish job can only be uploaded with its own channel's credentials", () => {
  const ib = tempChannel("impossible-brief");
  const fr = tempChannel("failure-reconstructed");
  assert.deepEqual(Safety.jobChannelCheck({ channel: "impossible-brief" }, ib), { ok: true });
  assert.equal(Safety.jobChannelCheck({ channel: "critical-thread" }, ib).code, "JOB_CHANNEL_MISMATCH");
  assert.equal(Safety.jobChannelCheck({}, ib).code, "JOB_CHANNEL_MISSING");
  assert.equal(Safety.jobChannelCheck({}, fr).ok, true, "legacy Failure Reconstructed jobs predate the tag");
  assert.equal(Safety.jobChannelCheck({ channel: "impossible-brief" }, fr).code, "JOB_CHANNEL_MISMATCH");
  assert.equal(Safety.jobChannelCheck({ channel: "impossible-brief", expectedYouTubeChannelId: "UC_OTHER" }, ib).code, "JOB_CHANNEL_ID_MISMATCH");
});

test("publish modes: live by default, shadow and dry-run explicit", () => {
  assert.equal(Safety.publishMode({}), "live");
  assert.equal(Safety.publishMode({ PUBLISH_MODE: "shadow" }), "shadow");
  assert.equal(Safety.publishMode({ PUBLISH_MODE: "nonsense" }), "live");
  assert.equal(Safety.publishMode({}, ["--dogrula"]), "dry-run");
});

test("the uploader is wired fail-closed: journal before bytes, reconcile before upload, no title-only fallback", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../youtube-yukle.js"), "utf8");
  assert.doesNotMatch(source, /cift yukleme kontrolu yapilamadi/, "old fail-open path is gone");
  assert.match(source, /RECONCILE_UNAVAILABLE[\s\S]*process\.exit\(9\)/);
  const order = ["jobChannelCheck", "getYouTubeClient", "idempotencyKey", "recentUploads", "canAfford", "PUBLISH-PREFLIGHT.json", "PUBLISH_MODE=shadow", "QUOTA_EXHAUSTED", "upsertIntent(CHANNEL, anahtar, { state: \"IN_FLIGHT\"", "Safety.runUpload"];
  let last = -1;
  for (const marker of order) {
    const index = source.indexOf(marker, last + 1);
    assert.ok(index > last, `${marker} must come after the previous step`);
    last = index;
  }
});
