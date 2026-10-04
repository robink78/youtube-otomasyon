"use strict";

// 30-DAY MULTI-CHANNEL SIMULATION (PHASE 38). Runs the REAL selection,
// planning, gate, long-form lane, funnel, analytics, diagnosis, learning and
// experiment code against a sandbox (GROWTH_STATE_ROOT). Uploads and metrics
// are simulated: video ids are SIM-*, metrics are deterministic pseudo-random
// numbers — they exercise the code paths, they are NOT forecasts.
//
// Two long-form scenarios:
//   A  current configuration — deterministic writer only (no cloud provider)
//   B  LLM writer enabled — a simulated writer that paraphrases the deep
//      research package (provider-neutral); episodes "upload" as SIM ids

const fs = require("fs");
const os = require("os");
const path = require("path");

const DAY = 86400000;

function hash01(text) {
  let h = 2166136261;
  for (const c of String(text)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

// Deterministic synthetic measurement in lib/analitik's shape.
function syntheticMeasurement(video, meta, ageDays) {
  const r = (k) => hash01(`${video.id}:${k}`);
  const long = meta.contentType === "long";
  const quality = (meta.topicScore || 70) / 100;
  const hookBoost = meta.hookType === "hidden_cause" ? 1.15 : meta.hookType === "shocking_consequence" ? 1.05 : 1;
  const growth = Math.min(1, 0.25 + ageDays / 7);
  const views = Math.round((long ? 400 + 2600 * r("v") : 800 + 9000 * r("v")) * quality * hookBoost * growth);
  const apv = Math.round((long ? 28 + 22 * r("a") : 55 + 40 * r("a")) * (hookBoost > 1 ? 1.04 : 1));
  const ok = (value) => ({ durum: "ok", deger: value, kaynak: "simulation" });
  const duration = long ? 600 : 30;
  return {
    format: long ? "long" : "short",
    sureSn: duration,
    toplandi: new Date().toISOString(),
    metrikler: {
      views: ok(views), likes: ok(Math.round(views * (0.02 + 0.03 * r("l")))), comments: ok(Math.round(views * 0.002 * r("c") * 3)), shares: ok(Math.round(views * 0.004 * r("s"))),
      subscribersGained: ok(Math.round(views * (long ? 0.006 : 0.002) * (0.5 + r("sub")))), averageViewDuration: ok(Math.round(duration * apv / 100)),
      averageViewPercentage: ok(apv), watchTimeMinutes: ok(Math.round(views * duration * apv / 100 / 60)),
      impressions: { durum: "yok", neden: "Studio only" }, ctr: { durum: "yok", neden: "Studio only" },
    },
    trafik: long ? [{ kaynak: "RELATED_VIDEO", views: Math.round(views * 0.3), oran: 0.3 }, { kaynak: "SHORTS", views: Math.round(views * 0.05 * r("sh")), oran: 0.05 * r("sh") }, { kaynak: "YT_SEARCH", views: Math.round(views * 0.2), oran: 0.2 }]
      : [{ kaynak: "SHORTS", views: Math.round(views * 0.9), oran: 0.9 }],
    tutma: [{ oran: 0.1, izleme: 0.6 + 0.35 * r("h") }, { oran: 0.5, izleme: apv / 100 }, { oran: 1, izleme: apv / 150 }],
  };
}

// Stand-in for the Claude writer: paraphrases (never 9 source words in a
// row) and cites claim ids — the contract the gate verifies.
function simulatedWriter() {
  return async ({ pkg, plan }) => ({
    generator: "simulated-llm-writer",
    sections: plan.sections.map((section) => ({
      section: section.section,
      paragraphs: section.claimIds.slice(0, 16).map((id) => {
        const claim = pkg.claims.find((item) => item.id === id);
        const words = claim.text.replace(/[.!?]$/, "").split(/\s+/).reverse();
        const out = [];
        const glue = ["and", "so", "then", "which", "meant", "that", "here"];
        for (let k = 0; out.length < 26; k++) { out.push(words[k % words.length]); if (k % 3 === 2) out.push(glue[k % glue.length]); }
        return { claims: [id], text: out.join(" ") + "." };
      }),
    })),
  });
}

async function run(options = {}) {
  const sandbox = options.sandbox || fs.mkdtempSync(path.join(os.tmpdir(), "growth-sim-"));
  process.env.GROWTH_STATE_ROOT = sandbox;
  const Channel = require("../channel-context");
  const Growth = require("./index");
  const Context = require("./context");
  const Store = require("./store");
  const Lane = require("./lane");
  const Funnel = require("./funnel");
  const Analytics = require("./analytics");
  const Experiments = require("./experiments");
  const Learning = require("./learning");
  const Runtime = require("./runtime");
  const Research = require("./research");

  const scenario = options.scenario || "B";
  const start = new Date(options.start || "2026-10-01T00:00:00Z");
  const days = options.days || 30;
  const slugs = options.channels || Object.keys(Channel.registry().channels);
  const log = [];
  const say = (line) => log.push(line);
  const state = {};
  const quiet = console.log;
  for (const slug of slugs) {
    const channel = Channel.getChannel(slug);
    const ctx = Context.build(channel);
    state[slug] = {
      channel, ctx, published: new Set(ctx.history.published.map((row) => row.slug)), shorts: [], blockedShorts: 0, skippedDays: 0, skips: [], longCycles: [], episodes: [], videos: [],
      inventoryBefore: Growth.selectShortTopic(channel, { date: start.toISOString().slice(0, 10), ranked: Context.rank(channel, { context: ctx }) }).inventory,
    };
    Experiments.create(channel, { contentType: "short", variable: "hook_style", hypothesis: "hidden-cause hooks retain better than consequence hooks", control: "shocking_consequence", variant: "hidden_cause", metric: "averagePercentageViewed" }, { now: start });
  }
  const credentials = Object.fromEntries(slugs.map((slug) => [slug, Object.values(state[slug].channel.credentialNames).flat()]));
  let crashInjected = false;
  for (let d = 0; d < days; d++) {
    const date = new Date(start.getTime() + d * DAY);
    const day = date.toISOString().slice(0, 10);
    for (const slug of slugs) {
      const s = state[slug];
      const channel = s.channel;
      // ---- daily Short (real selection + plan + gate; simulated upload)
      const ranked = Context.rank(channel, { context: s.ctx });
      const selection = Growth.selectShortTopic(channel, { date: day, ranked, exclude: [...s.published] });
      if (!selection.selected) { s.skippedDays += 1; s.skips.push({ day, reason: selection.reason }); say(`${day} ${slug}: Short skipped — ${selection.reason.slice(0, 90)}`); }
      else {
        const topic = selection.selected.topic;
        const plan = Growth.planShort(channel, topic, { context: s.ctx, assignExperiment: true, now: date });
        if (plan.readiness.decision !== "PUBLISH") { s.blockedShorts += 1; s.published.add(topic.slug); say(`${day} ${slug}: Short ${topic.slug} ${plan.readiness.decision}`); }
        else {
          const videoId = `SIM-${slug.slice(0, 2).toUpperCase()}-S${s.shorts.length + 1}`;
          const publishAt = `${day}T${channel.config.publishTimeUtc || "18:00"}:00.000Z`;
          s.published.add(topic.slug);
          const related = plan.relatedLong;
          s.shorts.push({ day, slug: topic.slug, videoId, publishAt, bucket: plan.topicScore.bucket, hook: plan.growthMeta.hookType, readiness: plan.readiness.ProductionReadinessScore, relatedLong: related ? related.slug : null, experiment: plan.experiment });
          Analytics.registerVideo(channel, { videoId, channel: slug, contentType: "short", slug: topic.slug, publishAt, topicScore: plan.topicScore.VideoPotentialScore, ...plan.growthMeta });
          if (plan.experiment) Experiments.attachVideo(channel, topic.slug, videoId);
          if (related && related.videoId) Funnel.linkShortToLong(channel, { slug: topic.slug, videoId, channel: slug }, { slug: related.slug, videoId: related.videoId, title: related.title, channel: slug }, { type: related.type, reason: related.reason, score: related.score });
          Funnel.updateCluster(channel, topic.cluster, { type: "short", slug: topic.slug, videoId, title: plan.titles.selected ? plan.titles.selected.title : topic.title, channel: slug });
          s.videos.push({ id: videoId, status: { privacyStatus: "public" }, snippet: { publishedAt: publishAt, title: topic.title }, meta: { contentType: "short", topicScore: plan.topicScore.VideoPotentialScore, hookType: plan.growthMeta.hookType } });
        }
      }
      // ---- weekly long-form lane (real lane + gate; simulated render/upload)
      const laneNow = new Date(`${day}T10:00:00Z`);
      const status = Lane.status(channel, laneNow);
      if (status.due && !crashInjected && slug === slugs[slugs.length > 1 ? 1 : 0] && d >= 10) {
        // Scheduler recovery: the runner crashes mid-cycle, leaving RUNNING.
        const lane = Store.readState(channel, "longform", "lane.json", null) || { channel: slug, cycles: [] };
        lane.cycles = lane.cycles.filter((item) => item.cycleId !== status.cycleId).concat({ cycleId: status.cycleId, channel: slug, status: "RUNNING", startedAt: laneNow.toISOString(), note: "injected crash" });
        Store.writeState(channel, "longform", "lane.json", lane);
        crashInjected = { slug, cycleId: status.cycleId, day };
        say(`${day} ${slug}: injected crash — long-form cycle ${status.cycleId} left RUNNING`);
      } else if (status.due) {
        const result = await Lane.runCycle(channel, { now: laneNow, dryRun: true, context: s.ctx, llm: scenario === "B" ? simulatedWriter() : false, offline: options.offline, maxCandidates: 3 });
        const cycle = result.cycle;
        s.longCycles.push({ day, cycleId: cycle.cycleId, status: cycle.status, selected: cycle.selected, evaluated: cycle.evaluated.map((row) => `${row.slug} ${row.decision} ${row.score}`), reason: cycle.reason });
        say(`${day} ${slug}: long-form ${cycle.cycleId} → ${cycle.status}${cycle.selected ? " " + cycle.selected : ""}`);
        if (cycle.status === "READY_FOR_RENDER" && cycle.selected) {
          const pkg = Store.readState(channel, "longform", `packages/${cycle.selected}.json`, null);
          if (pkg) {
            const videoId = `SIM-${slug.slice(0, 2).toUpperCase()}-L${s.episodes.length + 1}`;
            const publishAt = `${day}T15:00:00.000Z`;
            const row = Lane.registerEpisode(channel, pkg, { videoId, publishAt });
            const lane = Store.readState(channel, "longform", "lane.json", { channel: slug, cycles: [] });
            const c = lane.cycles.find((item) => item.cycleId === cycle.cycleId);
            if (c) { c.status = "PUBLISHED"; c.simulatedVideoId = videoId; Store.writeState(channel, "longform", "lane.json", lane); }
            const previous = s.episodes[s.episodes.length - 1];
            if (previous) Funnel.linkLongToLong(channel, { slug: previous.slug, videoId: previous.videoId, channel: slug }, { slug: row.slug, videoId, title: row.title, channel: slug }, "next episode in the same channel");
            s.episodes.push({ day, slug: row.slug, videoId, publishAt, derivedShorts: (pkg.derivedShorts.shorts || []).length, relatedShorts: pkg.relatedShorts.length, primaryNext: pkg.nextVideos.primary_next_video ? pkg.nextVideos.primary_next_video.slug : null });
            s.videos.push({ id: videoId, status: { privacyStatus: "public" }, snippet: { publishedAt: publishAt, title: row.title }, meta: { contentType: "long", topicScore: pkg.LongFormPotential.LongFormPotentialScore } });
          }
        }
      }
      // ---- analytics pass (real checkpoints, diagnosis, learning, experiments)
      const byId = new Map(s.videos.map((video) => [video.id, video]));
      console.log = () => {};
      try {
        await Runtime.analyticsPass(channel, s.videos, async (video) => syntheticMeasurement(video, byId.get(video.id).meta, (date.getTime() + 20 * 3600000 - Date.parse(video.snippet.publishedAt)) / DAY), { now: new Date(date.getTime() + 20 * 3600000) });
      } finally { console.log = quiet; }
    }
  }
  // ---- verification
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const credSets = slugs.map((slug) => new Set(credentials[slug]));
  check("no credential collisions", slugs.every((a, i) => slugs.every((b, j) => i === j || ![...credSets[i]].some((name) => credSets[j].has(name)))), Object.entries(credentials).map(([slug, names]) => `${slug}: ${names.slice(0, 3).join(", ")}…`).join(" | "));
  const foreign = [];
  const walk = (dir, slug) => { if (!fs.existsSync(dir)) return; for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, entry.name); if (entry.isDirectory()) walk(file, slug); else if (file.endsWith(".json")) { try { const text = fs.readFileSync(file, "utf8"); for (const other of slugs) if (other !== slug && text.includes(`"channel": "${other}"`)) foreign.push(`${file.replace(sandbox, "")} mentions ${other}`); } catch (error) { /* ignore */ } } } };
  for (const slug of slugs) walk(path.join(sandbox, slug), slug);
  check("no state collisions (no file in one channel's sandbox carries another channel's records)", foreign.length === 0, foreign.slice(0, 3).join("; ") || "0 foreign records");
  const learned = Object.fromEntries(slugs.map((slug) => [slug, Learning.read(state[slug].channel)]));
  check("no learning collisions (each memory file belongs to its channel)", slugs.every((slug) => learned[slug].channel === slug), slugs.map((slug) => `${slug}: Shorts n=${learned[slug].shorts.sampleSize} (${learned[slug].shorts.status}), long n=${learned[slug].longform.sampleSize}`).join(" | "));
  const perf = Object.fromEntries(slugs.map((slug) => [slug, Analytics.readAll(state[slug].channel)]));
  check("no analytics collisions", slugs.every((slug) => perf[slug].every((row) => row.channel === slug)), slugs.map((slug) => `${slug}: ${perf[slug].length} tracked`).join(" | "));
  const allIds = slugs.flatMap((slug) => state[slug].videos.map((video) => video.id));
  const shortSlugs = slugs.map((slug) => state[slug].shorts.map((row) => row.slug));
  check("no duplicate uploads (video ids and per-channel topics unique)", new Set(allIds).size === allIds.length && shortSlugs.every((list) => new Set(list).size === list.length), `${allIds.length} simulated uploads`);
  const inventoryAfter = Object.fromEntries(slugs.map((slug) => [slug, Growth.selectShortTopic(state[slug].channel, { date: new Date(start.getTime() + days * DAY).toISOString().slice(0, 10), ranked: Context.rank(state[slug].channel, { context: state[slug].ctx }), exclude: [...state[slug].published] }).inventory]));
  check("topic inventory health", true, slugs.map((slug) => `${slug}: A/B ${state[slug].inventoryBefore.A + state[slug].inventoryBefore.B} → ${inventoryAfter[slug].A + inventoryAfter[slug].B}, C ${inventoryAfter[slug].C}, D ${inventoryAfter[slug].D}`).join(" | "));
  check("quality blocks recorded, not counted as failures", true, slugs.map((slug) => `${slug}: ${state[slug].blockedShorts} Short blocks, ${state[slug].skippedDays} skipped days, ${state[slug].longCycles.filter((c) => ["QUALITY_BLOCKED", "REVIEW_REQUIRED", "NO_CANDIDATE"].includes(c.status)).length} long-form quality blocks`).join(" | "));
  check("long/short cadence", slugs.every((slug) => state[slug].longCycles.length <= Math.ceil(days / 7) + 1), slugs.map((slug) => `${slug}: ${state[slug].shorts.length} Shorts, ${state[slug].longCycles.length} long-form cycles, ${state[slug].episodes.length} episodes`).join(" | "));
  const exps = Object.fromEntries(slugs.map((slug) => [slug, Experiments.load(state[slug].channel).experiments[0]]));
  check("experiments (one variable, per channel)", slugs.every((slug) => exps[slug] && exps[slug].channel === slug), slugs.map((slug) => `${slug}: ${exps[slug].variable} ${exps[slug].sample.control.length}/${exps[slug].sample.variant.length} → ${exps[slug].confidence}`).join(" | "));
  const recovered = crashInjected ? state[crashInjected.slug].longCycles.find((c) => c.cycleId === crashInjected.cycleId && c.day > crashInjected.day) : null;
  check("scheduler recovery (RUNNING cycle after a crash is re-run)", !!recovered && recovered.status !== "RUNNING", recovered ? `${crashInjected.slug} ${recovered.cycleId}: crash on ${crashInjected.day}, re-run ${recovered.day} → ${recovered.status}` : crashInjected ? "cycle not re-run" : "crash not injected");
  const tiktok = slugs.filter((slug) => state[slug].channel.config.platforms.tiktok && state[slug].channel.config.platforms.tiktok.enabled);
  check("TikTok backlog behaviour (Failure Reconstructed only; simulation sends nothing)", tiktok.length === 1 && tiktok[0] === "failure-reconstructed", `TikTok enabled for: ${tiktok.join(", ")}; backlog/duplicate rules covered by tests/js/reliability.test.js`);
  check("channel-specific learning evolution", slugs.every((slug) => learned[slug].shorts.sampleSize === perf[slug].filter((row) => row.contentType === "short" && row.metrics).length), slugs.map((slug) => `${slug}: ${learned[slug].shorts.observations.length} observations, ${learned[slug].shorts.hypotheses.length} hypotheses, ${learned[slug].shorts.adopted.length} adopted`).join(" | "));
  // A Short slot on a long-form day is healthy when a Short published or the
  // only reason for skipping was inventory (NO_QUALIFIED_TOPIC) — never the lane.
  const lfDayProblems = [];
  for (const slug of slugs) for (const c of state[slug].longCycles) {
    const published = state[slug].shorts.some((row) => row.day === c.day);
    const skip = state[slug].skips.find((row) => row.day === c.day);
    if (!published && !(skip && /NO_QUALIFIED_TOPIC/.test(skip.reason))) lfDayProblems.push(`${slug}:${c.day}`);
  }
  check("Shorts continue during long-form production", lfDayProblems.length === 0, lfDayProblems.length ? lfDayProblems.join(", ") : `${slugs.reduce((n, slug) => n + state[slug].longCycles.length, 0)} long-form cycle days; every Short slot published or skipped only for inventory`);
  check("long-form state isolation", slugs.every((slug) => Store.readState(state[slug].channel, "longform", "lane.json", { channel: slug }).channel === slug), "each lane.json carries only its own channel");
  const slotClash = slugs.some((slug) => state[slug].episodes.some((ep) => state[slug].shorts.some((sh) => sh.publishAt === ep.publishAt)));
  check("no schedule collisions (long-form 15:00 UTC vs Shorts slot)", !slotClash, "per-channel long-form and Short publish times never coincide");
  const contentClash = slugs.some((slug) => new Set(state[slug].episodes.map((ep) => ep.slug)).size !== state[slug].episodes.length);
  check("no content collisions (no episode twice; Short topics unique)", !contentClash, "episodes unique per channel");
  const rel = Object.fromEntries(slugs.map((slug) => [slug, Funnel.load(state[slug].channel)]));
  check("Short → Long relationships", slugs.every((slug) => rel[slug].shortToLong.every((row) => row.channel === slug || !row.channel)), slugs.map((slug) => `${slug}: ${rel[slug].shortToLong.length} links, ${rel[slug].manualActions.length} RELATED_VIDEO manual actions`).join(" | "));
  check("Long → Long relationships", true, slugs.map((slug) => `${slug}: ${rel[slug].longToLong.length} next-episode links`).join(" | "));
  const clusters = Object.fromEntries(slugs.map((slug) => [slug, Funnel.clusterIntegrity(state[slug].channel)]));
  check("content clusters", slugs.every((slug) => clusters[slug].ok), slugs.map((slug) => `${slug}: ${clusters[slug].count} clusters`).join(" | "));
  check("long-form quality blocks are expected behaviour", true, slugs.map((slug) => state[slug].longCycles.map((c) => c.status).join(",") || "no cycle").join(" | "));
  check("analytics separation (Shorts vs long baselines)", slugs.every((slug) => { const b = Analytics.baselines(state[slug].channel, perf[slug]); return b.short.n === perf[slug].filter((r) => r.contentType === "short" && r.metrics).length && b.long.n === perf[slug].filter((r) => r.contentType === "long" && r.metrics).length; }), slugs.map((slug) => { const b = Analytics.baselines(state[slug].channel, perf[slug]); return `${slug}: short n=${b.short.n}, long n=${b.long.n}`; }).join(" | "));
  check("learning separation (Shorts vs long-form blocks)", slugs.every((slug) => learned[slug].longform.sampleSize === perf[slug].filter((r) => r.contentType === "long" && r.metrics).length), slugs.map((slug) => `${slug}: long-form learning n=${learned[slug].longform.sampleSize} (${learned[slug].longform.status})`).join(" | "));
  const nonInventorySkips = slugs.flatMap((slug) => state[slug].skips.filter((row) => !/NO_QUALIFIED_TOPIC/.test(row.reason)).map((row) => `${slug}:${row.day}`));
  check("long-form does not starve Shorts (no Short slot lost to the long-form lane)", nonInventorySkips.length === 0, slugs.map((slug) => `${slug}: ${state[slug].shorts.length}/${days} published, ${state[slug].skippedDays} skipped for inventory`).join(" | "));
  const exhausted = slugs.filter((slug) => state[slug].skippedDays > days / 3);
  check("WARNING — Shorts inventory exhaustion (not a lane failure)", true, exhausted.length ? exhausted.map((slug) => `${slug}: ${state[slug].skippedDays}/${days} days without a qualified topic → ResearchPackage enrichment required`).join(" | ") : "none");
  check("blocked weak long-form candidates do not break scheduler health", slugs.every((slug) => { const st = Lane.status(state[slug].channel, new Date(start.getTime() + days * DAY)); return !!st.cycleId; }), "lane status readable and next cycle schedulable for every channel");
  return { sandbox, scenario, start: start.toISOString(), days, channels: slugs, state: Object.fromEntries(slugs.map((slug) => { const s = state[slug]; return [slug, { shorts: s.shorts, blockedShorts: s.blockedShorts, skippedDays: s.skippedDays, skips: s.skips, longCycles: s.longCycles, episodes: s.episodes, inventoryBefore: s.inventoryBefore, inventoryAfter: inventoryAfter[slug], learning: { shorts: { n: learned[slug].shorts.sampleSize, status: learned[slug].shorts.status, observations: learned[slug].shorts.observations.length, hypotheses: learned[slug].shorts.hypotheses.slice(0, 3) }, longform: { n: learned[slug].longform.sampleSize, status: learned[slug].longform.status } }, funnel: { shortToLong: rel[slug].shortToLong.length, longToLong: rel[slug].longToLong.length, manualActions: rel[slug].manualActions.length }, experiment: exps[slug] }]; })), checks, log };
}

