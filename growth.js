#!/usr/bin/env node
"use strict";

// Growth engine CLI. Channel-aware; never prints secrets.
//
//   node growth.js status                         per-channel lane + inventory status
//   node growth.js report [--out reports/growth-dashboard.md]
//                                                 per-channel dashboard (PHASE 34)
//   node growth.js report --channel <slug>         detailed channel growth report
//   node growth.js backfill --channel failure-reconstructed
//                                                 import real legacy analytics and relearn
//   node growth.js dry-run [--channel <slug>]     full Short + long-form dry runs → reports/dry-runs/ (sandbox)
//   node growth.js simulate [--days 30]           30-day simulation → reports/growth-system-30d-simulation.md (sandbox)
//   node growth.js longform --channel <slug> [--dry-run] [--force]
//                                                 run this week's long-form cycle (quality gate; render only if enabled)
//   node growth.js research --channel <slug> --topic <slug>
//                                                 build/refresh the deep ResearchPackage for one topic

const fs = require("fs");
const path = require("path");
const Channel = require("./core/channel-context");

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [key, inline] = a.slice(2).split("=");
      if (inline !== undefined) out[key] = inline;
      else if (argv[i + 1] && !argv[i + 1].startsWith("--")) out[key] = argv[++i];
      else out[key] = true;
    } else out._.push(a);
  }
  return out;
}

