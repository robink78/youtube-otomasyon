// QUOTA — operation-aware YouTube Data API quota accounting (shared by all channels).
//
// One policy file (config/quota.json) holds every cost; no call site carries a
// magic number. Each channel keeps a ledger in its own state folder; the daily
// budget is per Google Cloud project (several channels can share one OAuth
// client project), so remaining units sum every channel ledger of the same
// project. The day boundary is midnight Pacific Time, when Google resets quota.
"use strict";

const fs = require("fs");
const path = require("path");

const POLICY_FILE = path.join(__dirname, "..", "config", "quota.json");
const LEDGER_FILE = "quota-ledger.json";
const KEEP_DAYS = 14;

function policy() { return JSON.parse(fs.readFileSync(POLICY_FILE, "utf8")); }

function cost(operation, p = policy()) {
  if (!Object.prototype.hasOwnProperty.call(p.costs, operation)) throw new Error(`unknown quota operation: ${operation}`);
  return p.costs[operation];
}

function quotaDay(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

// Google project number = the numeric prefix of the OAuth client ID (public,
// not a secret). Unknown → the channel is its own project.
function projectOf(channel) {
  const clientId = channel.credentials ? channel.credentials().clientId : "";
  const match = String(clientId || "").match(/^(\d+)-/);
  return match ? match[1] : `channel:${channel.slug}`;
}

// Operation from a Data API path ("playlistItems?part=..." + method).
function operationFor(resourcePath, method = "GET") {
  const resource = String(resourcePath || "").replace(/^\/?(upload\/)?youtube\/v3\//, "").split(/[?/]/)[0];
  if (resource === "thumbnails") return "thumbnails.set";
  const verb = method === "GET" ? "list" : method === "POST" ? "insert" : method === "PUT" ? "update" : method === "DELETE" ? "delete" : "list";
  return `${resource}.${verb}`;
}

function ledgerPath(channel) { return path.join(channel.paths.state, LEDGER_FILE); }

function readLedger(channel) {
  try { return JSON.parse(fs.readFileSync(ledgerPath(channel), "utf8")); } catch (error) { return { channel: channel.slug, days: {} }; }
}

function record(channel, operation, options = {}) {
  const p = options.policy || policy();
  let units;
  try { units = cost(operation, p); } catch (error) { return null; }
  const ledger = readLedger(channel);
  const day = quotaDay(options.now);
  ledger.project = options.project || ledger.project || projectOf(channel);
  ledger.channel = channel.slug;
  const entry = ledger.days[day] || { units: 0, ops: {} };
  entry.units += units;
  entry.ops[operation] = (entry.ops[operation] || 0) + 1;
  ledger.days[day] = entry;
  for (const key of Object.keys(ledger.days).sort().slice(0, -KEEP_DAYS)) delete ledger.days[key];
  if (options.write !== false) {
    fs.mkdirSync(path.dirname(ledgerPath(channel)), { recursive: true });
    fs.writeFileSync(ledgerPath(channel), JSON.stringify(ledger, null, 2) + "\n");
  }
  return { operation, units, dayUnits: entry.units };
}

// Units used today by every channel that shares this channel's project.
function usedToday(channel, channels = [channel], options = {}) {
  const day = quotaDay(options.now);
  const project = options.project || projectOf(channel);
  return channels.reduce((sum, other) => {
    const ledger = readLedger(other);
    const sameProject = (ledger.project || projectOf(other)) === project;
    return sum + (sameProject && ledger.days[day] ? ledger.days[day].units : 0);
  }, 0);
}

function canAfford(channel, operation, channels = [channel], options = {}) {
  const p = options.policy || policy();
  const used = usedToday(channel, channels, options);
  const needed = cost(operation, p);
  const budget = p.dailyUnitsPerProject - p.reserveUnits;
  return { ok: used + needed <= budget, used, needed, budget, project: options.project || projectOf(channel) };
}

module.exports = { POLICY_FILE, LEDGER_FILE, policy, cost, quotaDay, projectOf, operationFor, readLedger, record, usedToday, canAfford };
