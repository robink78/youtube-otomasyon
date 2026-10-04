#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");

const MARKER = "youtube-automation-health-state";

function valueAfter(argv, name) {
  const inline = argv.find((arg) => arg.startsWith(name + "="));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : null;
}

function transitionState(report) {
  return {
    status: report.status,
    channels: [...(report.channels || [])].sort((a, b) => a.channel.localeCompare(b.channel)).map((channel) => ({
      channel: channel.channel,
      status: channel.status,
      uploadAllowed: !!channel.uploadAllowed,
      checks: [...(channel.checks || [])].sort((a, b) => a.name.localeCompare(b.name)).map((check) => ({
        name: check.name,
        status: check.status,
        code: check.code || null,
      })),
    })),
    sharedServices: [...(report.sharedServices || [])].sort((a, b) => a.name.localeCompare(b.name)).map((check) => ({
      name: check.name,
      status: check.status,
      code: check.code || null,
    })),
  };
}

function stateMarker(state) {
  return `<!-- ${MARKER}:${Buffer.from(JSON.stringify(state)).toString("base64")} -->`;
}

function extractState(body) {
  const match = String(body || "").match(new RegExp(`<!--\\s*${MARKER}:([A-Za-z0-9+/=]+)\\s*-->`));
  if (!match) return null;
  try { return JSON.parse(Buffer.from(match[1], "base64").toString("utf8")); } catch (error) { return null; }
}

function stateMap(state) {
  const map = new Map();
  for (const channel of state && state.channels || []) {
    map.set(channel.channel, `${channel.status}/${channel.uploadAllowed ? "allowed" : "blocked"}`);
    for (const check of channel.checks || []) map.set(`${channel.channel}:${check.name}`, `${check.status}/${check.code || ""}`);
  }
  for (const check of state && state.sharedServices || []) map.set(`shared:${check.name}`, `${check.status}/${check.code || ""}`);
  return map;
}

function transitionComment(previous, next) {
  const before = stateMap(previous);
  const after = stateMap(next);
  const changes = [];
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    if (before.get(key) !== after.get(key)) changes.push(`- **${key}**: ${before.get(key) || "not reported"} → ${after.get(key) || "not reported"}`);
  }
  return ["Health status changed:", "", ...changes.slice(0, 30)].join("\n");
}

function githubRequest(token, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? null : JSON.stringify(body);
    const request = https.request({
      hostname: "api.github.com",
      path: requestPath,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "youtube-automation-health",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try { parsed = text ? JSON.parse(text) : null; } catch (error) {}
        if (response.statusCode >= 200 && response.statusCode < 300) resolve({ status: response.statusCode, data: parsed });
        else reject(Object.assign(new Error(`GitHub API request failed (HTTP ${response.statusCode})`), { status: response.statusCode }));
      });
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

async function locateIssue(client, repo, issueNumber) {
  if (issueNumber) return (await client("GET", `/repos/${repo}/issues/${issueNumber}`)).data;
  const issues = (await client("GET", `/repos/${repo}/issues?state=all&labels=saglik&per_page=100`)).data || [];
  return issues.find((issue) => extractState(issue.body))
    || issues.find((issue) => /YouTube Automation Health/i.test(issue.title || ""))
    || issues.find((issue) => Number(issue.number) === 74)
    || (issues.filter((issue) => issue.state === "open").length === 1 ? issues.find((issue) => issue.state === "open") : null)
    || null;
}

async function updateIssue(options) {
  const report = options.report;
  const markdown = options.markdown;
  const nextState = transitionState(report);
  const client = options.client;
  let issue = await locateIssue(client, options.repo, options.issueNumber);
  const title = `[Portfolio] YouTube Automation Health — ${report.status}`;
  const body = `${markdown.trim()}\n\n${stateMarker(nextState)}\n`;
  // Same contract as the previous per-channel health issue: it stays open while
  // anything needs attention and closes itself once every check is healthy.
  const desiredState = report.status === "HEALTHY" ? "closed" : "open";
  if (!issue && desiredState === "closed") return { issue: null, created: false, changed: false, commented: false };
  if (!issue) {
    try {
      issue = (await client("POST", `/repos/${options.repo}/issues`, { title, body, labels: ["saglik"] })).data;
    } catch (error) {
      if (error.status !== 422) throw error;
      issue = (await client("POST", `/repos/${options.repo}/issues`, { title, body })).data;
    }
    return { issue: issue.number, created: true, changed: true, commented: false };
  }

  const previousState = extractState(issue.body);
  const changed = JSON.stringify(previousState) !== JSON.stringify(nextState);
  // Comment before closing so the recovery note lands on the issue, then apply
  // the body/state edit. Body edits alone do not notify watchers.
  let commented = false;
  if (previousState && changed) {
    await client("POST", `/repos/${options.repo}/issues/${issue.number}/comments`, { body: transitionComment(previousState, nextState) });
    commented = true;
  }
  if (issue.title !== title || issue.body !== body || issue.state !== desiredState) {
    await client("PATCH", `/repos/${options.repo}/issues/${issue.number}`, { title, body, state: desiredState });
  }
  return { issue: issue.number, created: false, changed, commented };
}

async function main(argv = process.argv.slice(2)) {
  const reportFile = valueAfter(argv, "--report");
  const markdownFile = valueAfter(argv, "--markdown");
  if (!reportFile || !markdownFile) throw new Error("--report and --markdown are required");
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  if (!token || !repo) throw new Error("GITHUB_TOKEN and GITHUB_REPOSITORY are required");
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  const markdown = fs.readFileSync(markdownFile, "utf8");
  const issueNumber = Number(valueAfter(argv, "--issue-number") || process.env.YOUTUBE_HEALTH_ISSUE_NUMBER || 0) || null;
  const client = (method, requestPath, body) => githubRequest(token, method, requestPath, body);
  const result = await updateIssue({ report, markdown, repo, issueNumber, client });
  if (!result.issue) console.log("All channels healthy and no health issue exists; nothing to update.");
  else console.log(`Health issue #${result.issue}: ${result.created ? "created" : "updated"}; transition comment ${result.commented ? "posted" : "not needed"}.`);
  return result;
}

if (require.main === module) main().catch((error) => {
  console.error(`Health issue update failed: ${error.message}`);
  process.exitCode = 1;
});

module.exports = { MARKER, transitionState, stateMarker, extractState, transitionComment, locateIssue, updateIssue, main };
