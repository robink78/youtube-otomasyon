"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const Channel = require("../../core/channel-context");
const YouTube = require("../../lib/yt");
const OAuthHealth = require("../../oauth-health");
const IssueHealth = require("../../scripts/update-oauth-health-issue");

const ROOT = path.resolve(__dirname, "..", "..");
const NOW = new Date("2026-10-02T12:00:00.000Z");

function fakeChannel(slug = "critical-thread", overrides = {}) {
  const prefixes = { "failure-reconstructed": "FR", "impossible-brief": "IB", "critical-thread": "CT", "behind-the-ordinary": "BTO" };
  const prefix = prefixes[slug];
  const names = {
    clientId: [slug === "failure-reconstructed" ? "FR_YT_CLIENT_ID" : `${prefix}_YT_CLIENT_ID`.replace("IB_YT_", "IB_").replace("CT_YT_", "CT_")],
    clientSecret: [slug === "failure-reconstructed" ? "FR_YT_CLIENT_SECRET" : `${prefix}_YT_CLIENT_SECRET`.replace("IB_YT_", "IB_").replace("CT_YT_", "CT_")],
    refreshToken: [`${prefix}_YT_REFRESH_TOKEN`],
    channelId: [`${prefix}_YT_CHANNEL_ID`],
  };
  const channelId = `UC_${slug.replace(/-/g, "_").toUpperCase()}`;
  const credentials = {
    clientId: `${slug}-client-id-secret`, clientSecret: `${slug}-client-secret-value`, refreshToken: `${slug}-refresh-token-value`,
    expectedChannelId: channelId, names, source: "channel-scoped", legacyFallback: false, partialPreferred: false,
  };
  return {
    slug,
    name: { "failure-reconstructed": "Failure Reconstructed", "impossible-brief": "ImpossibleBrief", "critical-thread": "CriticalThread", "behind-the-ordinary": "The Hidden Logic of Things" }[slug],
    prefix,
    credentialNames: names,
    credentials: () => credentials,
    expectedChannelId: () => channelId,
    paths: { state: path.join(ROOT, "channels", slug, "state") },
    config: { enabled: true, pathMode: slug === "failure-reconstructed" ? "legacy-adapter" : "isolated", platforms: { youtube: { enabled: true }, tiktok: { enabled: slug === "failure-reconstructed" } } },
    ...overrides,
  };
}

function healthyOptions(channel, overrides = {}) {
  return {
    now: NOW,
    token: async () => ({ erisim: `${channel.slug}-short-lived-access`, kapsam: YouTube.REQUIRED_SCOPES.join(" ") }),
    identity: async () => ({ id: channel.expectedChannelId(), title: channel.name }),
    authorizationState: { oauthMode: "production", authorizedAt: "2026-09-20T00:00:00.000Z" },
    inventory: { daysOfInventory: channel.slug === "failure-reconstructed" ? 365 : channel.slug === "impossible-brief" ? 420 : 387 },
    ...(channel.slug === "failure-reconstructed" ? { tiktokFinding: OAuthHealth.finding("tiktok", "PASS", "verified", "TIKTOK_OK") } : {}),
    ...overrides,
  };
}

test("shared OAuth layer retries transient refresh and classifies failures without response bodies", async () => {
  let calls = 0;
  const channel = fakeChannel();
  const result = await YouTube.token(async () => {
    calls += 1;
    if (calls === 1) return { durum: 503, govde: JSON.stringify({ error: "temporarily_unavailable" }) };
    return { durum: 200, govde: JSON.stringify({ access_token: "short-lived-access", expires_in: 3600, scope: YouTube.REQUIRED_SCOPES.join(" ") }) };
  }, channel, { attempts: 2, delay: async () => {} });
  assert.equal(calls, 2);
  assert.equal(result.erisim, "short-lived-access");
  assert.equal(YouTube.classifyOAuthFailure(401, JSON.stringify({ error: "invalid_client" })).code, "INVALID_CLIENT");
  assert.equal(YouTube.classifyOAuthFailure(400, JSON.stringify({ error: "unauthorized_client" })).code, "UNAUTHORIZED_CLIENT");
  assert.equal(YouTube.classifyOAuthFailure(400, JSON.stringify({ error: "access_denied" })).code, "ACCESS_DENIED");
  assert.doesNotMatch(JSON.stringify(result), /client-secret-value|refresh-token-value/);
});

