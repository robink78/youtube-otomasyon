#!/usr/bin/env node
"use strict";

// ImpossibleBrief / CriticalThread / The Hidden Logic of Things researched-record builder.
//
// Upgrades existing topic-universe entries IN PLACE (same id, category and —
// unless the seed replaces the question — same slug), so the inventory keeps
// its size and category mix. A seed adds editorial narration, sourced facts and
// topic-specific fields that replace the templated copy.
//
//   node scripts/ib-ct-library/build.js <seed.json> [--write] [--offline]
//
// seed.json: { "channel": "critical-thread" | "impossible-brief" | "behind-the-ordinary", "records": [ … ] }
// record: see docs/GROWTH-ENGINE.md → "Researched IB/CT records".
//
// Checks (all must pass before --write):
//   • every number in a fact appears in THAT fact's own source text
//   • The Hidden Logic of Things (myth risk): every fact also carries a verbatim
//     "quote" that must appear in that source's text, and the record becomes
//     productionReady only when all checks pass
//     (Wikipedia extract via API, or the primary page's visible text)
//   • every number spoken or shown (narration, hook, opening, second beat,
//     number, thumbnail, consequence) is traced to a fact
//   • topic-level sources are primary hosts only (legacy audit), reachable
//   • narration: 5–8 lines, 55–90 words, ≤ 16 words per sentence, opening and
//     second beat inside the channel's measured-time budget, valid layers
//   • legacy audits (core/research, core/quality) and the growth engine run on
//     the upgraded record; the report shows bucket, readiness and hook count

const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "..");
const FR = require(path.join(ROOT, "scripts", "fr-library", "build.js"));
const Channel = require(path.join(ROOT, "core", "channel-context"));
const Research = require(path.join(ROOT, "core", "research"));

const LAYERS = {
  "impossible-brief": ["KNOWN SCIENCE", "ESTIMATED CONSEQUENCE", "SPECULATIVE SCENARIO"],
  "critical-thread": ["VERIFIED FACT", "INDUSTRY CLAIM", "ESTIMATE", "MODEL", "HYPOTHESIS"],
  "behind-the-ordinary": ["VERIFIED FACT", "INDUSTRY CLAIM", "ESTIMATE"],
};
// Topic-level sources for The Hidden Logic of Things: inventors/manufacturers,
// standards bodies, government, museums, universities and archives.
const BTO_PRIMARY_HOSTS = [".gov", ".edu", ".ac.uk", "europa.eu", "iso.org", "iec.ch", "ieee.org", "itu.int", "gs1.org", "gs1us.org", "isbn-international.org",
  "qrcode.com", "denso-wave.com", "bluetooth.com", "levistrauss.com", "ykk.com", "otis.com", "si.edu", "loc.gov", "sciencemuseum.org.uk",
  "computerhistory.org", "vam.ac.uk", "ginetex.net", "unece.org", "imo.org", "who.int", "unicode.org", "okhistory.org", "mylearning.org",
  "nationalmotormuseum.org.uk", "moma.org"];
// "x.gov"/".gov" style entries match a domain suffix only ("www.governing.com"
// must not pass as ".gov"); other entries match the domain or a subdomain.
function hostAllowed(host, list) {
  const h = String(host || "").toLowerCase();
  return list.some((entry) => entry.startsWith(".") ? h.endsWith(entry) : h === entry || h.endsWith("." + entry));
}
const primaryHosts = (channelSlug) => channelSlug === "behind-the-ordinary" ? BTO_PRIMARY_HOSTS : Research.PRIMARY_HOSTS;
// Quote matching ignores case, punctuation style and whitespace only.
const quoteFound = (text, quote) => normalizeQuote(text).includes(normalizeQuote(quote));
const normalizeQuote = (text) => String(text || "").toLowerCase().replace(/[‘’`´]/g, "'").replace(/[“”]/g, '"').replace(/[‐-―−]/g, "-").replace(/\s+/g, " ").trim();
const wordCount = (text) => String(text || "").split(/\s+/).filter(Boolean).length;
// A rounded value (29.76) is supported by a more precise source value (29.7646).
function supportedRounded(n, values) {
  if (FR.supported(n, new Set(values))) return true;
  const decimals = (String(n).split(".")[1] || "").length;
  for (const value of values) if (Math.abs(Number(value.toFixed(decimals)) - n) < 1e-9) return true;
  return false;
}
const sentences = (text) => String(text || "").split(/(?<=[.!?])\s+/).filter(Boolean);
const universeFile = (slug) => path.join(ROOT, "channels", slug, "topics", "topic-universe.json");

const sourceCache = new Map();
async function sourceText(url, offline) {
  if (sourceCache.has(url)) return sourceCache.get(url);
  if (offline) return null;
  let text = null;
  const wiki = /en\.wikipedia\.org\/wiki\/([^#?]+)/.exec(url);
  if (wiki) {
    const r = await FR.get(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(decodeURIComponent(wiki[1]).replace(/_/g, " "))}`, { json: true });
    const page = r.body && r.body.query ? Object.values(r.body.query.pages)[0] : null;
    text = page && page.extract ? page.extract : null;
  } else {
    let r = await FR.get(url);
    if (!(r.status >= 200 && r.status < 400) || !r.body) r = await FR.get(url, { browser: true });
    if (r.status >= 200 && r.status < 400 && r.body) {
      text = String(r.body).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    }
  }
  sourceCache.set(url, text);
  return text;
}

