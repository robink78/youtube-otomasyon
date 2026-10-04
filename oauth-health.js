#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const Channel = require("./core/channel-context");
const YouTube = require("./lib/yt");
const LibraryHealth = require("./core/analytics/library-health");

const DAY = 86400000;
const STATUS_RANK = Object.freeze({ "N/A": 0, PASS: 0, WARNING: 1, ERROR: 2, CRITICAL: 3 });
const STATUS_ICON = Object.freeze({ "N/A": "➖", PASS: "✅", WARNING: "⚠️", ERROR: "❌", CRITICAL: "❌" });

function scopePresent(scopes, wanted) {
  return new Set(Array.isArray(scopes) ? scopes : String(scopes || "").split(/\s+/).filter(Boolean)).has(wanted);
}

function safeError(error) {
  const code = error && error.code || (/CHANNEL_ID_UNAVAILABLE/.test(String(error && error.message)) ? "CHANNEL_ID_UNAVAILABLE" : "UNKNOWN_AUTH_ERROR");
  return {
    code,
    retryable: !!(error && error.retryable),
    status: error && error.status || null,
    errorSubtype: error && error.errorSubtype || null,
  };
}

function finding(name, status, message, code = null, extra = {}) {
  return { name, status, severity: status === "PASS" || status === "N/A" ? "INFO" : status, message, ...(code ? { code } : {}), ...extra };
}

function authorizationStatePath(channel) {
  return channel.config.pathMode === "legacy-adapter"
    ? path.join(Channel.ROOT, "config", "yetki.json")
    : path.join(channel.paths.state, "auth-state.json");
}

function readJson(file, fallback = null) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function authorizationDeadline(channel, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const state = options.authorizationState === undefined ? readJson(authorizationStatePath(channel), null) : options.authorizationState;
  const mode = String(state && (state.oauthMode || state.mod) || "unknown").toLowerCase();
  const authorizedAt = state && (state.authorizedAt || state.yetkiTarihi) || null;
  const explicitDeadline = state && (state.reauthDeadline || state.oauthReauthDeadline) || null;

  if (mode === "production" || mode === "in-production" || mode === "in_production") {
    return finding("oauth-reauth-deadline", "PASS", "OAuth app is recorded as In production; no fixed refresh-token expiry is assumed", "NO_FIXED_DEADLINE", {
      mode: "production", authorizedAt, deadline: null, daysRemaining: null, reliable: false,
    });
  }
  if (mode !== "testing") {
    return finding("oauth-reauth-deadline", "PASS", "OAuth publishing mode is unknown; live refresh validation is authoritative", "DEADLINE_UNKNOWN", {
      mode: mode || "unknown", authorizedAt, deadline: null, daysRemaining: null, reliable: false,
    });
  }

  const base = Date.parse(explicitDeadline || authorizedAt || "");
  if (!Number.isFinite(base)) {
    return finding("oauth-reauth-deadline", "WARNING", "Testing mode is recorded but the authorization timestamp is missing", "AUTHORIZATION_TIMESTAMP_MISSING", {
      mode: "testing", authorizedAt, deadline: null, daysRemaining: null, reliable: false,
    });
  }
  const deadlineMs = explicitDeadline ? base : base + 7 * DAY;
  const remaining = (deadlineMs - now.getTime()) / DAY;
  const deadline = new Date(deadlineMs).toISOString();
  if (remaining <= 0) return finding("oauth-reauth-deadline", "CRITICAL", `Testing-mode re-authorization deadline passed at ${deadline}`, "REAUTH_DEADLINE_EXPIRED", {
    mode: "testing", authorizedAt, deadline, daysRemaining: remaining, reliable: true, state: "EXPIRED",
  });
  if (remaining <= 2) return finding("oauth-reauth-deadline", "CRITICAL", `Testing-mode re-authorization is required within ${remaining.toFixed(1)} days`, "REAUTH_DEADLINE_CRITICAL", {
    mode: "testing", authorizedAt, deadline, daysRemaining: remaining, reliable: true, state: "CRITICAL",
  });
  if (remaining <= 7) return finding("oauth-reauth-deadline", "WARNING", `Testing-mode re-authorization is recommended within ${remaining.toFixed(1)} days`, "REAUTH_DEADLINE_WARNING", {
    mode: "testing", authorizedAt, deadline, daysRemaining: remaining, reliable: true, state: "WARNING",
  });
  return finding("oauth-reauth-deadline", "PASS", `${remaining.toFixed(1)} days remain before the recorded re-authorization deadline`, "REAUTH_DEADLINE_OK", {
    mode: "testing", authorizedAt, deadline, daysRemaining: remaining, reliable: true, state: "GREEN",
  });
}