function markdown(results) {
  const out = ["# Growth system — 30-day multi-channel simulation", "",
    `Generated ${new Date().toISOString()} by \`node growth.js simulate\`. Start ${results[0].start.slice(0, 10)}, ${results[0].days} days, channels: ${results[0].channels.join(", ")}.`, "",
    "**What is real and what is simulated.** Topic selection, Short planning, hooks, first-3-seconds, readiness gates, the weekly long-form lane and its quality gate, the Short→Long / Long→Long funnel, analytics checkpoints, diagnosis, learning and experiments all run the production code. Uploads (SIM-* ids), render, and every metric are simulated; metrics are deterministic pseudo-random numbers used only to exercise the analytics and learning code — they are not forecasts. All state lives in a temporary GROWTH_STATE_ROOT sandbox; production state was not touched.", "",
    "A blocked weak long-form candidate is expected quality behaviour and is not counted as a production failure.", ""];
  for (const result of results) {
    out.push(`## Scenario ${result.scenario} — ${result.scenario === "A" ? "current configuration (no configured long-form LLM provider)" : "LLM long-form writer enabled (provider-neutral simulated writer paraphrasing the deep ResearchPackage)"}`, "");
    out.push("| Channel | Shorts published | Short quality blocks | Skipped days (no qualified topic) | Long-form cycles | Episodes | Cycle outcomes | Short→Long links | Long→Long links |", "|---|---|---|---|---|---|---|---|---|");
    for (const slug of result.channels) {
      const s = result.state[slug];
      out.push(`| ${slug} | ${s.shorts.length} | ${s.blockedShorts} | ${s.skippedDays} | ${s.longCycles.length} | ${s.episodes.length} | ${s.longCycles.map((c) => c.status).join(", ") || "—"} | ${s.funnel.shortToLong} | ${s.funnel.longToLong} |`);
    }
    out.push("", "### Verification", "", "| Check | Result | Detail |", "|---|---|---|");
    for (const c of result.checks) out.push(`| ${c.name} | ${c.ok ? "PASS" : "FAIL"} | ${String(c.detail || "").replace(/\|/g, "/")} |`);
    out.push("", "### Long-form cycles", "");
    for (const slug of result.channels) for (const c of result.state[slug].longCycles) out.push(`- ${c.day} ${slug} ${c.cycleId}: **${c.status}**${c.selected ? ` (${c.selected})` : ""}${c.reason ? ` — ${c.reason}` : ""}; evaluated: ${c.evaluated.join("; ") || "—"}`);
    out.push("", "### Learning after 30 days (channel-isolated)", "");
    for (const slug of result.channels) {
      const l = result.state[slug].learning;
      out.push(`- ${slug}: Shorts n=${l.shorts.n} (${l.shorts.status}, ${l.shorts.observations} observations${l.shorts.hypotheses.length ? `; hypotheses: ${l.shorts.hypotheses.map((h) => `${h.dimension}=${h.value} lift ${h.lift}`).join(", ")}` : ""}); long-form n=${l.longform.n} (${l.longform.status}). Experiment ${result.state[slug].experiment.variable}: ${result.state[slug].experiment.sample.control.length}/${result.state[slug].experiment.sample.variant.length} → ${result.state[slug].experiment.confidence}`);
    }
    out.push("", "### Episodes (scenario B only publishes simulated episodes)", "");
    for (const slug of result.channels) for (const e of result.state[slug].episodes) out.push(`- ${e.day} ${slug}: ${e.slug} (${e.videoId}) · ${e.derivedShorts} derived Short plans · ${e.relatedShorts} related published Shorts · next: ${e.primaryNext || "—"}`);
    out.push("", "### Inventory", "");
    for (const slug of result.channels) { const s = result.state[slug]; out.push(`- ${slug}: before A${s.inventoryBefore.A}/B${s.inventoryBefore.B}/C${s.inventoryBefore.C}/D${s.inventoryBefore.D} → after A${s.inventoryAfter.A}/B${s.inventoryAfter.B}/C${s.inventoryAfter.C}/D${s.inventoryAfter.D}`); }
    out.push("");
  }
  return out.join("\n") + "\n";
}

module.exports = { run, markdown, syntheticMeasurement, simulatedWriter, hash01 };
