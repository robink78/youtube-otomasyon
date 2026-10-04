"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const { KOK, jsonOku } = require("../../lib/ortak");
const SLA = require("../../production-sla-check");
const Recovery = require("../../core/scheduling/recovery");
const TikTok = require("../../tiktok-yukle");
const TikTokApi = require("../../lib/tiktok");
const DailyReport = require("../../daily-operations-report");

test("production SLA emits the required healthy machine-readable shape", () => {
  const result = SLA.evaluateSnapshot({
    date: "2026-09-27",
    deadlineUtc: "16:30",
    channel: "failure-reconstructed",
    published: [{ slug: "deepwater-horizon-2010", videoId: "aScjSrwqeRk", format: "short", tarih: "2026-09-27T12:31:08Z", publishAt: "2026-09-27T18:00:00Z", kalite: "PUBLISH" }],
    generated: ["deepwater-horizon-2010"],
    notifications: { "video:aScjSrwqeRk": "2026-09-27T12:33:01Z" },
    quality: { asama: "final", karar: "PUBLISH" },
    remoteVideoExists: true,
    youtubeVerified: true,
  });
  assert.deepEqual({ produced: result.produced, uploaded: result.uploaded, scheduled: result.scheduled,
    videoId: result.videoId, publishAt: result.publishAt, quality: result.quality, healthy: result.healthy }, {
    produced: true, uploaded: true, scheduled: true, videoId: "aScjSrwqeRk",
    publishAt: "2026-09-27T18:00:00Z", quality: "PUBLISH", healthy: true,
  });
  assert.equal(result.verification, "youtube-api");
  assert.equal(result.youtubeUploaded, true);
  assert.equal(result.youtubeScheduled, true);
  assert.equal(result.qualityGate, "PUBLISH");
});

test("missed scheduler starts recovery; a human is notified only if recovery also fails", () => {
  const missing = SLA.evaluateSnapshot({ date: "2026-09-28", channel: "failure-reconstructed",
    published: [], generated: [], notifications: {}, quality: null, remoteVideoExists: false, youtubeVerified: true });
  assert.equal(Recovery.decide(missing).startProduction, true);
  assert.equal(Recovery.decide(missing).notifyHuman, false);
  assert.equal(Recovery.afterRecovery(missing, { started: true }).notifyHuman, true);
  const recovered = { ...missing, scheduled: true, productionReady: true, notificationExists: true, healthy: true };
  assert.equal(Recovery.afterRecovery(recovered, { started: true }).notifyHuman, false);
});

test("YouTube API absence is required before watchdog recovery", () => {
  const unknown = SLA.evaluateSnapshot({ date: "2026-09-28", channel: "failure-reconstructed",
    published: [], generated: [], notifications: {}, quality: null, youtubeVerified: false });
  assert.equal(unknown.youtubeTodayExists, false);
  assert.equal(unknown.safeToRecover, false, "an OAuth/API failure must fail closed");

  const absent = SLA.evaluateSnapshot({ date: "2026-09-28", channel: "failure-reconstructed",
    published: [], generated: [], notifications: {}, quality: null, youtubeVerified: true, remoteTodayVideo: null });
  assert.equal(absent.safeToRecover, true);

  const remote = { id: "aScjSrwqeRk", snippet: { publishedAt: "2026-09-28T18:00:00Z" },
    status: { publishAt: "2026-09-28T18:00:00Z" }, contentDetails: { duration: "PT52S" } };
  const occupied = SLA.evaluateSnapshot({ date: "2026-09-28", channel: "failure-reconstructed",
    published: [], generated: [], notifications: {}, quality: null, youtubeVerified: true, remoteTodayVideo: remote });
  assert.equal(occupied.youtubeTodayExists, true);
  assert.equal(occupied.safeToRecover, false);
  assert.equal(occupied.remoteTodayVideoId, remote.id);
  assert.equal(SLA.youtubeVideoForDate([remote], "2026-09-28").id, remote.id);
  assert.equal(SLA.youtubeVideoForDate([{ ...remote, contentDetails: { duration: "PT8M" } }], "2026-09-28"), null);
});

test("YouTube upload-list API errors cannot masquerade as an empty channel", async () => {
  let call = 0;
  const api = { data: async () => {
    call++;
    if (call === 1) return { ok: true, veri: { items: [{ contentDetails: { relatedPlaylists: { uploads: "UP123" } } }] } };
    return { ok: false, neden: "quota/auth failure" };
  } };
  await assert.rejects(() => require("../../lib/yt").yuklemeler(api, 100), /quota\/auth failure/);
});

