"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Quota = require("../../lib/quota");
const Ops = require("../../lib/ops-log");

const channel = (slug, clientId = "1012165386949-abc.apps.googleusercontent.com") => ({
  slug, paths: { state: fs.mkdtempSync(path.join(os.tmpdir(), "quota-")) }, credentials: () => ({ clientId }),
});

test("QUOTA-01: every cost comes from the policy file; unknown operations are refused", () => {
  const policy = Quota.policy();
  assert.equal(Quota.cost("videos.insert", policy), policy.costs["videos.insert"]);
  assert.equal(Quota.cost("playlistItems.list", policy), 1);
  assert.throws(() => Quota.cost("videos.teleport", policy), /unknown quota operation/);
  assert.equal(Quota.operationFor("playlistItems?part=snippet", "GET"), "playlistItems.list");
  assert.equal(Quota.operationFor("/upload/youtube/v3/videos?uploadType=resumable", "POST"), "videos.insert");
  assert.equal(Quota.operationFor("videos?part=snippet", "PUT"), "videos.update");
  assert.equal(Quota.operationFor("/upload/youtube/v3/thumbnails/set?videoId=x", "POST"), "thumbnails.set");
});

test("QUOTA-02: the budget is per Google project, shared by the channels on it, and resets on the Pacific day", () => {
  const now = new Date("2026-10-03T12:00:00Z");
  const a = channel("failure-reconstructed");
  const b = channel("impossible-brief");
  const other = channel("critical-thread", "999-other.apps.googleusercontent.com");
  for (let i = 0; i < 5; i += 1) Quota.record(a, "videos.insert", { now });
  Quota.record(b, "videos.insert", { now });
  Quota.record(other, "videos.insert", { now });
  const insert = Quota.cost("videos.insert");
  assert.equal(Quota.usedToday(a, [a, b, other], { now }), 6 * insert, "same project counted together, other project excluded");
  const check = Quota.canAfford(b, "videos.insert", [a, b, other], { now });
  assert.equal(check.ok, 6 * insert + insert <= check.budget);
  assert.equal(Quota.usedToday(a, [a, b], { now: new Date("2026-10-04T12:00:00Z") }), 0, "new Pacific day");
  assert.equal(Quota.quotaDay(new Date("2026-10-04T05:00:00Z")), "2026-10-03", "05:00 UTC is still the previous Pacific day");
  assert.equal(Quota.readLedger(a).project, "1012165386949");
});

test("OBS-01 / SEC-02: ops events are structured, per channel, and never carry credentials", () => {
  const fr = channel("failure-reconstructed");
  const ib = channel("impossible-brief");
  const entry = Ops.event(fr, "publish.retry", {
    attempt: 2, kind: "SERVER", accessToken: "ya29.abcdefghijk", note: "Bearer ya29.zzz and 1//0refresh_token_value_abc", sessionUrl: "https://x?upload_id=SECRET",
    nested: { client_secret: "GOCSPX-abcdef" },
  }, { print: false, now: new Date("2026-10-03T10:00:00Z") });
  const written = fs.readFileSync(Ops.file(fr), "utf8");
  for (const secret of ["ya29.abc", "ya29.zzz", "1//0refresh", "upload_id=SECRET", "GOCSPX-abcdef"]) assert.equal(written.includes(secret), false, secret);
  assert.equal(entry.accessToken, "[redacted]");
  assert.equal(entry.attempt, 2);
  assert.equal(Ops.read(ib).length, 0, "another channel's log is untouched");
  const summary = Ops.summary(fr, { hours: 24, now: new Date("2026-10-03T12:00:00Z") });
  assert.deepEqual(summary.counts, { "publish.retry": 1 });
});

test("the shared API client charges quota per call, but never from tests", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../lib/yt.js"), "utf8");
  assert.match(source, /if \(process\.env\.NODE_TEST_CONTEXT \|\| process\.env\.QUOTA_LEDGER === "0"\) return;/);
  assert.match(source, /const data = \(yol\) => \{ chargeQuota\(yol, "GET"\);/);
  assert.match(source, /chargeQuota\(yol, yontem\);/);
});