test("scope verification falls back to Google tokeninfo when refresh response omits scope", async () => {
  const channel = fakeChannel();
  const requests = [];
  const result = await OAuthHealth.check(channel, healthyOptions(channel, {
    token: async () => ({ erisim: "access-only", kapsam: "" }),
    request: async (options, body) => {
      requests.push(options);
      assert.equal(options.path, "/tokeninfo", "access token must not be placed in the URL");
      assert.equal(options.method, "POST");
      assert.equal(new URLSearchParams(body).get("access_token"), "access-only");
      return { durum: 200, govde: JSON.stringify({ scope: YouTube.REQUIRED_SCOPES.join(" ") }) };
    },
  }));
  assert.equal(result.scopeSource, "google-tokeninfo");
  assert.equal(result.checks.find((item) => item.name === "scopes").status, "PASS");
  assert.equal(requests.length, 1);
});

test("all four channels healthy are independently refreshed, scoped and identity checked", async () => {
  const channels = [fakeChannel("failure-reconstructed"), fakeChannel("impossible-brief"), fakeChannel("critical-thread"), fakeChannel("behind-the-ordinary")];
  const report = await OAuthHealth.checkAll({
    channels,
    now: NOW,
    channelOptions: Object.fromEntries(channels.map((channel) => [channel.slug, healthyOptions(channel)])),
    sharedFindings: [OAuthHealth.finding("pexels", "PASS", "verified", "PEXELS_OK")],
  });
  assert.equal(report.summary.healthy, 4);
  assert.equal(report.summary.blocked, 0);
  assert.equal(report.channels.every((item) => item.accessTokenRefresh && item.channelMatch && item.uploadAllowed), true);
  assert.deepEqual(report.channels.map((item) => item.checks.find((check) => check.name === "topic-inventory").days), [365, 420, 387, 387]);
});

test("missing refresh token is critical and names only the missing secret", async () => {
  const base = fakeChannel("impossible-brief");
  const channel = fakeChannel("impossible-brief", { credentials: () => ({ ...base.credentials(), refreshToken: "" }) });
  const result = await OAuthHealth.check(channel, healthyOptions(channel));
  assert.equal(result.uploadAllowed, false);
  assert.equal(result.checks.find((item) => item.name === "refresh-token").code, "MISSING_SECRET");
  assert.match(JSON.stringify(result), /IB_YT_REFRESH_TOKEN/);
});

test("invalid_grant is critical and does not expose credentials", async () => {
  const channel = fakeChannel();
  const result = await OAuthHealth.check(channel, healthyOptions(channel, {
    token: async () => { throw new YouTube.YouTubeAuthError("INVALID_GRANT", "access-token refresh failed"); },
  }));
  assert.equal(result.uploadAllowed, false);
  assert.equal(result.checks.find((item) => item.name === "refresh-token").code, "INVALID_GRANT");
  assert.doesNotMatch(JSON.stringify(result), /client-secret-value|refresh-token-value|short-lived-access/);
});

test("wrong authenticated channel ID is a critical per-channel upload block", async () => {
  const channel = fakeChannel();
  const result = await OAuthHealth.check(channel, healthyOptions(channel, { identity: async () => ({ id: "UC_WRONG" }) }));
  assert.equal(result.uploadAllowed, false);
  assert.equal(result.checks.find((item) => item.name === "channel").code, "CHANNEL_MISMATCH");
});

test("upload pre-flight rejects missing write scope and ambiguous mine=true identity before mutation", async () => {
  const channel = fakeChannel();
  await assert.rejects(() => YouTube.getYouTubeClient(channel, {
    attempts: 1,
    request: async (options) => {
      assert.equal(options.hostname, "oauth2.googleapis.com");
      return { durum: 200, govde: JSON.stringify({ access_token: "access", scope: YouTube.ANALYTICS_SCOPES.join(" ") }) };
    },
  }), (error) => error.code === "INSUFFICIENT_SCOPE");
  await assert.rejects(() => YouTube.authenticatedChannel({ data: async () => ({ ok: true, veri: { items: [{ id: "UC_ONE" }, { id: "UC_TWO" }] } }) }),
    (error) => error.code === "CHANNEL_ID_UNAVAILABLE");
});

