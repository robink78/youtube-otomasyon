#!/usr/bin/env node
"use strict";

// Build Failure Reconstructed's durable discovery inventory without changing
// its production-ready case files. Existing case files are already sourced;
// backlog candidates become QUALIFIED only after Wikipedia's public API
// confirms a real page. Qualification is not production readiness: backlog
// records still require claim-level research, licensed visuals and a script.

const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const TOPICS = path.join(ROOT, "icerik", "konular");
const SEEDS = path.join(ROOT, "icerik", "kutuphane-tohum");
const OUTPUT = path.join(ROOT, "channels", "failure-reconstructed", "topics", "topic-universe.json");
const TARGET = Number(process.argv.find((arg) => /^--target=/.test(arg))?.split("=")[1]) || 500;
const WRITE = process.argv.includes("--write");

const read = (file, fallback = null) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; } };
const slug = (value) => String(value || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const semantic = (value) => slug(String(value || "").replace(/\b(18|19|20)\d{2}\b/g, "").replace(/\b(disaster|accident|incident|collapse|fire)\b/gi, ""));

function inferCluster(text) {
  const s = String(text).toLowerCase().replace(/_/g, " ");
  const rules = [
    ["spaceflight", /apollo|soyuz|space|shuttle|rocket|satellite|gemini|sts-|mars|launch/],
    ["aviation", /flight|airlines?|airways?|airport|aircraft|boeing|airbus|dc-\d|mid-air|runway|helicopter|aviation/],
    ["nuclear-incidents", /nuclear|reactor|chernobyl|fukushima|three mile|criticality|radiation/],
    ["maritime-disasters", /ship|ferry|tanker|submarine|boat|maritime|sea |ocean|rig\)|offshore|mv |ss /],
    ["bridge-failures", /bridge|viaduct/],
    ["structural-engineering", /building|tower|stadium|arena|roof|balcony|walkway|hotel|mall|school|theatre|structural/],
    ["infrastructure-failures", /blackout|dam|levee|flood|pipeline|water|sewer|grid|telephone|tunnel|rail|train|metro/],
    ["industrial-accidents", /factory|plant|chemical|gas|refinery|mine|explosion|industrial|oil spill/],
    ["material-failures", /fatigue|corrosion|material|fracture|brittle|alloy/],
    ["maintenance-failures", /maintenance|inspection|repair/],
    ["electrical-failures", /electrical|power station|transformer|voltage/],
    ["procedural-failures", /crowd|stampede|human error|procedure/],
  ];
  return (rules.find(([, pattern]) => pattern.test(s)) || ["mechanical-failures"])[0];
}

function eventType(cluster) {
  return ({
    aviation: "aviation accident", spaceflight: "spaceflight failure", "bridge-failures": "bridge failure",
    "structural-engineering": "structural failure", "maritime-disasters": "maritime disaster",
    "industrial-accidents": "industrial accident", "nuclear-incidents": "nuclear incident",
    "infrastructure-failures": "infrastructure failure", "material-failures": "material failure",
    "maintenance-failures": "maintenance failure", "procedural-failures": "procedural failure",
    "electrical-failures": "electrical failure", "mechanical-failures": "mechanical failure",
  })[cluster];
}

