"use strict";

// PER-CHANNEL GROWTH DASHBOARD (PHASE 34). Each channel is reported from its
// own state only; cross-channel infrastructure health is listed separately and
// performance baselines are never blended.

const fs = require("fs");
const path = require("path");
const Channel = require("../channel-context");
const Config = require("./config");
const Store = require("./store");
const Context = require("./context");
const Analytics = require("./analytics");
const Learning = require("./learning");
const Funnel = require("./funnel");
const Lane = require("./lane");
const Experiments = require("./experiments");
const Performance = require("./performance");
const TopicModel = require("./topic-model");

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; } }

function channelHealth(channel, now = new Date()) {
  const config = Config.forChannel(channel);
  const ranked = Context.rank(channel);
  const perf = Analytics.readAll(channel);
  const baselines = Analytics.baselines(channel, perf);
  const learning = Learning.read(channel);
  const relationships = Funnel.load(channel);
  const lane = Lane.status(channel, now);
  const laneState = Store.readState(channel, "longform", "lane.json", { cycles: [] });
  const episodes = Lane.episodes(channel);
  const clusters = Store.readState(channel, "growth", "clusters.json", { clusters: {} });
  const alerts = Store.readState(channel, "growth", "alerts.json", []).slice(-10);
  const experiments = Experiments.load(channel).experiments;
  const history = ranked.context.history;
  const durableInventory = TopicModel.durableInventory(channel).stats;
  const legacy = channel.config.pathMode === "legacy-adapter";
  const lastShort = history.published.filter((row) => (row.format || "short") === "short").map((row) => row.publishAt || row.tarih).filter(Boolean).sort().pop() || null;
  const enrichment = ranked.rows.filter((row) => row.score.bucket === "C" || row.score.enrichable).slice(0, 10).map((row) => ({ slug: row.topic.slug, bucket: row.score.bucket, reason: row.score.reasons.join("; ") }));
  const tiktok = channel.config.platforms.tiktok && channel.config.platforms.tiktok.enabled
    ? (() => { const t = readJson(path.join(Channel.ROOT, "icerik", "tiktok.json"), []); const rows = Array.isArray(t) ? t : []; return { enabled: true, mode: channel.config.platforms.tiktok.mode, recordedItems: rows.length, sent: rows.filter((row) => row.publishId).length, errors: rows.filter((row) => row.hata).length, last: rows.map((row) => row.tarih).sort().pop() || null }; })()
    : { enabled: false };
  return {
    channel: channel.slug,
    name: channel.name,
    shorts: {
      lastPublished: lastShort,
      published: history.published.filter((row) => (row.format || "short") === "short").length,
      inventory: ranked.distribution,
      durableInventory,
      nextSelection: (() => { const sel = require("./index").selectShortTopic(channel, { ranked, date: now.toISOString().slice(0, 10) }); return { slug: sel.selected ? sel.selected.topic.slug : null, reason: sel.reason }; })(),
      baseline: baselines.short,
    },
    longform: {
      lane: { cycleId: lane.cycleId, due: lane.due, reason: lane.reason, lastPublished: lane.lastPublished },
      lastCycle: laneState.cycles[laneState.cycles.length - 1] || null,
      episodes: episodes.length,
      backlog: (() => { try { return Lane.candidates(channel, ranked.context).slice(0, 5).map((row) => ({ slug: row.topic.slug, LongFormPotentialScore: row.potential.LongFormPotentialScore, bucket: row.potential.bucket, mode: row.mode })); } catch (error) { return []; } })(),
      baseline: baselines.long,
    },
    tiktok,
    clusters: { count: Object.keys(clusters.clusters || {}).length, integrity: Funnel.clusterIntegrity(channel) },
    funnel: {
      shortToLong: relationships.shortToLong.length,
      longToLong: relationships.longToLong.length,
      pendingRelatedVideoManualActions: relationships.manualActions.filter((item) => !item.done).length,
    },
    growth: { trackedVideos: perf.length, subscriberConversion: { shorts: baselines.short.subscribersPer1000Views, longform: baselines.long.subscribersPer1000Views } },
    learning: { shorts: { status: learning.shorts.status || "heuristics-only", sampleSize: learning.shorts.sampleSize, adopted: learning.shorts.adopted.length, hypotheses: learning.shorts.hypotheses.length }, longform: { status: learning.longform.status || "heuristics-only", sampleSize: learning.longform.sampleSize, adopted: learning.longform.adopted.length } },
    experiments: experiments.map((item) => ({ id: item.experiment_id, contentType: item.content_type, variable: item.variable, status: item.status, confidence: item.confidence })),
    enrichmentTasks: enrichment,
    alerts,
    legacyPaths: legacy,
  };
}