test("missing repository-required scope is reported while force-ssl still governs upload permission", async () => {
  const channel = fakeChannel();
  const result = await OAuthHealth.check(channel, healthyOptions(channel, { scopes: YouTube.UPLOAD_SCOPES }));
  assert.equal(result.checks.find((item) => item.name === "scopes").code, "INSUFFICIENT_SCOPE");
  assert.equal(result.uploadAllowed, true, "analytics scope failure must not masquerade as invalid upload authorization");
  assert.equal(result.status, "ERROR");
});

test("one broken channel never masks or blocks the other three", async () => {
  const channels = [fakeChannel("failure-reconstructed"), fakeChannel("impossible-brief"), fakeChannel("critical-thread"), fakeChannel("behind-the-ordinary")];
  const options = Object.fromEntries(channels.map((channel) => [channel.slug, healthyOptions(channel)]));
  options["critical-thread"] = healthyOptions(channels[2], { token: async () => { throw new YouTube.YouTubeAuthError("TOKEN_REVOKED", "revoked"); } });
  const report = await OAuthHealth.checkAll({ channels, now: NOW, channelOptions: options, sharedFindings: [] });
  assert.deepEqual(report.channels.map((item) => item.uploadAllowed), [true, true, false, true]);
  assert.equal(report.summary.blocked, 1);
  assert.equal(report.summary.healthy, 3);
});

test("authorization deadline has warning, critical and expired thresholds", () => {
  const channel = fakeChannel();
  const state = (days) => ({ oauthMode: "testing", reauthDeadline: new Date(NOW.getTime() + days * 86400000).toISOString() });
  assert.equal(OAuthHealth.authorizationDeadline(channel, { now: NOW, authorizationState: state(5.2) }).status, "WARNING");
  assert.equal(OAuthHealth.authorizationDeadline(channel, { now: NOW, authorizationState: state(2) }).status, "CRITICAL");
  const expired = OAuthHealth.authorizationDeadline(channel, { now: NOW, authorizationState: state(-0.1) });
  assert.equal(expired.status, "CRITICAL");
  assert.equal(expired.state, "EXPIRED");
  assert.equal(OAuthHealth.authorizationDeadline(channel, { now: NOW, authorizationState: { oauthMode: "production" } }).code, "NO_FIXED_DEADLINE");
});

test("a near or passed re-auth deadline alerts but does not block a channel whose live refresh works", async () => {
  const channel = fakeChannel();
  for (const days of [1, -0.1]) {
    const result = await OAuthHealth.check(channel, healthyOptions(channel, {
      authorizationState: { oauthMode: "testing", reauthDeadline: new Date(NOW.getTime() + days * 86400000).toISOString() },
    }));
    assert.equal(result.status, "CRITICAL");
    assert.equal(result.uploadAllowed, true, `deadline ${days}d must not block a verified token`);
  }
});

test("secret masking keeps client secret, refresh token, access token and Authorization header out of reports", async () => {
  const channel = fakeChannel();
  const result = await OAuthHealth.check(channel, healthyOptions(channel));
  const output = JSON.stringify(result) + OAuthHealth.markdownReport({ checkedAt: NOW.toISOString(), channels: [result], sharedServices: [], summary: { healthy: 1, total: 1, blocked: 0, requiresAction: 0 } });
  for (const secret of [channel.credentials().clientId, channel.credentials().clientSecret, channel.credentials().refreshToken, `${channel.slug}-short-lived-access`, "Authorization: Bearer"]) {
    assert.equal(output.includes(secret), false, secret);
  }
  const tiktokHelper = fs.readFileSync(path.join(ROOT, "tiktok-yetki.js"), "utf8");
  assert.doesNotMatch(tiktokHelper, /JSON\.stringify\(j\)/, "provider token responses must not be serialized to logs");
});

test("TikTok is checked only for Failure Reconstructed and is N/A elsewhere", async () => {
  const channels = [fakeChannel("failure-reconstructed"), fakeChannel("impossible-brief"), fakeChannel("critical-thread"), fakeChannel("behind-the-ordinary")];
  const results = await Promise.all(channels.map((channel) => OAuthHealth.check(channel, healthyOptions(channel))));
  assert.equal(results[0].checks.find((item) => item.name === "tiktok").status, "PASS");
  assert.deepEqual(results.slice(1).map((item) => item.checks.find((check) => check.name === "tiktok").status), ["N/A", "N/A", "N/A"]);
});