function overallStatus(checks) {
  const worst = checks.reduce((current, item) => STATUS_RANK[item.status] > STATUS_RANK[current] ? item.status : current, "PASS");
  return worst === "PASS" ? "HEALTHY" : worst;
}

function inventoryFinding(channel, options = {}) {
  try {
    const inventory = options.inventory || LibraryHealth.calculate(channel);
    const days = Number(inventory.daysOfInventory == null ? inventory.readyShorts : inventory.daysOfInventory);
    const status = days <= 0 ? "ERROR" : days < 7 ? "WARNING" : "PASS";
    return finding("topic-inventory", status, `${days} days of unproduced topics`, days <= 0 ? "INVENTORY_EMPTY" : days < 7 ? "INVENTORY_LOW" : "INVENTORY_OK", { days });
  } catch (error) {
    return finding("topic-inventory", "ERROR", "channel-specific topic inventory could not be calculated", "INVENTORY_CHECK_FAILED");
  }
}

async function tiktokFinding(channel, options = {}) {
  if (!(channel.config.platforms && channel.config.platforms.tiktok && channel.config.platforms.tiktok.enabled)) {
    return finding("tiktok", "N/A", "not enabled for this channel", "CAPABILITY_NOT_ENABLED");
  }
  if (options.tiktokFinding) return options.tiktokFinding;
  try {
    const TikTok = require("./lib/tiktok");
    if (!TikTok.kimlikVar()) return finding("tiktok", "WARNING", "TikTok is enabled but its credentials are incomplete", "TIKTOK_CREDENTIALS_MISSING");
    const token = await (options.tiktokToken || TikTok.token)();
    const hasUpload = !token.kapsam || scopePresent(token.kapsam, "video.upload");
    return finding("tiktok", hasUpload ? "PASS" : "WARNING", hasUpload ? "refresh token and upload scope verified" : "video.upload scope is missing",
      hasUpload ? "TIKTOK_OK" : "TIKTOK_SCOPE_MISSING");
  } catch (error) {
    return finding("tiktok", "ERROR", "TikTok refresh validation failed", "TIKTOK_REFRESH_FAILED");
  }
}