function infrastructure() {
  const workflows = fs.readdirSync(path.join(Channel.ROOT, ".github", "workflows")).filter((file) => file.endsWith(".yml"));
  return {
    workflows,
    channels: Object.keys(Channel.registry().channels),
    growthEngineConfig: fs.existsSync(Config.DEFAULTS_PATH),
    analyticsSupport: Analytics.SUPPORT,
  };
}

function build(now = new Date()) {
  const channels = Object.keys(Channel.registry().channels).map((slug) => channelHealth(Channel.getChannel(slug), now));
  return { generatedAt: now.toISOString(), note: "Per-channel baselines are computed separately and never blended.", channels, infrastructure: infrastructure() };
}

function markdown(report) {
  const out = [`# Growth dashboard`, "", `Generated ${report.generatedAt}. ${report.note}`, ""];
  for (const c of report.channels) {
    out.push(`## ${c.name}`, "");
    out.push(`**Shorts health** — last published ${c.shorts.lastPublished || "never"} · ${c.shorts.published} published · inventory A${c.shorts.inventory.A}/B${c.shorts.inventory.B}/C${c.shorts.inventory.C}/D${c.shorts.inventory.D} · next: ${c.shorts.nextSelection.slug || "—"} (${c.shorts.nextSelection.reason})`, "");
    out.push(`**Long-form health** — cycle ${c.longform.lane.cycleId}: ${c.longform.lastCycle ? c.longform.lastCycle.status + (c.longform.lastCycle.reason ? " — " + c.longform.lastCycle.reason : "") : "no cycle yet"} · episodes ${c.longform.episodes} · lane ${c.longform.lane.due ? "DUE" : "not due"} (${c.longform.lane.reason})`, "");
    if (c.tiktok.enabled) out.push(`**TikTok** — enabled (${c.tiktok.mode}); ${c.tiktok.recordedItems} recorded item(s)`, "");
    out.push(`**Long-form backlog** — ${c.longform.backlog.map((row) => `${row.slug} ${row.LongFormPotentialScore}/${row.bucket}`).join(", ") || "empty"}`, "");
    out.push(`**Content clusters** — ${c.clusters.count} · integrity ${c.clusters.integrity.ok ? "OK" : c.clusters.integrity.problems.join("; ")}`, "");
    out.push(`**Growth / subscriber conversion** — tracked ${c.growth.trackedVideos} · subs/1k Shorts ${c.growth.subscriberConversion.shorts ?? "n/a"} · subs/1k long ${c.growth.subscriberConversion.longform ?? "n/a"}`, "");
    out.push(`**Learning** — Shorts ${c.learning.shorts.status} (n=${c.learning.shorts.sampleSize}, adopted ${c.learning.shorts.adopted}) · Long-form ${c.learning.longform.status} (n=${c.learning.longform.sampleSize})`, "");
    out.push(`**Short → Long funnel** — ${c.funnel.shortToLong} link(s), ${c.funnel.longToLong} long→long, ${c.funnel.pendingRelatedVideoManualActions} pending RELATED_VIDEO_MANUAL_ACTION_REQUIRED`, "");
    if (c.enrichmentTasks.length) out.push(`**Research/source enrichment tasks**`, "", ...c.enrichmentTasks.slice(0, 5).map((task) => `- ${task.slug} (${task.bucket}): ${task.reason}`), "");
    if (c.alerts.length) out.push(`**Recent alerts**`, "", ...c.alerts.map((alert) => `- ${alert.date} ${alert.code}: ${alert.message}`), "");
  }
  out.push("## Cross-channel infrastructure", "", `Channels: ${report.infrastructure.channels.join(", ")} · workflows: ${report.infrastructure.workflows.length} · growth config present: ${report.infrastructure.growthEngineConfig}`, "");
  return out.join("\n") + "\n";
}

