"use strict";

// WEEKLY LONG-FORM LANE (PHASE 32N/32O). A separate content lane:
//   • own state: channels/<slug>/state/longform/{lane.json,episodes.json,packages/,research/}
//   • never reads or writes Shorts production state, never pauses Shorts
//   • one cycle per ISO week; reruns inside a cycle are idempotent
//   • quality over cadence: a cycle with no PUBLISH-grade candidate ends as
//     QUALITY_BLOCKED — expected behaviour, not a failure
//   • render/upload only when the channel enables it (growth-engine
//     longform.render.enabled) AND <PREFIX>_LONGFORM_PUBLISH=1

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const Channel = require("../channel-context");
const Config = require("./config");
const Store = require("./store");
const Context = require("./context");
const Longform = require("./longform");
const Analytics = require("./analytics");
const Funnel = require("./funnel");

const TERMINAL = new Set(["PUBLISHED", "QUALITY_BLOCKED", "REVIEW_REQUIRED", "READY_FOR_RENDER", "NO_CANDIDATE"]);
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function isoWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return `${d.getUTCFullYear()}-W${String(Math.ceil(((d - yearStart) / 86400000 + 1) / 7)).padStart(2, "0")}`;
}

function loadLane(channel) {
  const lane = Store.readState(channel, "longform", "lane.json", null) || { channel: channel.slug, cycles: [] };
  if (lane.channel !== channel.slug) throw new Error(`LONGFORM_ISOLATION_VIOLATION: lane for ${channel.slug} contains ${lane.channel}`);
  return lane;
}

function episodes(channel) { return Store.readState(channel, "longform", "episodes.json", []); }

function lastPublished(channel) {
  return episodes(channel).filter((item) => item.status === "PUBLISHED" && item.publishAt).map((item) => item.publishAt).sort().pop() || null;
}

