// OPS LOG — structured, per-channel operational events (no secrets, ever).
//
//   <channel state>/ops/events.jsonl   one JSON object per line, newest last
//
// Every event is also printed as one "OPS {...}" line so GitHub Actions logs
// stay greppable. Keys that look like credentials are dropped and values that
// look like tokens are masked before anything is written or printed.
"use strict";

const fs = require("fs");
const path = require("path");

const MAX_LINES = 4000;
const SECRET_KEY = /token|secret|authorization|password|session|cookie|refresh|credential/i;
const SECRET_VALUE = /(ya29\.[0-9A-Za-z_-]+|1\/\/[0-9A-Za-z_-]{10,}|GOCSPX-[0-9A-Za-z_-]+|Bearer\s+[0-9A-Za-z._-]+|gh[pousr]_[0-9A-Za-z]{20,}|upload_id=[^&\s"]+)/g;

function redact(value, depth = 0) {
  if (depth > 6) return "[depth]";
  if (typeof value === "string") return value.replace(SECRET_VALUE, "[redacted]");
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? "[redacted]" : redact(item, depth + 1);
    return out;
  }
  return value;
}

function file(channel) { return path.join(channel.paths.state, "ops", "events.jsonl"); }

function event(channel, type, fields = {}, options = {}) {
  const entry = redact({ at: (options.now || new Date()).toISOString(), channel: channel.slug, type, ...fields });
  const line = JSON.stringify(entry);
  if (options.print !== false) console.log("OPS " + line);
  if (options.write !== false) {
    const target = file(channel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.appendFileSync(target, line + "\n");
    try {
      const lines = fs.readFileSync(target, "utf8").split("\n").filter(Boolean);
      if (lines.length > MAX_LINES) fs.writeFileSync(target, lines.slice(-MAX_LINES).join("\n") + "\n");
    } catch (error) {}
  }
  return entry;
}

function read(channel) {
  try { return fs.readFileSync(file(channel), "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch (error) { return []; }
}

// Counts by event type in the last `hours`, plus the latest event of each type.
function summary(channel, { hours = 24 * 7, now = new Date() } = {}) {
  const since = now.getTime() - hours * 3600000;
  const recent = read(channel).filter((item) => Date.parse(item.at) >= since);
  const counts = {};
  const latest = {};
  for (const item of recent) { counts[item.type] = (counts[item.type] || 0) + 1; latest[item.type] = item; }
  return { channel: channel.slug, hours, total: recent.length, counts, latest };
}

module.exports = { MAX_LINES, redact, file, event, read, summary };