function latestChannelSnapshot(channel) {
  const directory = path.join(channel.paths.analytics, "kanal");
  if (!fs.existsSync(directory)) return null;
  const files = fs.readdirSync(directory).filter((file) => file.endsWith(".json")).sort();
  return files.length ? readJson(path.join(directory, files[files.length - 1]), null) : null;
}

function checkpointMetric(row, label, key) {
  const snapshot = row.checkpoints && row.checkpoints[label];
  return snapshot ? Performance.metricValue(snapshot, key) : null;
}

function countPatterns(rows, fields) {
  const counts = {};
  for (const field of fields) {
    const groups = {};
    for (const row of rows) {
      const value = row[field];
      if (value != null && value !== "") groups[value] = (groups[value] || 0) + 1;
    }
    counts[field] = Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([value, n]) => ({ value, n }));
  }
  return counts;
}

function rowSummary(row) {
  const n = row.normalized || {};
  const p = row.performance || {};
  return {
    videoId: row.videoId,
    slug: row.slug || null,
    title: row.title || row.slug || row.videoId,
    cluster: row.topicCluster || "uncategorized",
    hookType: row.hookType || null,
    selectedHook: row.selectedHook || row.firstLine || null,
    titlePattern: row.titlePattern || null,
    durationBucket: row.durationBucket || null,
    storyStructure: row.storyStructure || null,
    openingVisual: row.openingVisual || null,
    publishAt: row.publishAt || null,
    views: row.metrics && row.metrics.views,
    viewsPerHour: n.viewsPerHour,
    recentViewVelocity: n.recentViewVelocity,
    averagePercentageViewed: row.metrics && row.metrics.averagePercentageViewed,
    subscribersGained: row.metrics && row.metrics.subscribersGained,
    netSubscribers: row.metrics && row.metrics.netSubscribers,
    subscriberConversion: n.subscriberConversion,
    engagementRate: n.engagementRate,
    growthScore: p.growthScore,
    classification: p.classification,
    probableCauses: p.probableCauses || [],
  };
}

function rankBy(rows, getter, limit = 5) {
  return rows.filter((row) => Number.isFinite(getter(row)))
    .sort((a, b) => getter(b) - getter(a)).slice(0, limit).map(rowSummary);
}

function medianMetric(rows, getter) { return Performance.median(rows.map(getter)); }
function rate(numerator, denominator) { return Number.isFinite(numerator) && denominator > 0 ? Math.round(numerator / denominator * 100000) / 100000 : null; }