test("partial FR migration never mixes scoped and legacy OAuth credential bundles", () => {
  const keys = ["FR_YT_CLIENT_ID", "FR_YT_CLIENT_SECRET", "FR_YT_REFRESH_TOKEN", "FR_YT_CHANNEL_ID", "YT_CLIENT_ID", "YT_CLIENT_SECRET", "YT_REFRESH_TOKEN", "YT_CHANNEL_ID"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.FR_YT_CLIENT_ID = "preferred-client";
    process.env.YT_CLIENT_SECRET = "legacy-secret";
    process.env.YT_REFRESH_TOKEN = "legacy-token";
    process.env.YT_CHANNEL_ID = "UC_LEGACY";
    const credentials = Channel.getChannel("failure-reconstructed").credentials();
    assert.equal(credentials.clientId, "preferred-client");
    assert.equal(credentials.clientSecret, "");
    assert.equal(credentials.refreshToken, "");
    assert.equal(credentials.partialPreferred, true);
  } finally {
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("issue notification state ignores countdown text and comments only on status transitions", async () => {
  const channel = fakeChannel();
  const first = await OAuthHealth.check(channel, healthyOptions(channel, { authorizationState: { oauthMode: "testing", reauthDeadline: "2026-10-07T12:00:00.000Z" } }));
  const second = await OAuthHealth.check(channel, healthyOptions(channel, { now: new Date("2026-10-02T18:00:00.000Z"), authorizationState: { oauthMode: "testing", reauthDeadline: "2026-10-07T12:00:00.000Z" } }));
  const report = (result) => ({ status: "WARNING", channels: [result], sharedServices: [] });
  assert.deepEqual(IssueHealth.transitionState(report(first)), IssueHealth.transitionState(report(second)));

  const previousState = IssueHealth.transitionState(report(first));
  const calls = [];
  const client = async (method, requestPath, body) => {
    calls.push({ method, requestPath, body });
    if (method === "GET") return { data: { number: 74, title: "old", body: `old\n${IssueHealth.stateMarker(previousState)}`, state: "open" } };
    return { data: {} };
  };
  const result = await IssueHealth.updateIssue({ report: report(second), markdown: "# report", repo: "owner/repo", issueNumber: 74, client });
  assert.equal(result.changed, false);
  assert.equal(result.commented, false);
  assert.equal(calls.some((call) => /comments$/.test(call.requestPath)), false);
});

test("health issue comments once on recovery, closes when healthy, and is not created while healthy", async () => {
  const channel = fakeChannel();
  const broken = await OAuthHealth.check(channel, healthyOptions(channel, {
    token: async () => { const error = new Error("refresh failed"); error.code = "INVALID_GRANT"; throw error; },
  }));
  const healthy = await OAuthHealth.check(channel, healthyOptions(channel));
  const report = (result) => ({ status: result.status === "HEALTHY" ? "HEALTHY" : "CRITICAL", channels: [result], sharedServices: [] });
  const calls = [];
  const client = async (method, requestPath, body) => {
    calls.push({ method, requestPath, body });
    if (method === "GET") return { data: { number: 74, title: "old", body: `old\n${IssueHealth.stateMarker(IssueHealth.transitionState(report(broken)))}`, state: "open" } };
    return { data: {} };
  };
  const recovered = await IssueHealth.updateIssue({ report: report(healthy), markdown: "# ok", repo: "owner/repo", issueNumber: 74, client });
  assert.equal(recovered.commented, true);
  const comment = calls.findIndex((call) => /comments$/.test(call.requestPath));
  const patch = calls.findIndex((call) => call.method === "PATCH");
  assert.ok(comment >= 0 && patch > comment, "recovery comment is posted before the issue is closed");
  assert.equal(calls[patch].body.state, "closed");
  assert.match(calls[comment].body.body, /CRITICAL\/.*→ HEALTHY/);

  const none = [];
  const empty = await IssueHealth.updateIssue({ report: report(healthy), markdown: "# ok", repo: "owner/repo", client: async (method, requestPath, body) => {
    none.push({ method, requestPath, body });
    return { data: method === "GET" ? [] : {} };
  } });
  assert.equal(empty.created, false);
  assert.equal(none.some((call) => call.method === "POST"), false);
});

test("legacy Failure Reconstructed pre-flight passes its channel explicitly and reauth helper saves a complete bundle", () => {
  assert.match(fs.readFileSync(path.join(ROOT, "shorts-sira.js"), "utf8"), /\["saglik\.js", "--channel", CHANNEL\.slug\]/);
  const helper = fs.readFileSync(path.join(ROOT, "youtube-yetki.js"), "utf8");
  assert.match(helper, /\["clientId", clientId\], \["clientSecret", clientSecret\]/);
  assert.equal(helper.split("\n").some((line) => /console\.(log|error)/.test(line) && /j\.refresh_token|j\.access_token|(?<!credentialNames\.)clientSecret\b/.test(line)), false);
});

test("all YouTube write entry points use the shared channel-aware auth guard", () => {
  for (const file of ["youtube-yukle.js", "youtube-guncelle.js", "youtube-playlist.js", "yorum-yanitla.js", "pinned-comment.js"]) {
    const source = fs.readFileSync(path.join(ROOT, file), "utf8");
    assert.match(source, /getYouTubeClient|verifyChannelIdentity/, file);
    assert.doesNotMatch(source, /hostname:\s*["']oauth2\.googleapis\.com/, `${file} must not implement runtime refresh separately`);
  }
});

test("OAuth Actions health isolates credentials, then writes one complete summary and persistent issue", () => {
  const source = fs.readFileSync(path.join(ROOT, ".github", "workflows", "youtube-oauth-health.yml"), "utf8");
  assert.match(source, /^  failure-reconstructed:/m);
  assert.match(source, /^  impossible-brief:/m);
  assert.match(source, /^  critical-thread:/m);
  assert.match(source, /^  behind-the-ordinary:/m);
  assert.match(source, /^  report:/m);
  assert.match(source, /node oauth-health\.js --channel failure-reconstructed/);
  assert.match(source, /node oauth-health\.js --channel impossible-brief/);
  assert.match(source, /node oauth-health\.js --channel critical-thread/);
  assert.match(source, /node oauth-health\.js --channel behind-the-ordinary/);
  assert.match(source, /node oauth-health\.js --combine/);
  assert.match(source, /GITHUB_STEP_SUMMARY/);
  assert.match(source, /update-oauth-health-issue\.js/);
  assert.match(source, /IB_CLIENT_ID: \$\{\{ secrets\.IB_CLIENT_ID \}\}/);
  assert.match(source, /CT_CLIENT_ID: \$\{\{ secrets\.CT_CLIENT_ID \}\}/);
  assert.match(source, /BTO_YT_CLIENT_ID: \$\{\{ secrets\.BTO_YT_CLIENT_ID \}\}/);
  assert.doesNotMatch(source, /vars\.IB_PUBLISH|vars\.CT_PUBLISH/);
  const frJob = source.split(/^  failure-reconstructed:/m)[1].split(/^  impossible-brief:/m)[0];
  const ibJob = source.split(/^  impossible-brief:/m)[1].split(/^  critical-thread:/m)[0];
  const ctJob = source.split(/^  critical-thread:/m)[1].split(/^  behind-the-ordinary:/m)[0];
  const btoJob = source.split(/^  behind-the-ordinary:/m)[1].split(/^  report:/m)[0];
  assert.doesNotMatch(frJob, /IB_CLIENT_ID|CT_CLIENT_ID|BTO_YT_CLIENT_ID/);
  assert.doesNotMatch(ibJob, /FR_YT_CLIENT_ID|CT_CLIENT_ID|BTO_YT_CLIENT_ID|\n      YT_REFRESH_TOKEN:/);
  assert.doesNotMatch(ctJob, /FR_YT_CLIENT_ID|IB_CLIENT_ID|BTO_YT_CLIENT_ID|\n      YT_REFRESH_TOKEN:/);
  assert.doesNotMatch(btoJob, /FR_YT_CLIENT_ID|IB_CLIENT_ID|CT_CLIENT_ID|\n      YT_REFRESH_TOKEN:/);
});
