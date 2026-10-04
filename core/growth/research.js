"use strict";

// LONG-FORM RESEARCH DEEPENING (PHASE 32 / 32S). A Shorts topic record holds
// ~20 claims — enough for 40 seconds, not for 8–12 minutes. This module adds
// sentence-level claims from the topic's encyclopedia article so the long-form
// writer has real evidence instead of padding.
//
//   • source: the Wikipedia article already cited by the topic (or, for
//     question/system topics, the article whose title matches the subject)
//   • every claim keeps its article URL and section; nothing is invented
//   • LICENCE: Wikipedia text is CC BY-SA. Claims are marked verbatim:false —
//     the deterministic script never narrates them word for word; only the LLM
//     writer may use them, rewritten, and longform.claimSourceMap() blocks a
//     paragraph that copies a source sentence (COPY_RISK)
//   • cached per channel under state/longform/research/<slug>.deep.json

const https = require("https");
const Store = require("./store");

const UA = "FailureReconstructedBot/1.0 (+https://github.com/eyazan/youtube-otomasyon)";
const SKIP_SECTIONS = /^(see also|references|notes|external links|further reading|bibliography|citations|sources|gallery|in popular culture|popular culture|media|footnotes|explanatory notes)$/i;
const ROLE_BY_HEADING = [
  [/cause|investigat|analysis|finding|probable|report|inquiry|commission|technical|mechanism|physics|science|how it works|design flaw|failure/i, "cause"],
  [/aftermath|legacy|consequence|response|recommendation|change|reform|impact|effect|litigation|trial|memorial|safety|regulation/i, "aftermath"],
  [/background|design|construction|history|development|description|overview|specification|operation|technology|process|structure|geology/i, "background"],
  [/accident|disaster|collapse|sinking|crash|flight|launch|event|timeline|incident|explosion|fire|flood|eruption|failure sequence|rescue|evacuation/i, "event"],
];

function get(url) {
  return new Promise((resolve) => {
    const request = https.get(url, { headers: { "User-Agent": UA, Accept: "application/json" }, timeout: 25000 }, (res) => {
      const parts = [];
      res.on("data", (d) => parts.push(d));
      res.on("end", () => { try { resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(parts).toString("utf8")) }); } catch (error) { resolve({ status: res.statusCode, body: null }); } });
    });
    request.on("timeout", () => { request.destroy(); resolve({ status: 0, body: null }); });
    request.on("error", () => resolve({ status: 0, body: null }));
  });
}

async function getWithRetry(url, tries = 5) {
  for (let attempt = 0; attempt < tries; attempt++) {
    const res = await get(url);
    if (![0, 429, 503].includes(res.status)) return res;
    await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
  }
  return { status: 0, body: null };
}