// Evidence-led, channel-isolated report used by the Failure Reconstructed
// operating loop. It reports correlations and missing measurements explicitly;
// it never fills an unavailable API metric with zero.
function detailedChannel(channel, now = new Date()) {
  const rows = Performance.refresh(channel, Analytics.readAll(channel), { write: false });
  const shorts = rows.filter((row) => row.contentType === "short" && row.metrics);
  const clusterMetrics = Performance.clusterStats(shorts);
  for (const [cluster, stats] of Object.entries(clusterMetrics)) {
    const own = shorts.filter((row) => (row.topicCluster || "uncategorized") === cluster);
    stats.medianGrowthScore = medianMetric(own, (row) => row.performance && row.performance.growthScore);
  }
  const rankedClusters = Object.entries(clusterMetrics).filter(([, value]) => value.n > 0)
    .sort((a, b) => (b[1].medianGrowthScore ?? -1) - (a[1].medianGrowthScore ?? -1));
  const channelSnapshot = latestChannelSnapshot(channel);
  const durableInventory = TopicModel.durableInventory(channel).stats;
  const totalViews = channelSnapshot && Number.isFinite(channelSnapshot.views)
    ? channelSnapshot.views : shorts.reduce((sum, row) => sum + ((row.metrics && row.metrics.views) || 0), 0);
  const totalSubscribers = channelSnapshot && Number.isFinite(channelSnapshot.subscribers) ? channelSnapshot.subscribers : null;
  const grossSubscribers = shorts.map((row) => row.metrics.subscribersGained).filter(Number.isFinite);
  const netSubscribers = shorts.map((row) => row.metrics.netSubscribers).filter(Number.isFinite);
  const sumGross = grossSubscribers.length ? grossSubscribers.reduce((a, b) => a + b, 0) : null;
  const sumNet = netSubscribers.length ? netSubscribers.reduce((a, b) => a + b, 0) : null;
  const plateaus = shorts.filter((row) => row.performance && row.performance.plateau);
  const breakouts = shorts.filter((row) => row.performance && row.performance.classification === "BREAKOUT");
  const learning = Learning.read(channel);
  const ctx = Context.build(channel, { performanceRows: shorts });
  const adjacent = [];
  const winnerClusters = new Set(breakouts.map((row) => row.topicCluster).filter(Boolean));
  if (winnerClusters.size) {
    for (const row of Context.rank(channel, { context: ctx }).rows) {
      if (winnerClusters.has(row.topic.cluster) && !adjacent.some((item) => item.cluster === row.topic.cluster && item.slug === row.topic.slug)) {
        adjacent.push({ slug: row.topic.slug, title: row.topic.title, cluster: row.topic.cluster, viralScore: row.score.ViralPotentialScore, selectionScore: row.score.SelectionScore });
      }
      if (adjacent.length >= 10) break;
    }
  }
  const weakest = [...shorts].filter((row) => Number.isFinite(row.performance && row.performance.growthScore))
    .sort((a, b) => a.performance.growthScore - b.performance.growthScore).slice(0, 5).map(rowSummary);
  const recommendations = [];
  if (plateaus.length) recommendations.push(`Treat ${plateaus.length} plateaued Short(s) as failed tests; prioritize their shared opening/cluster patterns for controlled alternatives, not duplicate reuploads.`);
  if (rankedClusters[0]) recommendations.push(`Exploit ${rankedClusters[0][0]} selectively: it has the strongest measured median growth score (${rankedClusters[0][1].medianGrowthScore ?? "n/a"}); retain the configured 25% exploration allocation.`);
  if (!grossSubscribers.length && netSubscribers.length) recommendations.push("Re-authorize/refresh analytics collection for gross subscribersGained/subscribersLost; historical files expose net change only, so gross subscriber conversion is intentionally unavailable.");
  if (breakouts.length && adjacent.length) recommendations.push(`Test adjacent, non-duplicate topics in breakout cluster(s): ${[...winnerClusters].join(", ")}.`);
  if (!shorts.length) recommendations.push("Run historical backfill before changing editorial weights; there are no measured Short records yet.");
  return {
    schema: "growth-channel-report/1",
    generatedAt: now.toISOString(),
    channel: channel.slug,
    channelName: channel.name,
    caveat: "Probable causes and patterns are correlations within this channel, not proof of recommendation-system causality.",
    snapshot: {
      totalViews,
      totalSubscribers,
      grossSubscribersGained: sumGross,
      netSubscribers: sumNet,
      subscriberConversion: rate(sumGross, shorts.reduce((sum, row) => sum + ((row.metrics && row.metrics.views) || 0), 0)),
      netSubscriberConversion: rate(sumNet, shorts.reduce((sum, row) => sum + ((row.metrics && row.metrics.views) || 0), 0)),
      medianShortViews: medianMetric(shorts, (row) => row.metrics.views),
      median24hViews: medianMetric(shorts, (row) => checkpointMetric(row, "24h", "views")),
      median48hViews: medianMetric(shorts, (row) => checkpointMetric(row, "48h", "views")),
      medianEngagementRate: medianMetric(shorts, (row) => row.normalized && row.normalized.engagementRate),
      bestCluster: rankedClusters[0] ? { cluster: rankedClusters[0][0], ...rankedClusters[0][1] } : null,
      weakestCluster: rankedClusters.length > 1 ? { cluster: rankedClusters[rankedClusters.length - 1][0], ...rankedClusters[rankedClusters.length - 1][1] } : null,
      trackedShorts: shorts.length,
      durableInventory,
    },
    rankings: {
      views: rankBy([...shorts], (row) => row.metrics.views),
      velocity: rankBy([...shorts], (row) => row.normalized && (row.normalized.recentViewVelocity ?? row.normalized.viewsPerHour)),
      retention: rankBy([...shorts], (row) => row.metrics.averagePercentageViewed),
      subscribersGained: rankBy([...shorts], (row) => row.metrics.subscribersGained),
      subscriberConversion: rankBy([...shorts], (row) => row.normalized && row.normalized.subscriberConversion),
      engagement: rankBy([...shorts], (row) => row.normalized && row.normalized.engagementRate),
      growthScore: rankBy([...shorts], (row) => row.performance && row.performance.growthScore),
    },
    bottomVideos: weakest,
    plateauAnalysis: {
      count: plateaus.length,
      videos: plateaus.map((row) => ({ ...rowSummary(row), plateau: row.performance.plateau })),
      commonPatterns: countPatterns(plateaus, ["hookType", "titlePattern", "topicCluster", "durationBucket", "storyStructure", "openingVisual"]),
      hypotheses: [...new Set(plateaus.flatMap((row) => row.performance.probableCauses || []))],
    },
    breakoutAnalysis: {
      count: breakouts.length,
      winners: breakouts.map(rowSummary),
      winningPatterns: countPatterns(breakouts, ["hookType", "titlePattern", "topicCluster", "durationBucket", "storyStructure", "openingVisual"]),
      adjacentFutureOpportunities: adjacent,
    },
    clusterPerformance: clusterMetrics,
    learnedPatterns: {
      highPerformance: learning.shorts.adopted || [],
      lowPerformance: learning.shorts.suppressed || [],
      hypotheses: learning.shorts.hypotheses || [],
      sampleSize: learning.shorts.sampleSize || 0,
      status: learning.shorts.status || "heuristics-only",
    },
    recommendations,
    metricAvailability: Analytics.supportMatrix(),
  };
}