async function main() {
  const a = args(process.argv.slice(2));
  const command = a._[0] || "status";
  const channels = a.channel ? [a.channel] : Object.keys(Channel.registry().channels);
  if (command === "status") {
    const Lane = require("./core/growth/lane");
    const Growth = require("./core/growth");
    for (const slug of channels) {
      const channel = Channel.getChannel(slug);
      const sel = Growth.selectShortTopic(channel);
      const lane = Lane.status(channel);
      console.log(`${channel.name}: Shorts inventory A${sel.inventory.A}/B${sel.inventory.B}/C${sel.inventory.C}/D${sel.inventory.D} · next ${sel.selected ? sel.selected.topic.slug : "none"} · long-form ${lane.cycleId} ${lane.due ? "DUE" : "not due"} (${lane.reason})`);
    }
    return 0;
  }
  if (command === "report") {
    const Report = require("./core/growth/report");
    if (a.channel) {
      const channel = Channel.getChannel(a.channel);
      const report = Report.detailedChannel(channel);
      const out = a.out || path.join("reports", channel.slug.replace(/-/g, "_"), "latest_growth_report.md");
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, Report.detailedMarkdown(report));
      fs.writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(report, null, 2) + "\n");
      console.log(`${channel.name} growth report → ${out}`);
      return 0;
    }
    const report = Report.build();
    const out = a.out || path.join("reports", "growth-dashboard.md");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Report.markdown(report));
    fs.writeFileSync(out.replace(/\.md$/, ".json"), JSON.stringify(report, null, 2) + "\n");
    console.log(`growth dashboard → ${out}`);
    return 0;
  }
  if (command === "backfill") {
    if (!a.channel) throw new Error("--channel is required for backfill");
    const Analytics = require("./core/growth/analytics");
    const Learning = require("./core/growth/learning");
    const Performance = require("./core/growth/performance");
    const Store = require("./core/growth/store");
    const Report = require("./core/growth/report");
    const channel = Channel.getChannel(a.channel);
    const result = Analytics.backfillLegacy(channel);
    const rows = Performance.refresh(channel, Analytics.readAll(channel));
    const learning = Learning.learn(channel, rows);
    const clusters = { channel: channel.slug, updatedAt: new Date().toISOString(), clusters: Performance.clusterStats(rows) };
    Store.writeState(channel, "growth", "clusters.json", clusters);
    const report = Report.detailedChannel(channel);
    const directory = path.join("reports", channel.slug.replace(/-/g, "_"));
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "latest_growth_report.md"), Report.detailedMarkdown(report));
    fs.writeFileSync(path.join(directory, "latest_growth_report.json"), JSON.stringify(report, null, 2) + "\n");
    fs.writeFileSync(path.join(directory, "backfill_result.json"), JSON.stringify({ ...result, learning: { shorts: learning.shorts.status, sampleSize: learning.shorts.sampleSize }, clusters: Object.keys(clusters.clusters).length, completedAt: new Date().toISOString() }, null, 2) + "\n");
    console.log(`${channel.name}: backfilled ${result.snapshots} real snapshot(s) for ${result.videos} video(s); ${result.skipped.length} skipped → ${directory}`);
    return 0;
  }
  if (command === "dry-run") {
    const DryRun = require("./core/growth/dry-run");
    const Longform = require("./core/growth/longform");
    const results = await DryRun.run({ channels, llm: Longform.llmAvailable() });
    for (const r of results) console.log(`${r.channel}: Short ${r.short ? `${r.short.topic} ${r.short.score} ${r.short.decision}${r.short.qualified ? "" : " (not scheduled: no qualified topic)"}` : "none"} · long-form ${r.long ? `${r.long.topic} ${r.long.score} ${r.long.decision}` : "none"}`);
    console.log("dry runs → reports/dry-runs/ (sandbox state; nothing rendered, uploaded or published)");
    return 0;
  }
  if (command === "simulate") {
    const Simulate = require("./core/growth/simulate");
    const days = Number(a.days) || 30;
    const results = [];
    for (const scenario of ["A", "B"]) results.push(await Simulate.run({ scenario, days, channels, start: a.start }));
    const out = a.out || path.join("reports", "growth-system-30d-simulation.md");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Simulate.markdown(results));
    const failed = results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `${r.scenario}: ${c.name}`));
    console.log(`simulation → ${out} · ${results.reduce((n, r) => n + r.checks.length, 0)} checks, ${failed.length} failed${failed.length ? ": " + failed.join("; ") : ""}`);
    return failed.length ? 1 : 0;
  }
  if (command === "longform") {
    if (!a.channel) throw new Error("--channel is required for longform");
    const Lane = require("./core/growth/lane");
    const Longform = require("./core/growth/longform");
    const channel = Channel.getChannel(a.channel);
    const result = await Lane.runCycle(channel, { dryRun: !!a["dry-run"], force: !!a.force, llm: Longform.llmAvailable() });
    if (!result.ran) { console.log(`${channel.name}: long-form not run — ${result.status.reason}`); return 0; }
    const Growth = require("./core/growth");
    console.log(`\n=== LONG-FORM RUN SUMMARY ===\n${result.summary ? Growth.printSummary(result.summary, { "Upload Status": result.cycle.status, "Video ID": result.cycle.render && result.cycle.render.videoId || "—" }) : `Channel: ${channel.name}\nStatus: ${result.cycle.status}\nReason: ${result.cycle.reason || "—"}`}`);
    for (const row of result.cycle.evaluated) console.log(`  evaluated ${row.slug}: LongFormPotential ${row.LongFormPotentialScore}/${row.bucket} → ${row.decision} ${row.score}${row.hardFails && row.hardFails.length ? " · " + row.hardFails.join("; ") : ""}`);
    // Quality blocks are expected behaviour: exit 0 so the workflow stays green.
    return result.cycle.status === "RENDER_FAILED" ? 1 : 0;
  }
  if (command === "research") {
    if (!a.channel || !a.topic) throw new Error("--channel and --topic are required for research");
    const Context = require("./core/growth/context");
    const Research = require("./core/growth/research");
    const channel = Channel.getChannel(a.channel);
    const topic = Context.build(channel).inventory.find((item) => item.slug === a.topic || item.id === a.topic);
    if (!topic) throw new Error("topic not found: " + a.topic);
    const deep = await Research.deepen(channel, topic, { fresh: !!a.fresh });
    console.log(`${channel.name} / ${topic.slug}: ${deep.status} · ${deep.claims.length} claims from "${deep.article || "—"}" · ${(deep.images || []).length} image candidates`);
    return 0;
  }
  console.error(`unknown command: ${command}`);
  return 2;
}

main().then((code) => process.exit(code || 0)).catch((error) => { console.error(`growth: ${error.message}`); process.exit(1); });
