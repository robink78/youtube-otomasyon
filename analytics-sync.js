#!/usr/bin/env node
"use strict";

// ANALYTICS SYNC — incremental YouTube Analytics warehouse load for ONE channel
// (core/analytics/warehouse.js). Read-only: it never writes to YouTube.
//
//   node analytics-sync.js --channel impossible-brief                # incremental
//   node analytics-sync.js --channel impossible-brief --backfill-days 365
//
// The authenticated channel is verified against the channel's configured
// UC… ID before any row is written, so data can never land in another
// channel's partition.

const fs = require("fs");
const path = require("path");
const Channel = require("./core/channel-context");
const Warehouse = require("./core/analytics/warehouse");
const Ops = require("./lib/ops-log");

function publishedVideos(channel) {
  const legacy = channel.config.pathMode === "legacy-adapter";
  const file = path.join(channel.paths.state, legacy ? "yayinlananlar.json" : "published.json");
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) {}
  return (Array.isArray(rows) ? rows : []).filter((row) => row && row.videoId && (!row.channel || row.channel === channel.slug))
    .map((row) => ({ videoId: row.videoId, contentType: row.format === "long" ? "long" : "short", publishedDay: String(row.publishAt || row.tarih || "").slice(0, 10) || null }));
}

async function main(argv = process.argv.slice(2)) {
  const selected = Channel.selectFromArgv(argv);
  const channel = selected.channel;
  const index = selected.argv.indexOf("--backfill-days");
  const backfillDays = index >= 0 ? Number(selected.argv[index + 1]) : Warehouse.DEFAULT_BACKFILL_DAYS;
  // Analytics data moves daily; the hourly portfolio run syncs at most once a day.
  const last = Warehouse.readState(channel).lastSyncAt;
  if (!selected.argv.includes("--force") && index < 0 && last && Date.now() - Date.parse(last) < 20 * 3600000) {
    console.log(`[${channel.name}] analytics warehouse synced ${last}; next sync after 20 h (--force to override)`);
    return null;
  }
  let client;
  try {
    client = await require("./lib/yt").getYouTubeClient(channel, { attempts: 2 });
  } catch (error) {
    Ops.event(channel, "analytics.failure", { stage: "auth", code: error.code || "AUTH_FAILED" });
    console.error(`[${channel.name}] analytics sync skipped: ${error.code || "AUTH_FAILED"}`);
    process.exitCode = 3;
    return null;
  }
  const result = await Warehouse.sync(channel, client.api, { backfillDays, videos: publishedVideos(channel) });
  const failed = Object.entries(result.tables).filter(([, item]) => item.error && !item.optional).map(([table]) => table);
  Ops.event(channel, failed.length ? "analytics.partial" : "analytics.load", {
    tables: Object.fromEntries(Object.entries(result.tables).map(([table, item]) => [table, item.error ? "error" : item.skipped ? "skipped" : item.loaded])),
    freshness: Warehouse.freshness(channel).newestDay,
  });
  for (const [table, item] of Object.entries(result.tables)) {
    console.log(`[${channel.name}] ${table}: ${item.error ? "ERROR " + item.error : item.skipped || `${item.loaded} rows loaded (${item.window.start}..${item.window.end}), ${item.rows} total`}`);
  }
  if (failed.length) process.exitCode = 4;
  return result;
}

if (require.main === module) main().catch((error) => { console.error("analytics sync failed: " + String(error.message).slice(0, 200)); process.exitCode = 1; });

module.exports = { main, publishedVideos };