function fmt(value, suffix = "") { return Number.isFinite(value) ? `${Math.round(value * 10000) / 10000}${suffix}` : "unavailable"; }
function videoLine(row) {
  return `- **${row.title || row.videoId}** (${row.videoId}) — views ${fmt(row.views)}, velocity ${fmt(row.recentViewVelocity ?? row.viewsPerHour)}/h, retention ${fmt(row.averagePercentageViewed, "%")}, subscribers ${fmt(row.subscribersGained)}, conversion ${fmt(row.subscriberConversion)}, engagement ${fmt(row.engagementRate)}, growth ${fmt(row.growthScore)} (${row.classification || "unclassified"})`;
}

function detailedMarkdown(report) {
  const s = report.snapshot;
  const out = [`# ${report.channelName} — latest growth report`, "", `Generated: ${report.generatedAt}`, "", `> ${report.caveat}`, "", "## Channel snapshot", "",
    `- Total channel views: ${fmt(s.totalViews)}`,
    `- Total subscribers: ${fmt(s.totalSubscribers)}`,
    `- Gross subscriber conversion: ${fmt(s.subscriberConversion)}${s.subscriberConversion == null ? " (historical gross acquisition unavailable)" : ""}`,
    `- Net subscriber conversion: ${fmt(s.netSubscriberConversion)}`,
    `- Median Short views: ${fmt(s.medianShortViews)}`,
    `- Median 24h / 48h views: ${fmt(s.median24hViews)} / ${fmt(s.median48hViews)}`,
    `- Median engagement rate: ${fmt(s.medianEngagementRate)}`,
    `- Durable inventory: ${fmt(s.durableInventory.total)} qualified records (${fmt(s.durableInventory.production_ready)} production-ready; ${fmt(s.durableInventory.research_backlog)} research backlog)`,
    `- Best cluster: ${s.bestCluster ? `${s.bestCluster.cluster} (median growth ${fmt(s.bestCluster.medianGrowthScore)})` : "unavailable"}`,
    `- Weakest cluster: ${s.weakestCluster ? `${s.weakestCluster.cluster} (median growth ${fmt(s.weakestCluster.medianGrowthScore)})` : "unavailable"}`, ""];
  out.push("## Top videos", "");
  for (const [dimension, rows] of Object.entries(report.rankings)) {
    out.push(`### By ${dimension}`, "", ...(rows.length ? rows.map(videoLine) : ["- No measured values." ]), "");
  }
  out.push("## Bottom videos", "", ...(report.bottomVideos.length ? report.bottomVideos.map((row) => `${videoLine(row)}${row.probableCauses.length ? ` — hypotheses: ${row.probableCauses.join("; ")}` : ""}`) : ["- No classified videos."]), "");
  out.push("## 1K–2K plateau analysis", "", `Affected videos: ${report.plateauAnalysis.count}`, "", ...(report.plateauAnalysis.videos.length ? report.plateauAnalysis.videos.map(videoLine) : ["- No plateau met the configured evidence rule."]), "");
  out.push("Hypotheses (correlation only):", "", ...(report.plateauAnalysis.hypotheses.length ? report.plateauAnalysis.hypotheses.map((item) => `- ${item}`) : ["- No supported hypothesis yet."]), "");
  out.push("## Breakout analysis", "", `Detected breakouts: ${report.breakoutAnalysis.count}`, "", ...(report.breakoutAnalysis.winners.length ? report.breakoutAnalysis.winners.map(videoLine) : ["- No video met the configured breakout rule."]), "", "Adjacent non-duplicate opportunities:", "", ...(report.breakoutAnalysis.adjacentFutureOpportunities.length ? report.breakoutAnalysis.adjacentFutureOpportunities.map((row) => `- ${row.title} (${row.cluster}) — viral ${fmt(row.viralScore)}, selection ${fmt(row.selectionScore)}`) : ["- None until a breakout cluster is measured."]), "");
  out.push("## Learned patterns", "", `Status: ${report.learnedPatterns.status}; measured sample n=${report.learnedPatterns.sampleSize}.`, "", "### High-performance patterns", "", ...(report.learnedPatterns.highPerformance.length ? report.learnedPatterns.highPerformance.map((row) => `- ${row.dimension}=${row.value}: lift ${fmt(row.lift)}, n=${row.sample}`) : ["- None adopted; sample/confidence threshold not met."]), "", "### Low-performance patterns", "", ...(report.learnedPatterns.lowPerformance.length ? report.learnedPatterns.lowPerformance.map((row) => `- ${row.dimension}=${row.value}: lift ${fmt(row.lift)}, n=${row.sample}`) : ["- None suppressed; sample/confidence threshold not met."]), "");
  out.push("## Next recommendations", "", ...(report.recommendations.length ? report.recommendations.map((item) => `- ${item}`) : ["- Continue collecting checkpoint data before changing weights."]), "");
  out.push("## API limitations", "", "Unavailable fields remain `null`, never zero. Viewed-vs-swiped-away, stayed-to-watch, impressions CTR, returning viewers per video, related-video writes and end-screen writes are not claimed by this automation; see the JSON report's `metricAvailability` matrix.", "");
  return out.join("\n") + "\n";
}

module.exports = { channelHealth, build, markdown, infrastructure, detailedChannel, detailedMarkdown, latestChannelSnapshot };