function wikiTitleFromUrl(url) {
  const match = /https?:\/\/en\.wikipedia\.org\/wiki\/([^#?]+)/.exec(url || "");
  return match ? decodeURIComponent(match[1]).replace(/_/g, " ") : null;
}

// Which article? The topic's own cited Wikipedia article first; otherwise an
// exact (redirect-resolved) title match on the subject — never a loose search.
function articleFor(topic) {
  for (const source of topic.sources || []) {
    const title = wikiTitleFromUrl(source.url);
    if (title) return { title, via: "cited source" };
  }
  const subject = String(topic.subject || "").replace(/^(the|a|an)\s+/i, "").trim();
  if (!subject) return null;
  // Exact title, then the same title without a trailing generic noun
  // ("EUV lithography system" → "EUV lithography"). Redirects resolve
  // abbreviations; there is no fuzzy search.
  const variants = [subject];
  const trimmed = subject.replace(/\s+(system|systems|network|networks|infrastructure|process|machine|machines|plant|facility)$/i, "");
  variants.push(trimmed);
  // "all ocean plankton" → "ocean plankton"; "atmosphere's total pressure" → "atmosphere pressure" is not a title, so the possessive keeps only the owner.
  const unquantified = trimmed.replace(/^(all|every|each|global|entire|total)\s+/i, "");
  variants.push(unquantified);
  const possessive = /^(.+?)'s\s+/.exec(unquantified);
  if (possessive) variants.push(possessive[1]);
  const parts = unquantified.split(/\s+/);
  if (parts.length > 2 && !possessive) variants.push(parts.slice(-2).join(" "));
  if (parts.length > 1 && !possessive) variants.push(parts[parts.length - 1]);
  for (const value of [...variants]) if (/[^s]s$/i.test(value)) variants.push(value.replace(/s$/i, ""));
  const titles = [...new Set(variants.map((value) => value.trim()).filter(Boolean))];
  return { title: titles[0], titles, via: "subject title (exact/redirect match, no fuzzy search)" };
}

// Plain-text extract → sections → sentences.
function sectionsOf(extract) {
  const out = [];
  let heading = "Lead";
  let buffer = [];
  const flush = () => { if (buffer.length) out.push({ heading, text: buffer.join(" ") }); buffer = []; };
  for (const line of String(extract || "").split("\n")) {
    const match = /^(=+)\s*(.+?)\s*\1$/.exec(line.trim());
    if (match) { flush(); heading = match[2]; continue; }
    if (line.trim()) buffer.push(line.trim());
  }
  flush();
  return out;
}

function sentences(text) {
  return String(text).replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map((s) => s.trim())
    .filter((s) => { const n = s.split(/\s+/).length; return n >= 7 && n <= 50 && !/^(see|main article|further information)\b/i.test(s) && !/[{}|]/.test(s); });
}

function roleFor(heading, index) {
  if (heading === "Lead") return index === 0 ? "consequence" : "event";
  for (const [pattern, role] of ROLE_BY_HEADING) if (pattern.test(heading)) return role;
  return "evidence";
}

// Pure transformation (unit-testable offline).
function claimsFromExtract(extract, article, options = {}) {
  const limit = options.maxClaims || 160;
  const perSection = options.maxPerSection || 28;
  const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(article.replace(/ /g, "_"))}`;
  const claims = [];
  const seen = new Set();
  for (const section of sectionsOf(extract)) {
    if (SKIP_SECTIONS.test(section.heading)) continue;
    let taken = 0;
    for (const [index, sentence] of sentences(section.text).entries()) {
      const key = sentence.toLowerCase();
      if (seen.has(key) || taken >= perSection || claims.length >= limit) continue;
      seen.add(key);
      taken += 1;
      claims.push({ text: sentence, role: roleFor(section.heading, index), section: section.heading, source: `Wikipedia — ${article}`, url, layer: "SECONDARY SOURCE (encyclopedia)", verbatim: false, licence: "CC BY-SA 4.0" });
    }
  }
  return claims;
}

async function deepen(channel, topic, options = {}) {
  const cacheName = `research/${topic.slug}.deep.json`;
  const cached = options.fresh ? null : Store.readState(channel, "longform", cacheName, null);
  if (cached && cached.channel === channel.slug && cached.claims && cached.claims.length) return cached;
  if (options.offline) return { channel: channel.slug, slug: topic.slug, article: null, claims: [], status: "OFFLINE" };
  const choice = articleFor(topic);
  if (!choice) return { channel: channel.slug, slug: topic.slug, article: null, claims: [], status: "NO_ARTICLE" };
  let res = { status: 0, body: null };
  let page = null;
  for (const title of choice.titles || [choice.title]) {
    res = await getWithRetry(`https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles=${encodeURIComponent(title)}`);
    page = res.body && res.body.query ? Object.values(res.body.query.pages)[0] : null;
    // Disambiguation pages are not evidence.
    if (page && page.missing === undefined && page.extract && !/\bmay (also )?refer to\b/i.test(page.extract.slice(0, 400))) break;
    page = null;
  }
  if (!page || page.missing !== undefined || !page.extract) return { channel: channel.slug, slug: topic.slug, article: choice.title, claims: [], status: res.status ? "ARTICLE_NOT_FOUND" : "FETCH_FAILED" };
  const claims = claimsFromExtract(page.extract, page.title, options);
  // Visual leads: the article's own images (candidates only — licence and
  // relevance are checked by the existing visual chain before any use).
  const imagesRes = await getWithRetry(`https://en.wikipedia.org/w/api.php?action=query&prop=images&imlimit=100&redirects=1&format=json&titles=${encodeURIComponent(page.title)}`);
  const imagePage = imagesRes.body && imagesRes.body.query ? Object.values(imagesRes.body.query.pages)[0] : null;
  const images = ((imagePage && imagePage.images) || []).map((image) => image.title.replace(/^File:/, ""))
    .filter((file) => /\.(jpe?g|png)$/i.test(file) && !/(logo|icon|flag|symbol|seal|coat of arms|question book|commons-|wiktionary|edit-clear|padlock|red pog|location map|locator)/i.test(file));
  const value = { schema: "research-deep/1", channel: channel.slug, slug: topic.slug, article: page.title, via: choice.via, fetchedAt: (options.now || new Date()).toISOString(), licence: "CC BY-SA 4.0 — facts only; never narrate verbatim", claims, images, status: claims.length ? "OK" : "EMPTY" };
  if (options.write !== false) Store.writeState(channel, "longform", cacheName, value);
  return value;
}

// COPY_RISK: a paragraph that reproduces ≥ `n` consecutive words of any
// verbatim:false source sentence is not a rewrite.
function shingles(text, n) {
  const w = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  const out = new Set();
  for (let i = 0; i + n <= w.length; i++) out.add(w.slice(i, i + n).join(" "));
  return out;
}

function copyRisk(paragraph, sourceClaims, n = 9) {
  const mine = shingles(paragraph, n);
  if (!mine.size) return null;
  for (const claim of sourceClaims) {
    if (claim.verbatim !== false) continue;
    for (const gram of shingles(claim.text, n)) if (mine.has(gram)) return { claim: claim.id || null, overlap: gram };
  }
  return null;
}

module.exports = { articleFor, sectionsOf, sentences, claimsFromExtract, deepen, copyRisk, wikiTitleFromUrl };