function existingTopics() {
  const published = read(path.join(ROOT, "icerik", "yayinlananlar.json"), []);
  const generated = read(path.join(ROOT, "icerik", "uretilenler.json"), []);
  const used = new Set([...(Array.isArray(published) ? published : []).flatMap((row) => [row.slug, row.topicId]), ...(Array.isArray(generated) ? generated : []).map((row) => typeof row === "string" ? row : row.slug || row.topicId)].filter(Boolean));
  return fs.readdirSync(TOPICS).filter((file) => file.endsWith(".json")).sort().map((file) => {
    const raw = read(path.join(TOPICS, file), {});
    const item = raw.vaka || {};
    const topicId = file.replace(/\.json$/, "");
    const sources = (item.kaynakca || []).filter((source) => /^https?:\/\//.test(source.url || "")).map((source) => ({ name: source.ad || source.url, url: source.url, verification: "CASE_FILE_SOURCE" }));
    const official = sources.filter((source) => !/wikipedia\.org/i.test(source.url)).length;
    const cluster = item.kume || inferCluster(`${item.ad} ${raw.baslik}`);
    return {
      topic_id: topicId,
      canonical_name: item.ad || raw.baslik || topicId,
      cluster,
      event_year: Number.isFinite(item.yil) && item.yil > 0 ? item.yil : null,
      country: item.ulke || null,
      event_type: item.tip && item.tip !== "vaka" ? item.tip : eventType(cluster),
      viral_score: null,
      visual_score: Math.min(100, (raw.kaynaklar || []).length * 12),
      source_confidence: official ? 95 : 80,
      recognizability: Number.isFinite(raw.oncelik) ? Math.min(100, raw.oncelik * 10) : null,
      used: used.has(topicId),
      last_scored_at: null,
      qualification_status: "QUALIFIED_SOURCE_VERIFIED",
      production_ready: true,
      sources,
      verification: { method: "existing sourced production case file", checked_at: null, official_source_count: official },
      duplicate_risk: "NONE",
      source_file: `icerik/konular/${file}`,
    };
  });
}

function candidateRows(existing) {
  const known = new Set(existing.flatMap((row) => [semantic(row.canonical_name), slug(row.verification && row.verification.wikipedia_title)]).filter(Boolean));
  const probe = new Map();
  for (const file of fs.readdirSync(SEEDS).filter((name) => /^candidates-\d+\.probe\.json$/.test(name))) {
    for (const row of read(path.join(SEEDS, file), [])) probe.set(String(row.wiki).toLowerCase(), row);
  }
  const out = [];
  const seen = new Set();
  for (const file of fs.readdirSync(SEEDS).filter((name) => /^candidates-\d+\.json$/.test(name)).sort()) {
    for (const row of read(path.join(SEEDS, file), [])) {
      const key = slug(row.wiki);
      const nameKey = semantic(row.kisa || row.wiki);
      if (!key || seen.has(key) || known.has(key) || known.has(nameKey)) continue;
      seen.add(key);
      out.push({ ...row, seed_file: file, probe: probe.get(String(row.wiki).toLowerCase()) || null });
    }
  }
  return out;
}

async function queryWikipedia(rows) {
  const verified = [];
  for (let start = 0; start < rows.length; start += 50) {
    const batch = rows.slice(start, start + 50);
    const titles = batch.map((row) => row.wiki.replace(/_/g, " ")).join("|");
    const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&redirects=1&prop=info&inprop=url&titles=" + encodeURIComponent(titles);
    let payload = null;
    for (let attempt = 0; attempt < 3 && !payload; attempt += 1) {
      try {
        const response = await fetch(url, { headers: { "User-Agent": "FailureReconstructedInventory/1.0 (+https://github.com/eyazan/youtube-otomasyon)" } });
        if (response.ok) payload = await response.json();
      } catch (error) {}
    }
    if (!payload) throw new Error(`Wikipedia verification failed for batch ${start / 50 + 1}`);
    const aliases = new Map();
    for (const row of [...(payload.query.normalized || []), ...(payload.query.redirects || [])]) aliases.set(row.from.toLowerCase(), row.to);
    const pages = new Map((payload.query.pages || []).filter((page) => !page.missing).map((page) => [page.title.toLowerCase(), page]));
    for (const row of batch) {
      let title = row.wiki.replace(/_/g, " ");
      for (let i = 0; i < 3 && aliases.has(title.toLowerCase()); i += 1) title = aliases.get(title.toLowerCase());
      const page = pages.get(title.toLowerCase());
      if (page) verified.push({ row, page });
    }
  }
  return verified;
}

function backlogTopic(item, checkedAt) {
  const { row, page } = item;
  const canonical = page.title;
  const cluster = inferCluster(`${canonical} ${row.kisa || ""}`);
  const probed = row.probe && row.probe.ok;
  return {
    topic_id: `backlog-${slug(canonical)}`,
    canonical_name: canonical,
    cluster,
    event_year: Number.isFinite(row.yil) && row.yil > 0 ? row.yil : null,
    country: null,
    event_type: eventType(cluster),
    viral_score: null,
    visual_score: probed ? Math.min(100, row.probe.stills * 12) : null,
    source_confidence: probed ? 85 : 70,
    recognizability: null,
    used: false,
    last_scored_at: null,
    qualification_status: "QUALIFIED_SOURCE_VERIFIED",
    production_ready: false,
    sources: [{ name: `Wikipedia — ${canonical}`, url: page.fullurl || `https://en.wikipedia.org/wiki/${encodeURIComponent(canonical.replace(/ /g, "_"))}`, verification: "WIKIPEDIA_API_PAGE_EXISTS" }],
    verification: { method: "Wikipedia public API page existence", checked_at: checkedAt, page_id: page.pageid, wikipedia_title: canonical, production_requirements: ["claim-level source research", "licensed visual audit", "retention script and factual gate"] },
    duplicate_risk: "LOW_API_CANONICALIZED",
    source_file: `icerik/kutuphane-tohum/${row.seed_file}`,
  };
}

async function main() {
  const checkedAt = new Date().toISOString();
  const existing = existingTopics();
  if (existing.length >= TARGET) throw new Error("target should exceed the existing production inventory");
  const candidates = candidateRows(existing);
  const verified = await queryWikipedia(candidates);
  const combined = [...existing];
  const pageIds = new Set();
  const names = new Set(existing.map((row) => semantic(row.canonical_name)));
  for (const item of verified) {
    const name = semantic(item.page.title);
    if (pageIds.has(item.page.pageid) || names.has(name)) continue;
    pageIds.add(item.page.pageid);
    names.add(name);
    combined.push(backlogTopic(item, checkedAt));
    if (combined.length >= TARGET) break;
  }
  if (combined.length < TARGET) throw new Error(`only ${combined.length}/${TARGET} unique source-verified topics were available`);
  const inventory = {
    schema: "failure-reconstructed-topic-universe/1",
    generated_at: checkedAt,
    channel: "failure-reconstructed",
    qualification_policy: "Every record has at least one explicit source URL. Backlog records are admitted only after Wikipedia API page verification and are not production-ready until deeper sourcing, licensed visuals, scripting and quality gates pass.",
    stats: { total: combined.length, qualified: combined.filter((row) => row.qualification_status === "QUALIFIED_SOURCE_VERIFIED").length, production_ready: combined.filter((row) => row.production_ready).length, research_backlog: combined.filter((row) => !row.production_ready).length, used: combined.filter((row) => row.used).length },
    topics: combined,
  };
  const ids = new Set(combined.map((row) => row.topic_id));
  if (ids.size !== combined.length || combined.some((row) => !row.sources.length || !row.sources.every((source) => /^https?:\/\//.test(source.url)))) throw new Error("inventory invariant failed: duplicate IDs or missing HTTP(S) sources");
  if (WRITE) {
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, JSON.stringify(inventory, null, 2) + "\n");
  }
  console.log(JSON.stringify({ output: OUTPUT, write: WRITE, ...inventory.stats, verifiedBacklogAvailable: verified.length }, null, 2));
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exit(1); });
module.exports = { inferCluster, eventType, existingTopics, candidateRows, queryWikipedia, backlogTopic, semantic, slug };