test("TikTok duplicate protection treats any durable publishId as already sent", () => {
  assert.equal(TikTok.dahaOnceGonderildi({ slug: "x", publishId: "v_1", durum: "PROCESSING_UPLOAD" }), true);
  assert.equal(TikTok.dahaOnceGonderildi({ slug: "x", durum: "SEND_TO_USER_INBOX" }), true);
  assert.equal(TikTok.dahaOnceGonderildi({ slug: "x", durum: "FAILED" }), false);
  assert.equal(TikTok.dahaOnceGonderildi(null), false);
});

test("TikTok account pinning uses a non-reversible fingerprint and blocks a different account", () => {
  const expected = TikTokApi.accountFingerprint("authorized-open-id");
  const identity = TikTokApi.accountIdentity({ openId: "authorized-open-id", displayName: "Failure Reconstructed" }, expected);
  assert.equal(identity.displayName, "Failure Reconstructed");
  assert.equal(identity.openIdSha256, expected);
  assert.equal(identity.pinned, true);
  assert.throws(() => TikTokApi.accountIdentity({ openId: "another-open-id", displayName: "Wrong Account" }, expected), /TT_ACCOUNT_MISMATCH/);
});

test("current historical TikTok candidate is Tacoma Narrows", () => {
  const sent = new Set(jsonOku(path.join(KOK, "icerik", "tiktok.json"), []).map((item) => item.slug));
  if (!sent.has("tacoma-narrows")) assert.equal(TikTok.gecmisKuyrugu()[0].slug, "tacoma-narrows");
});

test("TikTok is retired: no workflow sends to it and no channel enables it", () => {
  for (const file of fs.readdirSync(path.join(KOK, ".github", "workflows"))) {
    const workflow = fs.readFileSync(path.join(KOK, ".github", "workflows", file), "utf8");
    assert.doesNotMatch(workflow, /tiktok-yukle\.js|TT_REFRESH_TOKEN|TT_CLIENT_SECRET/, file);
  }
  for (const slug of ["failure-reconstructed", "impossible-brief", "critical-thread", "behind-the-ordinary"]) {
    assert.equal(jsonOku(path.join(KOK, "channels", slug, "config.json"), {}).platforms.tiktok.enabled, false, slug);
  }
  const source = fs.readFileSync(path.join(KOK, ".github", "workflows", "uretim-is.yml"), "utf8");
  assert.match(source, /PRODUCTION_RESULT_PATH/);
  assert.doesNotMatch(source, /^\s*if:\s*!inputs/m, "YAML tag syntax must not break the reusable workflow");
});

test("pull-request E2E recognizes safe rejections from both quality gates", () => {
  const source = fs.readFileSync(path.join(KOK, ".github", "workflows", "test.yml"), "utf8");
  assert.match(source, /quality-gate\.json/);
  assert.match(source, /growth-plan\.json/);
  assert.match(source, /\["BLOCK", "REVIEW"\]\.includes\(gate\.decision\)/);
});

test("comment replies run independently every four hours with a conservative cap", () => {
  const replies = fs.readFileSync(path.join(KOK, ".github", "workflows", "yorum-yanitla.yml"), "utf8");
  const production = fs.readFileSync(path.join(KOK, ".github", "workflows", "uretim-is.yml"), "utf8");
  assert.match(replies, /cron: '17 1,5,9,13,17,21 \* \* \*'/);
  assert.match(replies, /group: portfolio-production/);
  assert.match(replies, /node yorum-yanitla\.js --channel failure-reconstructed --limit 4/);
  // State files are staged one at a time (git add stages nothing if any path is missing).
  assert.match(replies, /for STATE in icerik\/yanitlanan\.json icerik\/sabit-yorumlar\.json channels\/\*\/state\/replied-comments\.json channels\/\*\/state\/seeded-comments\.json/);
  assert.match(replies, /if \[ -e "\$STATE" \]; then git add "\$STATE"; fi/);
  // Every isolated channel replies and seeds with its own identity, only when publishing.
  assert.match(replies, /if: \$\{\{ always\(\) && vars\.IB_PUBLISH == '1' \}\}[\s\S]*?node yorum-yanitla\.js --channel impossible-brief --limit 4[\s\S]*?node seed-comment\.js --channel impossible-brief/);
  assert.match(replies, /if: \$\{\{ always\(\) && vars\.CT_PUBLISH == '1' \}\}[\s\S]*?node yorum-yanitla\.js --channel critical-thread --limit 4[\s\S]*?node seed-comment\.js --channel critical-thread/);
  assert.match(replies, /if: \$\{\{ always\(\) && vars\.BTO_PUBLISH == '1' \}\}[\s\S]*?node yorum-yanitla\.js --channel behind-the-ordinary --limit 4[\s\S]*?node seed-comment\.js --channel behind-the-ordinary/);
  assert.match(replies, /IB_YT_REFRESH_TOKEN: \$\{\{ secrets\.IB_YT_REFRESH_TOKEN \}\}/);
  assert.match(replies, /CT_YT_REFRESH_TOKEN: \$\{\{ secrets\.CT_YT_REFRESH_TOKEN \}\}/);
  assert.match(replies, /BTO_YT_REFRESH_TOKEN: \$\{\{ secrets\.BTO_YT_REFRESH_TOKEN \}\}/);
  assert.match(replies, /node pinned-comment\.js --post-pending/);
  assert.match(replies, /Persist processed comment IDs\s+if: always\(\)/);
  assert.match(replies, /git push origin HEAD:main/);
  assert.doesNotMatch(replies, /shorts-sira\.js|youtube-yukle\.js/);
  assert.doesNotMatch(production, /node yorum-yanitla\.js/);
});