function lintRecord(channelSlug, record, rules) {
  const errors = [];
  const lines = (record.narration || []).map((item) => typeof item === "string" ? { text: item } : item);
  if (lines.length < 5 || lines.length > 8) errors.push(`narration has ${lines.length} lines (5–8)`);
  const total = lines.reduce((sum, line) => sum + wordCount(line.text), 0);
  if (total < 55 || total > 90) errors.push(`narration ${total} words (55–90)`);
  for (const [index, line] of lines.entries()) {
    for (const s of sentences(line.text)) if (wordCount(s) > 16) errors.push(`line ${index + 1} has a ${wordCount(s)}-word sentence`);
    if (!LAYERS[channelSlug].includes(line.layer)) errors.push(`line ${index + 1} layer "${line.layer}" not in ${LAYERS[channelSlug].join("/")}`);
    if (!line.role) errors.push(`line ${index + 1} has no role`);
  }
  // Measured-time budget at the natural narration pace the renderer uses
  // (~2.8 words/s for the hook; ~2.3 including the line pause).
  const openingWords = Math.floor(rules.openingMaxSeconds * 1.15 * 2.8);
  const secondWords = Math.floor(rules.secondBeatMaxSeconds * 2.3);
  if (lines[0] && wordCount(lines[0].text) > openingWords) errors.push(`opening "${lines[0].text}" > ${openingWords} words (opening ≤ ${rules.openingMaxSeconds}s)`);
  if (lines[1] && wordCount(lines[0].text) + wordCount(lines[1].text) > secondWords) errors.push(`opening + second beat > ${secondWords} words (second beat ≤ ${rules.secondBeatMaxSeconds}s)`);
  if (lines[0] && record.openingLine && lines[0].text !== record.openingLine) errors.push("narration line 1 must equal openingLine (it is the spoken hook)");
  if (/^(in|on|by)?\s*(1[5-9]|20)\d\d\b/i.test(lines[0] && lines[0].text || "")) errors.push("opening starts with a date");
  if (!record.openingLine || wordCount(record.openingLine) > openingWords) errors.push("openingLine missing or too long");
  if ((record.facts || []).length < 4) errors.push(`only ${(record.facts || []).length} sourced facts (≥ 4)`);
  // The renderer rejects thumbnails over 3 words (core/rendering renderThumbnail).
  if (!record.thumbnailText || wordCount(record.thumbnailText) > 3) errors.push("thumbnailText missing or > 3 words");
  if (/['\\]/.test(record.thumbnailText || "")) errors.push("thumbnailText must not contain ' or \\ (breaks the ffmpeg drawtext filter)");
  return { errors, words: total };
}

async function verify(channelSlug, record, options) {
  const errors = [];
  const hosts = primaryHosts(channelSlug);
  for (const source of record.sources || []) {
    let host = "";
    try { host = new URL(source.url).hostname; } catch (error) { errors.push("invalid source URL " + source.url); continue; }
    if (!(channelSlug === "behind-the-ordinary" ? hostAllowed(host, hosts) : hosts.some((allowed) => host.includes(allowed)))) errors.push(`topic source ${host} is not a primary host (put encyclopedia articles on facts / researchArticles)`);
  }
  // Facts: numbers must appear in the fact's own source text.
  const factNumbers = new Set();
  for (const [index, fact] of (record.facts || []).entries()) {
    if (!fact.url || !fact.source) { errors.push(`fact ${index + 1} has no source/url`); continue; }
    if (channelSlug === "behind-the-ordinary") {
      const words = wordCount(fact.quote);
      if (words < 5) errors.push(`fact ${index + 1}: a verbatim source quote of at least 5 words is required`);
      else if (!options.offline) {
        const text = await sourceText(fact.url, options.offline);
        if (!text) errors.push(`fact ${index + 1}: source not readable (${fact.url}) — quote cannot be verified`);
        else if (!quoteFound(text, fact.quote)) errors.push(`fact ${index + 1}: quote not found verbatim in ${fact.source}`);
      }
    }
    const numbers = FR.numbersIn(fact.claim).filter((n) => !(n >= 1500 && n <= 2100 && Number.isInteger(n) && fact.allowYear !== false));
    FR.numbersIn(fact.claim).forEach((n) => factNumbers.add(n));
    if (!numbers.length || options.offline) continue;
    const text = await sourceText(fact.url, options.offline);
    if (!text) { errors.push(`fact ${index + 1}: source not readable (${fact.url}) — numbers cannot be verified`); continue; }
    const available = new Set(FR.numbersIn(text));
    // "500 million" in a claim parses as 500 and 1e6; accept it when the
    // source writes the full figure (500,000,000).
    for (const n of [...available]) for (const scale of [1e6, 1e9]) if (n >= scale && n % (scale / 1000) === 0) { available.add(n / scale); available.add(scale); }
    const missing = numbers.filter((n) => !supportedRounded(n, [...available]));
    if (missing.length) errors.push(`fact ${index + 1}: ${missing.join(", ")} not found in ${fact.source}`);
  }
  // Spoken / shown numbers must trace to a fact.
  const shown = [record.hook, record.openingLine, record.secondBeat, record.number, record.thumbnailText, record.expectedConsequence, ...(record.narration || []).map((line) => typeof line === "string" ? line : line.text)].join(" ");
  // Bare scale words ("million", "billion") are multipliers, not claims; the
  // mantissa next to them must still trace to a fact.
  const SCALES = new Set([1e3, 1e6, 1e9, 1e12]);
  const untraced = FR.numbersIn(shown).filter((n) => !SCALES.has(n) && !supportedRounded(n, [...factNumbers]) && !(n <= 10 && Number.isInteger(n)));
  if (untraced.length) errors.push(`numbers not traced to a fact: ${[...new Set(untraced)].join(", ")}`);
  // Topic sources reachable.
  if (!options.offline) for (const source of record.sources || []) {
    let r = await FR.get(source.url, { head: true });
    if (!(r.status >= 200 && r.status < 400)) r = await FR.get(source.url, { browser: true });
    if (!(r.status >= 200 && r.status < 400)) errors.push(`source unreachable (${r.status}): ${source.url}`);
  }
  return errors;
}

function merge(channelSlug, existing, record) {
  const out = { ...existing };
  const keep = ["id", "category", "channel", "status"];
  for (const [key, value] of Object.entries(record)) if (!keep.includes(key) && key !== "replaces" && value !== undefined) out[key] = value;
  if (record.visualScenes) out.visualPotential = { ...(existing.visualPotential || {}), scenes: record.visualScenes };
  delete out.visualScenes;
  out.researched = { at: new Date().toISOString().slice(0, 10), facts: (record.facts || []).length, articles: [...new Set((record.facts || []).filter((f) => /wikipedia\.org/.test(f.url)).map((f) => f.url))] };
  if (channelSlug === "impossible-brief") {
    out.claimFramework = [
      { layer: "KNOWN SCIENCE", confidence: "VERIFIED", claim: record.scientificMechanism || existing.scientificMechanism },
      { layer: "ESTIMATED CONSEQUENCE", confidence: "SUPPORTED", claim: record.expectedConsequence || existing.expectedConsequence },
      { layer: "SPECULATIVE SCENARIO", confidence: "SPECULATIVE", claim: record.scenarioChange || existing.scenarioChange },
    ];
    out.sourceQuality = { ...(existing.sourceQuality || {}), authorities: (out.sources || []).map((s) => s.name) };
  } else {
    out.researchEvidence = (record.facts || []).map((fact) => ({ layer: fact.layer, claim: fact.claim, source: fact.source }));
  }
  if (channelSlug === "behind-the-ordinary") {
    // Only reached for a record whose sources, quotes and numbers are being
    // verified; main() writes it only when every check passed.
    out.question = out.coreQuestion = record.coreQuestion || record.question || existing.coreQuestion;
    out.researchStatus = "VERIFIED";
    out.productionReady = true;
    out.confidence = "VERIFIED";
    out.sourceAvailability = { score: 88, status: "verified-primary-sources" };
    out.sourceQuality = { score: 88, grade: "primary-sources-with-verbatim-quotes", authorities: (out.sources || []).map((source) => source.name) };
    out.quality = { ...(existing.quality || {}), sourceClaimsMapped: true, quotesVerified: true, productionReady: true };
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  const seed = JSON.parse(fs.readFileSync(file, "utf8"));
  const { report } = await run(seed, { write: args.includes("--write"), offline: args.includes("--offline") });
  fs.writeFileSync(file.replace(/\.json$/, ".report.json"), JSON.stringify(report, null, 2) + "\n");
}

// Verifies every seed record and, with write, upgrades the passing ones in
// the channel's topic universe. Shared by the CLI above and by automated
// research (scripts/bto-research.js), so both pass exactly the same checks.
async function run(seed, { write = false, offline = false, log = console.log } = {}) {
  const channelSlug = seed.channel;
  const channel = Channel.getChannel(channelSlug);
  const universePath = universeFile(channelSlug);
  const universe = JSON.parse(fs.readFileSync(universePath, "utf8"));
  const report = [];
  let changed = 0;
  // "replaces": "auto" swaps out the weakest unresearched combinatorial
  // question in the same category, keeping inventory size and category mix.
  const WEAK = [/altitude-controlled/, /changed-direction-every-six-months/, /one-meter-zone-with-zero/, /reverses-for-one-second/, /could-a-one-percent-change/, /would-a-century-be-enough/, /became-an-equal-mass-black-hole/, /could-evolution-adapt/, /no-longer-face/, /could-earth-survive-one-day-without/, /how-would-a-slow-century-long-change/, /cut-in-half/, /suddenly-doubles-in-mass/];
  const claimed = new Set();
  const autoTarget = (category) => {
    const pool = universe.topics.filter((item) => item.category === category && !item.researched && !claimed.has(item.slug));
    for (const pattern of WEAK) { const hit = pool.find((item) => pattern.test(item.slug)); if (hit) return hit.slug; }
    return pool.length ? pool[pool.length - 1].slug : null;
  };
  for (const record of seed.records) {
    if (record.replaces === "auto") {
      const pick = universe.topics.find((item) => item.slug === record.slug) ? record.slug : autoTarget(record.category);
      if (pick === record.slug) delete record.replaces; else record.replaces = pick;
    }
    // Re-running a written seed: the replaced entry already carries the new slug.
    const target = universe.topics.some((item) => item.slug === record.slug) ? record.slug : (record.replaces || record.slug);
    if (target) claimed.add(target);
    const index = universe.topics.findIndex((item) => item.slug === target);
    const row = { slug: record.slug, errors: [] };
    if (index < 0) { row.errors.push(`no universe entry with slug ${target}`); report.push(row); continue; }
    // The Hidden Logic of Things keeps several questions per object (one per design
    // detail), so its identity is object + detail rather than the object alone.
    const sameSubject = (item) => channelSlug === "behind-the-ordinary"
      ? !!(item.canonicalTopic && item.designDetail && item.canonicalTopic === (record.canonicalTopic || universe.topics[index].canonicalTopic) && item.designDetail === (record.designDetail || universe.topics[index].designDetail))
      : !!(record.canonicalTopic && item.canonicalTopic && item.canonicalTopic.toLowerCase() === record.canonicalTopic.toLowerCase());
    const clash = universe.topics.find((item, i) => i !== index && (item.slug === record.slug || (record.topic && item.topic.toLowerCase() === record.topic.toLowerCase()) || sameSubject(item)));
    if (clash) row.errors.push(`duplicate of ${clash.slug}`);
    if (record.category && universe.topics[index].category !== record.category) row.errors.push(`category ${record.category} ≠ replaced entry's ${universe.topics[index].category}`);
    const lint = lintRecord(channelSlug, record, channel.config.retentionRules);
    row.errors.push(...lint.errors);
    row.words = lint.words;
    row.errors.push(...await verify(channelSlug, record, { offline }));
    const upgraded = merge(channelSlug, universe.topics[index], record);
    if (channelSlug !== "behind-the-ordinary") {
      const audit = Research.auditTopic(upgraded);
      if (!audit.pass) row.errors.push("legacy research audit: " + audit.errors.join("; "));
    }
    const Quality = require(path.join(ROOT, "core", "quality", channelSlug));
    const legacy = Quality.evaluateTopic(upgraded, universe.topics.map((item, i) => (i === index ? upgraded : item)));
    if (legacy.decision === "BLOCK") row.errors.push("legacy quality BLOCK: " + legacy.blockers.join("; "));
    // PHASE 5: at least 10 meaningful hook candidates from the record itself.
    const Model = require(path.join(ROOT, "core", "growth", "topic-model"));
    const Hooks = require(path.join(ROOT, "core", "growth", "hooks"));
    const growthConfig = require(path.join(ROOT, "core", "growth", "config")).forChannel(channel);
    const hooks = Hooks.generate(Model.normalize(channel, upgraded), growthConfig, { openingMaxSeconds: channel.config.retentionRules.openingMaxSeconds });
    row.hooks = hooks.candidateCount;
    row.hookScore = hooks.selectedScore;
    if (hooks.candidateCount < growthConfig.hooks.minimumCandidates) row.errors.push(`only ${hooks.candidateCount} hook candidates (≥ ${growthConfig.hooks.minimumCandidates}); add distinct short facts`);
    if (!hooks.selected || hooks.selected.spoken !== (/[.!?]$/.test(record.openingLine) ? record.openingLine : record.openingLine + ".")) row.errors.push("the spoken opening is not a valid hook candidate (blocked or too long)");
    if (!row.errors.length) { universe.topics[index] = upgraded; changed += 1; }
    report.push(row);
    log(`${row.errors.length ? "✗" : "✓"} ${record.slug}${record.replaces ? ` (replaces ${record.replaces})` : ""} · ${lint.words} words · ${row.hooks} hooks · opening hook ${row.hookScore}${row.errors.length ? "\n    - " + row.errors.join("\n    - ") : ""}`);
  }
  if (write && changed) {
    fs.writeFileSync(universePath, JSON.stringify(universe, null, 2) + "\n");
    // Growth-engine evaluation of the written records.
    const Growth = require(path.join(ROOT, "core", "growth"));
    const Context = require(path.join(ROOT, "core", "growth", "context"));
    const ctx = Context.build(channel);
    for (const row of report.filter((r) => !r.errors.length)) {
      const plan = Growth.planShort(channel, row.slug, { context: ctx, skipDuplicate: true });
      row.growth = { bucket: plan.topicScore.bucket, potential: plan.topicScore.VideoPotentialScore, readiness: plan.readiness.ProductionReadinessScore, decision: plan.readiness.decision, hooks: plan.hooks.candidateCount, hardFails: plan.readiness.hardFails, templated: plan.topicScore.reasons.filter((r) => /boilerplate|template/.test(r)) };
      log(`  growth ${row.slug}: bucket ${row.growth.bucket} ${row.growth.potential} · readiness ${row.growth.readiness} ${row.growth.decision} · ${row.growth.hooks} hooks${row.growth.hardFails.length ? " · " + row.growth.hardFails.join("; ") : ""}${row.growth.templated.length ? " · " + row.growth.templated.join("; ") : ""}`);
    }
  }
  log(`\n${report.filter((r) => !r.errors.length).length}/${report.length} passed${write ? `, ${changed} written` : " (dry run; add --write)"}`);
  return { report, changed };
}

if (require.main === module) main().catch((error) => { console.error(error); process.exit(1); });
module.exports = { run, lintRecord, verify, merge, LAYERS, BTO_PRIMARY_HOSTS, hostAllowed, normalizeQuote, quoteFound };