function status(channel, now = new Date()) {
  const config = Config.forChannel(channel);
  const lane = loadLane(channel);
  const cycleId = isoWeek(now);
  const cycle = lane.cycles.find((item) => item.cycleId === cycleId) || null;
  const last = lastPublished(channel);
  // Calendar days (UTC dates), not 24-hour blocks: a Thursday 15:00 episode
  // makes the following Thursday exactly 7 days later, whatever the run time.
  const utcDay = (value) => { const d = new Date(value); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
  const daysSince = last ? (utcDay(now) - utcDay(last)) / 86400000 : Infinity;
  const cadenceDue = daysSince >= config.longform.cadenceDays;
  const preferredDay = (config.longform.publishDayPreference || []).includes(DAYS[now.getUTCDay()]);
  const overdue = daysSince >= config.longform.cadenceDays + 2;
  const due = config.longform.enabled && cadenceDue && (preferredDay || overdue || !last) && !(cycle && TERMINAL.has(cycle.status));
  return { channel: channel.slug, cycleId, cycle, lastPublished: last, daysSince: Number.isFinite(daysSince) ? Math.round(daysSince * 10) / 10 : null, cadenceDays: config.longform.cadenceDays, preferredDay, due,
    reason: !config.longform.enabled ? "long-form lane disabled" : cycle && TERMINAL.has(cycle.status) ? `cycle ${cycleId} already ${cycle.status}` : !cadenceDue ? `last long-form ${Math.round(daysSince)} d ago < ${config.longform.cadenceDays}` : !preferredDay && !overdue && last ? "waiting for preferred publish day" : "due" };
}

// Evidence from this channel's own Shorts (never another channel's).
function shortsEvidence(channel, cluster, rows) {
  const config = Config.forChannel(channel);
  const shorts = rows.filter((row) => row.channel === channel.slug && row.contentType === "short" && row.metrics && Number.isFinite(row.metrics.views));
  if (!shorts.length) return null;
  const views = shorts.map((row) => row.metrics.views).sort((a, b) => a - b);
  const median = views[Math.floor(views.length / 2)] || 0;
  const inCluster = shorts.filter((row) => row.topicCluster === cluster);
  if (!inCluster.length) return null;
  const best = Math.max(...inCluster.map((row) => row.metrics.views));
  const channelSubs = shorts.map((row) => row.normalized && row.normalized.subscriberConversion).filter(Number.isFinite).sort((a, b) => a - b);
  const medianSubs = channelSubs.length ? channelSubs[Math.floor(channelSubs.length / 2)] : null;
  const bestSubs = Math.max(...inCluster.map((row) => row.normalized && row.normalized.subscriberConversion).filter(Number.isFinite), 0);
  const bestGrowth = Math.max(...inCluster.map((row) => row.performance && row.performance.growthScore).filter(Number.isFinite), 50);
  const outperform = median && best >= Math.max(config.longform.shortsEvidence.minimumViews, median * config.longform.shortsEvidence.outperformerViewsMultiple);
  const viewSignal = median ? Math.max(0, Math.min(100, 50 + (best / median - 1) * 25)) : 50;
  const subscriberSignal = medianSubs && bestSubs ? Math.max(0, Math.min(100, 50 + (bestSubs / medianSubs - 1) * 25)) : 50;
  const score = Math.round(viewSignal * 0.4 + subscriberSignal * 0.3 + bestGrowth * 0.3);
  return { score: Math.max(30, Math.min(100, score)), note: `best cluster Short ${best} views vs channel median ${median}; best subscriber conversion ${bestSubs || "unavailable"}; best growth score ${bestGrowth}${outperform ? " — MODE B: Short proved demand" : ""}`, modeB: !!outperform, bestViews: best, bestSubscriberConversion: bestSubs || null, bestGrowthScore: bestGrowth };
}

function candidates(channel, ctx, options = {}) {
  const published = new Set(episodes(channel).map((item) => item.slug));
  const blockedThisCycle = new Set(options.skip || []);
  const performance = Analytics.readAll(channel);
  const shortsByCluster = {};
  for (const row of ctx.history.published) {
    const topic = ctx.inventory.find((item) => item.slug === row.slug || item.id === row.topicId);
    if (topic) shortsByCluster[topic.cluster] = (shortsByCluster[topic.cluster] || 0) + 1;
  }
  const rows = [];
  for (const topic of ctx.inventory) {
    if (published.has(topic.slug) || blockedThisCycle.has(topic.slug)) continue;
    const evidence = shortsEvidence(channel, topic.cluster, performance);
    const potential = Context.evaluateLong(topic, ctx, { shortsEvidence: evidence, relatedCount: shortsByCluster[topic.cluster] || 0 });
    if (potential.bucket === "D") continue;
    rows.push({ topic, potential, mode: evidence && evidence.modeB ? "B_SHORT_PROVES_DEMAND" : "A_LONG_FIRST" });
  }
  rows.sort((a, b) => ({ A: 0, B: 1, C: 2 }[a.potential.bucket] - { A: 0, B: 1, C: 2 }[b.potential.bucket]) || b.potential.LongFormPotentialScore - a.potential.LongFormPotentialScore);
  return rows;
}

async function runCycle(channel, options = {}) {
  const now = options.now || new Date();
  const config = Config.forChannel(channel);
  const state = status(channel, now);
  if (!state.due && !options.force) return { channel: channel.slug, ran: false, status: state };
  const lane = loadLane(channel);
  const ctx = options.context || Context.build(channel);
  const list = candidates(channel, ctx, options);
  const cycle = { cycleId: state.cycleId, channel: channel.slug, startedAt: now.toISOString(), status: "RUNNING", evaluated: [], selected: null };
  lane.cycles = lane.cycles.filter((item) => item.cycleId !== cycle.cycleId).concat(cycle);
  if (options.write !== false) Store.writeState(channel, "longform", "lane.json", lane);
  if (!list.length) {
    cycle.status = "NO_CANDIDATE";
    cycle.reason = "no long-form candidate above bucket D — needs ResearchPackage enrichment";
  }
  const limit = options.maxCandidates || 3;
  let review = null;
  let deferred = null;
  for (const row of list.slice(0, limit)) {
    const pkg = await Longform.buildPackage(channel, row.topic, { context: ctx, potential: row.potential, llm: options.llm, research: options.research, offline: options.offline, write: options.write, now, providerDependencies: options.providerDependencies });
    cycle.evaluated.push({ slug: row.topic.slug, mode: row.mode, LongFormPotentialScore: row.potential.LongFormPotentialScore, bucket: row.potential.bucket, decision: pkg.readiness.decision, score: pkg.readiness.LongFormProductionReadinessScore, hardFails: pkg.readiness.hardFails, generationStatus: pkg.script.status });
    if (pkg.script.status === "DEFERRED") {
      deferred = { slug: row.topic.slug, pkg };
      break;
    }
    if (pkg.readiness.decision === "PUBLISH") { cycle.selected = row.topic.slug; cycle.package = pkg; break; }
    if (pkg.readiness.decision === "REVIEW" && !review) review = { slug: row.topic.slug, pkg };
  }
  if (cycle.selected) {
    const renderAllowed = !!(config.longform.render && config.longform.render.enabled) && process.env[`${channel.prefix}_LONGFORM_PUBLISH`] === "1";
    if (renderAllowed && !options.dryRun) {
      const result = renderAndUpload(channel, cycle.package);
      cycle.status = result.ok ? "PUBLISHED" : "RENDER_FAILED";
      cycle.render = result;
      if (result.ok) registerEpisode(channel, cycle.package, result, { write: options.write });
    } else {
      cycle.status = "READY_FOR_RENDER";
      cycle.reason = options.dryRun ? "dry run" : "render disabled for this channel (longform.render.enabled / LONGFORM_PUBLISH)";
    }
  } else if (deferred) {
    cycle.status = "DEFERRED_PROVIDER";
    cycle.reason = `provider deferred ${deferred.slug}; retry this cycle and resume its checkpoint`;
    cycle.checkpoint = deferred.pkg.script.checkpoint;
  } else if (list.length) {
    cycle.status = review ? "REVIEW_REQUIRED" : "QUALITY_BLOCKED";
    cycle.reason = review ? `best candidate ${review.slug} is REVIEW (${review.pkg.readiness.LongFormProductionReadinessScore})` : "no candidate passed the long-form quality gate; cadence does not override quality";
  }
  const summary = cycle.package ? cycle.package.summary : null;
  delete cycle.package;
  cycle.finishedAt = new Date().toISOString();
  lane.cycles = lane.cycles.filter((item) => item.cycleId !== cycle.cycleId).concat(cycle).slice(-60);
  if (options.write !== false) Store.writeState(channel, "longform", "lane.json", lane);
  return { channel: channel.slug, ran: true, cycle, summary, status: state };
}

// Hands the approved package to the existing long-video chain. Failures are
// contained to the long-form lane.
function renderAndUpload(channel, pkg) {
  const job = `lf-${pkg.topic.slug}`.slice(0, 80);
  const renderDir = path.join(Channel.ROOT, "uretim", job);
  try {
    fs.mkdirSync(path.join(renderDir, "Voice"), { recursive: true });
    const text = pkg.script.sections.flatMap((section) => (section.paragraphs || []).map((paragraph) => paragraph.text)).join("\n\n");
    fs.writeFileSync(path.join(renderDir, "Voice", "SESLENDIRME-TAM-METIN.txt"), text + "\n");
    fs.writeFileSync(path.join(renderDir, "konu.json"), JSON.stringify({
      channel: channel.slug, format: "long", aspect: "16:9", baslik: pkg.titles.selected.title, baslik_en: pkg.titles.selected.title,
      aciklama: `${pkg.topic.title}\n\nSources:\n${pkg.researchPackage.sources.map((source) => `- ${source.name}: ${source.url}`).join("\n")}\n\nReconstructions and illustrations are labelled on screen. Narration uses a synthetic voice.`,
      etiketler: [pkg.topic.subject, pkg.topic.cluster].filter(Boolean), ses: Channel.getChannel(channel.slug).config.voice.voice, growthPackage: pkg.topic.slug,
    }, null, 2));
    for (const script of ["seslendir.js", "gorsel-bul.js", "video-yap.js"]) {
      const run = cp.spawnSync(process.execPath, [script, job], { cwd: Channel.ROOT, stdio: "inherit", timeout: 3 * 3600 * 1000 });
      if (run.status !== 0) return { ok: false, stage: script, reason: `${script} exit ${run.status}` };
    }
    const productionDir = path.join(channel.paths.production, job);
    if (productionDir !== renderDir) fs.cpSync(renderDir, productionDir, { recursive: true });
    const upload = cp.spawnSync(process.execPath, ["youtube-yukle.js", "--channel", channel.slug, job], { cwd: Channel.ROOT, stdio: "inherit", env: process.env });
    if (upload.status !== 0) return { ok: false, stage: "upload", reason: `youtube-yukle exit ${upload.status}` };
    const row = require("./runtime").publishedRow(channel, job);
    return { ok: !!(row && row.videoId), job, videoId: row && row.videoId, publishAt: row && (row.publishAt || row.tarih) };
  } catch (error) {
    return { ok: false, stage: "handoff", reason: error.message };
  }
}

function registerEpisode(channel, pkg, result, options = {}) {
  const list = episodes(channel);
  const row = { channel: channel.slug, slug: pkg.topic.slug, title: pkg.titles.selected.title, subject: pkg.topic.subject, cluster: pkg.topic.cluster, videoId: result.videoId, publishAt: result.publishAt || new Date().toISOString(), status: "PUBLISHED", primaryNext: pkg.nextVideos.primary_next_video, derivedShortSlugs: [] };
  const next = list.filter((item) => item.slug !== row.slug).concat(row);
  if (options.write !== false) Store.writeState(channel, "longform", "episodes.json", next);
  Analytics.registerVideo(channel, { videoId: result.videoId, channel: channel.slug, contentType: "long", slug: pkg.topic.slug, title: row.title, topicCluster: pkg.topic.cluster,
    titlePattern: pkg.titles.selected.pattern, thumbnailPattern: pkg.thumbnails.selected && pkg.thumbnails.selected.id, coldOpenType: pkg.coldOpens.selected && pkg.coldOpens.selected.type,
    storyStructure: pkg.outline.structure.join(">"), primary_next_video_id: pkg.nextVideos.primary_next_video && pkg.nextVideos.primary_next_video.videoId, content_cluster_id: pkg.topic.cluster }, options);
  Funnel.updateCluster(channel, pkg.topic.cluster, { type: "long", slug: pkg.topic.slug, videoId: result.videoId, title: row.title, channel: channel.slug }, options);
  for (const related of pkg.relatedShorts) {
    if (!related.short_video_id) continue;
    Funnel.linkShortToLong(channel, { slug: related.short_slug, videoId: related.short_video_id, channel: channel.slug },
      { slug: pkg.topic.slug, videoId: result.videoId, title: row.title, channel: channel.slug },
      { type: related.relationship_type, reason: related.relationship_reason, score: related.score }, options);
  }
  return row;
}

module.exports = { isoWeek, status, candidates, runCycle, renderAndUpload, registerEpisode, episodes, shortsEvidence, TERMINAL };