test("comment reply classifier remains conservative and failed writes stay retryable", () => {
  const replies = require("../../yorum-yanitla");
  assert.equal(replies.kategori("Could this happen again?"), "soru");
  assert.equal(replies.kategori("👏👏"), "atla");
  assert.equal(replies.kategori("This is a detailed contribution with enough context to improve the discussion."), "bilgi");
  assert.equal(replies.kategori("Great video"), "ovgu");
  assert.equal(replies.apiHatasi({ durum: 403, govde: JSON.stringify({ error: { errors: [{ reason: "commentsDisabled" }] } }) }), "commentsDisabled");
  const source = fs.readFileSync(path.join(KOK, "yorum-yanitla.js"), "utf8");
  assert.match(source, /yanit basarisiz \(yeniden denenecek/);
  assert.match(source, /if \(basarisiz\) throw new Error/);
});

test("portfolio dry runs cannot upload, notify, or commit state", () => {
  const source = fs.readFileSync(path.join(KOK, ".github", "workflows", "portfolio-production.yml"), "utf8");
  assert.match(source, /if \[ "\$\{\{ inputs\.dry_run \}\}" != "true" \]; then\s+node bildirim\.js/s);
  assert.match(source, /name: Commit isolated state\s+if: always\(\) && inputs\.dry_run != true/);
});

test("REVIEW content is neither uploadable nor automatically scheduled", () => {
  const config = jsonOku(path.join(KOK, "config", "growth.json"), {});
  assert.deepEqual(config.publishing.schedule.gates, ["PUBLISH"]);
  const source = fs.readFileSync(path.join(KOK, "shorts-sira.js"), "utf8");
  const reviewGuard = source.indexOf('if (son.karar === "REVIEW")');
  const upload = source.indexOf("if (publish && uploadHazir())");
  assert.ok(reviewGuard > 0 && upload > reviewGuard, "REVIEW must be blocked before upload");
  assert.match(source, /incelemedekiler\(\).*incelemedeMi/s);
  const uploader = fs.readFileSync(path.join(KOK, "youtube-yukle.js"), "utf8");
  assert.match(uploader, /kapiKarari && kapiKarari !== "PUBLISH"/);
});

test("Cloudflare watchdog sends the independent repository_dispatch event", async () => {
  const worker = await import(pathToFileURL(path.join(KOK, "ops", "production-watchdog-worker", "src", "index.mjs")));
  let request = null;
  const result = await worker.dispatchWatchdog({ WATCHDOG_GITHUB_TOKEN: "test-token", GITHUB_REPOSITORY: "eyazan/youtube-otomasyon" }, async (url, options) => {
    request = { url, options };
    return { status: 204 };
  });
  assert.equal(result.ok, true);
  assert.equal(JSON.parse(request.options.body).event_type, "production-sla-watchdog");
  assert.match(request.url, /repos\/eyazan\/youtube-otomasyon\/dispatches$/);
  assert.doesNotMatch(JSON.stringify(result), /test-token/);
});

test("Cloudflare watchdog exposes deployment health and detailed non-204 errors", async () => {
  const worker = await import(pathToFileURL(path.join(KOK, "ops", "production-watchdog-worker", "src", "index.mjs")));
  const env = { WATCHDOG_GITHUB_TOKEN: "test-token", GITHUB_REPOSITORY: "eyazan/youtube-otomasyon",
    WATCHDOG_CRON: "35 16 * * *", PRODUCTION_DEADLINE_UTC: "16:30", WATCHDOG_VERSION: "v-test", WATCHDOG_COMMIT: "abc123" };
  const health = await worker.default.fetch(new Request("https://watchdog.example/health"), env);
  const body = await health.json();
  assert.deepEqual({ tokenConfigured: body.tokenConfigured, repository: body.repository, cron: body.cron,
    deadlineUtc: body.deadlineUtc, version: body.version, commit: body.commit }, {
    tokenConfigured: true, repository: "eyazan/youtube-otomasyon", cron: "35 16 * * *",
    deadlineUtc: "16:30", version: "v-test", commit: "abc123",
  });
  await assert.rejects(() => worker.dispatchWatchdog(env, async () => ({
    status: 403, statusText: "Forbidden", headers: { get: () => "request-123" }, text: async () => '{"message":"Resource not accessible"}',
  })), /403.*request-123.*Resource not accessible/);
});

test("watchdog workflows enforce safe recovery, deployment evidence and no-production self-test", () => {
  const production = fs.readFileSync(path.join(KOK, ".github", "workflows", "production-watchdog.yml"), "utf8");
  const deploy = fs.readFileSync(path.join(KOK, ".github", "workflows", "deploy-watchdog.yml"), "utf8");
  const selfTest = fs.readFileSync(path.join(KOK, ".github", "workflows", "watchdog-self-test.yml"), "utf8");
  const reusable = fs.readFileSync(path.join(KOK, ".github", "workflows", "uretim-is.yml"), "utf8");
  assert.match(production, /types: \[production-sla-watchdog, production-sla-watchdog-self-test\]/);
  assert.match(production, /needs\.sla\.outputs\.safe_to_recover == 'true'/);
  assert.match(production, /vars\.IB_PUBLISH == '1'/);
  assert.match(production, /needs\.ib-sla\.outputs\.safe_to_recover == 'true'/);
  assert.match(production, /vars\.CT_PUBLISH == '1'/);
  assert.match(production, /needs\.ct-sla\.outputs\.safe_to_recover == 'true'/);
  assert.match(production, /vars\.BTO_PUBLISH == '1'/);
  assert.match(production, /needs\.bto-sla\.outputs\.safe_to_recover == 'true'/);
  assert.match(deploy, /CLOUDFLARE_ACCOUNT_ID is required/);
  assert.match(deploy, /watchdog-deployment-evidence/);
  assert.match(deploy, /\.tokenConfigured == true/);
  assert.match(selfTest, /production-sla-watchdog-self-test/);
  assert.match(selfTest, /videoProductionStarted:false/);
  assert.doesNotMatch(selfTest, /uretim-is\.yml|shorts-sira\.js|youtube-yukle\.js/);
  assert.match(reusable, /inputs\.force \}\}" != "true".*github\.event_name.*!= "schedule"/s);
});