async function check(channel = Channel.getChannel(), options = {}) {
  const credentials = channel.credentials();
  const expectedChannelId = credentials.expectedChannelId || channel.expectedChannelId() || null;
  const requiredNames = {
    clientId: channel.credentialNames.clientId[0],
    clientSecret: channel.credentialNames.clientSecret[0],
    refreshToken: channel.credentialNames.refreshToken[0],
    channelId: channel.credentialNames.channelId[0],
  };
  const missing = [
    !credentials.clientId && requiredNames.clientId,
    !credentials.clientSecret && requiredNames.clientSecret,
    !credentials.refreshToken && requiredNames.refreshToken,
    !expectedChannelId && requiredNames.channelId,
  ].filter(Boolean);
  // A channel still being onboarded (config "onboarding": true) with NO
  // credential or channel ID configured yet is reported as pending setup, not
  // as a failure, so the portfolio health stays green until the owner connects
  // it. Uploads stay blocked. Any partial configuration is checked normally.
  if (channel.config.onboarding === true && missing.length === Object.keys(requiredNames).length) {
    return {
      channel: channel.slug,
      channelName: channel.name,
      checkedAt: (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString(),
      credentialNames: requiredNames,
      checks: [finding("config", "N/A", `setup pending: connect the channel by configuring ${missing.join(", ")}`, "NOT_CONFIGURED", { missing })],
      status: "NOT_CONFIGURED",
      severity: "INFO",
      uploadAllowed: false,
      healthy: false,
      notConfigured: true,
      credentialsPresent: false,
      refreshTokenPresent: false,
      accessTokenRefresh: false,
      authenticatedChannelId: null,
      expectedChannelId: null,
      channelMatch: false,
      error: null,
    };
  }
  const checks = [];
  checks.push(finding("config", missing.length ? "CRITICAL" : "PASS",
    missing.length ? `missing required configuration: ${missing.join(", ")}` : "all channel-scoped OAuth configuration is present",
    missing.length ? "CONFIG_MISSING" : "CONFIG_OK", { missing }));
  if (credentials.partialPreferred) {
    checks.push(finding("credential-isolation", "CRITICAL", "preferred credential bundle is incomplete; legacy values were not mixed in", "PARTIAL_CREDENTIAL_MIGRATION"));
  } else if (credentials.legacyFallback) {
    checks.push(finding("credential-isolation", "WARNING", "legacy unscoped YT_* fallback is active for Failure Reconstructed", "LEGACY_CREDENTIAL_FALLBACK"));
  } else {
    checks.push(finding("credential-isolation", "PASS", "credential namespace is isolated to this channel", "CREDENTIALS_ISOLATED"));
  }

  let tok = null;
  let accessTokenRefresh = false;
  let scopes = [];
  let scopeSource = null;
  let refreshError = null;
  if (credentials.clientId && credentials.clientSecret && credentials.refreshToken) {
    try {
      tok = options.token
        ? await options.token(channel)
        : await YouTube.token(options.request || YouTube.istek, channel, options);
      accessTokenRefresh = true;
      checks.push(finding("refresh-token", "PASS", "refresh token obtained a fresh access token", "REFRESH_OK"));
    } catch (error) {
      refreshError = safeError(error);
      checks.push(finding("refresh-token", "CRITICAL", `refresh failed: ${refreshError.code}`, refreshError.code, { retryable: refreshError.retryable }));
    }
  } else {
    checks.push(finding("refresh-token", "CRITICAL", "refresh was not attempted because OAuth secrets are missing", "MISSING_SECRET"));
  }

  if (tok) {
    try {
      const resolved = options.scopes
        ? { scopes: options.scopes, source: "test-override" }
        : await YouTube.accessTokenScopes(tok, options.request || YouTube.istek);
      scopes = resolved.scopes;
      scopeSource = resolved.source;
      const missingScopes = YouTube.REQUIRED_SCOPES.filter((scope) => !scopePresent(scopes, scope));
      const missingUploadScopes = YouTube.UPLOAD_SCOPES.filter((scope) => missingScopes.includes(scope));
      checks.push(finding("scopes", missingUploadScopes.length ? "CRITICAL" : missingScopes.length ? "ERROR" : "PASS",
        missingScopes.length ? `missing required scopes: ${missingScopes.join(", ")}` : "required upload and analytics scopes are present",
        missingScopes.length ? "INSUFFICIENT_SCOPE" : "SCOPES_OK", { missingScopes, missingUploadScopes, source: scopeSource }));
    } catch (error) {
      const detail = safeError(error);
      checks.push(finding("scopes", "CRITICAL", `scope verification failed: ${detail.code}`, detail.code));
    }
  } else {
    checks.push(finding("scopes", "CRITICAL", "scope verification unavailable because refresh failed", "SCOPE_NOT_VERIFIED"));
  }

  let authenticatedChannelId = null;
  if (tok && expectedChannelId) {
    try {
      const api = YouTube.istemci(tok, options.request || YouTube.istek);
      const identity = options.identity ? await options.identity(tok, channel) : await YouTube.authenticatedChannel(api);
      authenticatedChannelId = identity.id || identity.actual || identity.authenticatedChannelId || null;
      checks.push(finding("channel", authenticatedChannelId === expectedChannelId ? "PASS" : "CRITICAL",
        authenticatedChannelId === expectedChannelId ? `authenticated channel verified (${authenticatedChannelId})` : `expected ${expectedChannelId}; authenticated ${authenticatedChannelId || "unavailable"}`,
        authenticatedChannelId === expectedChannelId ? "CHANNEL_MATCH" : "CHANNEL_MISMATCH",
        { expectedChannelId, authenticatedChannelId }));
    } catch (error) {
      const detail = safeError(error);
      checks.push(finding("channel", "CRITICAL", `authenticated channel verification failed: ${detail.code}`, detail.code, { expectedChannelId, authenticatedChannelId: null }));
    }
  } else {
    checks.push(finding("channel", "CRITICAL", expectedChannelId ? "channel verification unavailable because refresh failed" : "expected channel ID is missing",
      expectedChannelId ? "CHANNEL_NOT_VERIFIED" : "CHANNEL_ID_MISSING", { expectedChannelId, authenticatedChannelId: null }));
  }

  let deadline = authorizationDeadline(channel, options);
  if (!accessTokenRefresh && deadline.status !== "CRITICAL") {
    const recorded = deadline;
    deadline = finding("oauth-reauth-deadline", "CRITICAL", "authorization is unusable because live refresh validation failed", "AUTHORIZATION_EXPIRED", {
      mode: recorded.mode, authorizedAt: recorded.authorizedAt, deadline: recorded.deadline,
      daysRemaining: recorded.daysRemaining, reliable: recorded.reliable, state: "EXPIRED",
    });
  }
  checks.push(deadline);
  checks.push(inventoryFinding(channel, options));
  checks.push(await tiktokFinding(channel, options));

  // The re-authorization deadline is advisory: it is reported (up to CRITICAL)
  // but never blocks a channel whose live refresh, scope and identity checks
  // pass. A failed refresh already blocks through accessTokenRefresh.
  const uploadAllowed = !missing.length && accessTokenRefresh && authenticatedChannelId === expectedChannelId &&
    YouTube.UPLOAD_SCOPES.every((scope) => scopePresent(scopes, scope)) && !credentials.partialPreferred;
  const status = overallStatus(checks);
  return {
    channel: channel.slug,
    channelName: channel.name,
    checkedAt: (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString(),
    credentialNames: requiredNames,
    credentialSource: credentials.source || "channel-scoped",
    checks,
    status,
    severity: status === "HEALTHY" ? "INFO" : status,
    uploadAllowed,
    healthy: status === "HEALTHY",
    credentialsPresent: !!(credentials.clientId && credentials.clientSecret),
    refreshTokenPresent: !!credentials.refreshToken,
    accessTokenRefresh,
    authenticatedChannelId,
    expectedChannelId,
    channelMatch: !!authenticatedChannelId && authenticatedChannelId === expectedChannelId,
    youtubeDataApi: !!authenticatedChannelId,
    requiredScopes: Object.fromEntries(YouTube.REQUIRED_SCOPES.map((scope) => [scope, scopePresent(scopes, scope)])),
    scopeSource,
    error: refreshError || (status === "CRITICAL" ? { code: checks.find((item) => item.status === "CRITICAL").code } : null),
  };
}

function pexelsRequest(key) {
  return new Promise((resolve) => {
    const request = https.get("https://api.pexels.com/videos/search?query=ocean&per_page=1", {
      headers: { Authorization: key, "User-Agent": "youtube-automation-health" },
    }, (response) => { response.resume(); response.on("end", () => resolve(response.statusCode)); });
    request.on("error", () => resolve(0));
    request.setTimeout(20000, () => request.destroy());
  });
}

async function sharedServices(options = {}) {
  const key = String(process.env.PEXELS_KEY || "").trim();
  if (!key) return [finding("pexels", "WARNING", "PEXELS_KEY is not configured; Failure Reconstructed stock topics may be unavailable", "PEXELS_KEY_MISSING")];
  const status = await (options.pexelsCheck || pexelsRequest)(key);
  return [finding("pexels", status === 200 ? "PASS" : "ERROR", status === 200 ? "API credential verified" : `API validation failed (HTTP ${status || "network"})`,
    status === 200 ? "PEXELS_OK" : "PEXELS_FAILED")];
}

function aggregateReport(results, shared, options = {}) {
  const healthy = results.filter((result) => result.status === "HEALTHY").length;
  const warnings = results.filter((result) => result.status === "WARNING").length;
  const blocked = results.filter((result) => !result.uploadAllowed).length;
  const critical = results.filter((result) => result.status === "CRITICAL").length;
  return {
    title: "YouTube Automation Health",
    checkedAt: (options.now instanceof Date ? options.now : new Date(options.now || Date.now())).toISOString(),
    channels: results,
    sharedServices: shared,
    summary: { total: results.length, healthy, warnings, critical, blocked, requiresAction: results.length - healthy },
    status: critical ? "CRITICAL" : results.some((result) => result.status === "ERROR") || shared.some((item) => item.status === "ERROR") ? "ERROR"
      : warnings || shared.some((item) => item.status === "WARNING") ? "WARNING" : "HEALTHY",
  };
}

async function checkAll(options = {}) {
  const channels = options.channels || Object.keys(Channel.registry().channels)
    .map((slug) => Channel.getChannel(slug))
    .filter((channel) => channel.config.enabled !== false && channel.config.platforms.youtube.enabled !== false);
  const results = [];
  for (const channel of channels) {
    const channelOptions = options.channelOptions && options.channelOptions[channel.slug] || options;
    try { results.push(await check(channel, channelOptions)); }
    catch (error) {
      results.push({ channel: channel.slug, channelName: channel.name, checkedAt: new Date().toISOString(), status: "CRITICAL", severity: "CRITICAL", uploadAllowed: false,
        healthy: false, checks: [finding("health-check", "CRITICAL", `health checker failed safely: ${safeError(error).code}`, safeError(error).code)], error: safeError(error) });
    }
  }
  const shared = options.sharedFindings || await sharedServices(options);
  return aggregateReport(results, shared, options);
}

async function combineReports(directory, options = {}) {
  const expected = Object.keys(Channel.registry().channels).filter((slug) => Channel.registry().channels[slug].enabled !== false);
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
  const loaded = new Map();
  for (const file of files) {
    const value = readJson(path.join(directory, file), null);
    if (value && value.channel && Array.isArray(value.checks)) loaded.set(value.channel, value);
  }
  const results = expected.map((slug) => loaded.get(slug) || {
    channel: slug,
    channelName: Channel.getChannel(slug).name,
    checkedAt: new Date().toISOString(),
    status: "CRITICAL",
    severity: "CRITICAL",
    uploadAllowed: false,
    healthy: false,
    checks: [finding("health-check", "CRITICAL", "isolated channel health artifact is missing", "HEALTH_ARTIFACT_MISSING")],
    error: { code: "HEALTH_ARTIFACT_MISSING" },
  });
  return aggregateReport(results, options.sharedFindings || await sharedServices(options), options);
}

function checkCell(result, name) {
  const item = result.checks.find((candidate) => candidate.name === name);
  return item ? `${STATUS_ICON[item.status]} ${item.status}` : "?";
}

function markdownReport(report) {
  const lines = ["# YouTube Automation Health", "", `Checked: ${report.checkedAt}`, "", "| Channel | Refresh | Scopes | Channel ID | Auth deadline | Inventory | TikTok | Status |",
    "|---|---|---|---|---|---|---|---|"];
  for (const result of report.channels) {
    lines.push(`| ${result.channelName} | ${checkCell(result, "refresh-token")} | ${checkCell(result, "scopes")} | ${checkCell(result, "channel")} | ${checkCell(result, "oauth-reauth-deadline")} | ${checkCell(result, "topic-inventory")} | ${checkCell(result, "tiktok")} | **${result.status}** |`);
  }
  for (const result of report.channels) {
    lines.push("", `## ${result.channelName}`, "");
    for (const item of result.checks) lines.push(`- ${STATUS_ICON[item.status]} **${item.name}** — ${item.message}`);
    if (!result.uploadAllowed) lines.push("- ⛔ **Uploads blocked for this channel**");
  }
  lines.push("", "## Shared Services", "");
  for (const item of report.sharedServices) lines.push(`- ${STATUS_ICON[item.status]} **${item.name}** — ${item.message}`);
  lines.push("", "## Summary", "",
    `**${report.summary.healthy}/${report.summary.total} YouTube channels healthy**`,
    `${report.summary.blocked} channel(s) upload-blocked; ${report.summary.requiresAction} channel(s) require attention.`, "",
    "Actual refresh-token validation is authoritative. A re-authorization deadline is shown only for an app recorded as Testing (or when an explicit deadline is stored).",
    "");
  return lines.join("\n");
}

function valueAfter(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

async function main(argv = process.argv.slice(2), options = {}) {
  const combineDirectory = valueAfter(argv, "--combine");
  if (argv.includes("--check-all") || combineDirectory) {
    const report = combineDirectory ? await combineReports(path.resolve(combineDirectory), options) : await checkAll(options);
    const json = JSON.stringify(report, null, 2) + "\n";
    const markdown = markdownReport(report) + "\n";
    const jsonOutput = valueAfter(argv, "--json-output");
    const markdownOutput = valueAfter(argv, "--markdown-output");
    if (jsonOutput) fs.writeFileSync(path.resolve(jsonOutput), json);
    if (markdownOutput) fs.writeFileSync(path.resolve(markdownOutput), markdown);
    process.stdout.write(argv.includes("--format=json") ? json : markdown);
    if (report.status === "CRITICAL") process.exitCode = 4;
    return report;
  }
  const selected = Channel.selectFromArgv(argv);
  const result = await check(selected.channel, options);
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  if (!result.uploadAllowed && !result.notConfigured) process.exitCode = 4;
  return result;
}

if (require.main === module) main().catch((error) => {
  process.stdout.write(JSON.stringify({ healthy: false, uploadAllowed: false, error: safeError(error) }, null, 2) + "\n");
  process.exitCode = 4;
});

module.exports = {
  STATUS_RANK, scopePresent, safeError, finding, authorizationStatePath, authorizationDeadline, inventoryFinding,
  tiktokFinding, check, checkAll, sharedServices, aggregateReport, combineReports, markdownReport, main,
};