test("daily operations report covers all channels and TikTok only for Failure Reconstructed", () => {
  const report = DailyReport.build(new Date("2026-09-27T17:10:00.000Z"));
  assert.deepEqual(report.channels.map((row) => row.channel).sort(), ["behind-the-ordinary", "critical-thread", "failure-reconstructed", "impossible-brief"]);
  const fr = report.channels.find((row) => row.channel === "failure-reconstructed");
  const ib = report.channels.find((row) => row.channel === "impossible-brief");
  const ct = report.channels.find((row) => row.channel === "critical-thread");
  const bto = report.channels.find((row) => row.channel === "behind-the-ordinary");
  assert.ok(fr.tiktok);
  assert.equal(ib.tiktok, null);
  assert.equal(ct.tiktok, null);
  assert.equal(bto.tiktok, null);
  assert.equal(typeof fr.inventory.duplicateRate, "number");
  assert.equal(fr.inventory.acceptance.minimumQualifiedTopics, 500);
  assert.equal(ib.inventory.acceptance.minimumQualifiedTopics, 1000);
  assert.equal(ct.inventory.acceptance.minimumQualifiedTopics, 500);
  assert.equal(bto.inventory.acceptance.minimumQualifiedTopics, 500);
  assert.match(DailyReport.markdown(report), /TikTok backlog/);
});
