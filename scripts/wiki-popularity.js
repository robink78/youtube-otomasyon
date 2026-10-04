#!/usr/bin/env node
"use strict";

// Refreshes config/wiki-popularity.json: average monthly Wikipedia pageviews
// (last 12 complete months, human traffic only) of every topic's own article,
// for all three channels. Read by core/growth/popularity.js.
//
//   node scripts/wiki-popularity.js            # all channels
//   node scripts/wiki-popularity.js --dry-run  # list articles, no requests

const fs = require("fs");
const path = require("path");
const https = require("https");
const Popularity = require("../core/growth/popularity");

const ROOT = path.join(__dirname, "..");
const USER_AGENT = "youtube-otomasyon/1.0 (https://github.com/eyazan/youtube-otomasyon; topic popularity)";
const CONCURRENCY = 2;

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function rawTopics() {
  const out = [];
  const frDir = path.join(ROOT, "icerik", "konular");
  for (const file of fs.readdirSync(frDir).filter((name) => name.endsWith(".json"))) {
    out.push(["failure-reconstructed", readJson(path.join(frDir, file), {})]);
  }
  for (const channel of ["impossible-brief", "critical-thread"]) {
    const data = readJson(path.join(ROOT, "channels", channel, "topics", "topic-universe.json"), []);
    const list = Array.isArray(data) ? data : data.topics || Object.values(data).find(Array.isArray) || [];
    for (const topic of list) out.push([channel, topic]);
  }
  return out;
}

function monthRange(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - 86400000);
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  const fmt = (date) => `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}01`;
  return { start: fmt(start), end: fmt(end) };
}

function get(url) {
  return new Promise((resolve) => {
    const request = https.get(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" }, timeout: 30000 }, (response) => {
      const parts = [];
      response.on("data", (chunk) => parts.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, body: Buffer.concat(parts).toString("utf8") }));
    });
    request.on("timeout", () => request.destroy(new Error("timeout")));
    request.on("error", () => resolve({ status: 0, body: "" }));
  });
}

// Pageviews count the exact title only; a redirect ("2005 Buncefield fire" ->
// "Buncefield fire") would read as a handful of views. Resolve redirects and
// normalisation first, 50 titles per request.
async function canonicalTitles(articles) {
  const map = {};
  for (let index = 0; index < articles.length; index += 50) {
    const batch = articles.slice(index, index + 50);
    const url = "https://en.wikipedia.org/w/api.php?action=query&format=json&redirects=1&titles=" + encodeURIComponent(batch.join("|"));
    const response = await get(url);
    let body = {};
    try { body = JSON.parse(response.body).query || {}; } catch (error) {}
    const step = new Map();
    for (const item of [...(body.normalized || []), ...(body.redirects || [])]) step.set(item.from, item.to);
    for (const title of batch) {
      let current = title;
      for (let hops = 0; hops < 4 && step.has(current); hops += 1) current = step.get(current);
      map[title] = current;
    }
  }
  return map;
}

async function monthlyViews(article, range) {
  const title = encodeURIComponent(article.replace(/ /g, "_"));
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${title}/monthly/${range.start}/${range.end}`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await get(url);
    if (response.status === 404) return 0;
    if (response.status === 200) {
      const items = (JSON.parse(response.body).items || []).map((item) => item.views);
      return items.length ? Math.round(items.reduce((sum, value) => sum + value, 0) / items.length) : 0;
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt * attempt));
  }
  return null;
}

async function main(argv = process.argv.slice(2)) {
  const articles = [...new Set(rawTopics().map(([channel, raw]) => Popularity.primaryArticle(channel, raw)).filter(Boolean))].sort();
  console.log(`${articles.length} distinct primary articles`);
  if (argv.includes("--dry-run")) { console.log(articles.slice(0, 20).join("\n")); return; }
  const range = monthRange();
  const canonical = await canonicalTitles(articles);
  const previous = Popularity.load();
  const result = {};
  let index = 0;
  let failed = 0;
  async function worker() {
    while (index < articles.length) {
      const article = articles[index++];
      const target = canonical[article] || article;
      const views = await monthlyViews(target, range);
      if (views == null) { failed += 1; if (previous.articles[article]) result[article] = previous.articles[article]; continue; }
      result[article] = target === article ? { monthlyViews: views } : { monthlyViews: views, resolvedTitle: target };
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const out = {
    _note: "Average monthly human pageviews of each topic's own English Wikipedia article. Refresh with: node scripts/wiki-popularity.js",
    generatedAt: new Date().toISOString(),
    range,
    articles: Object.fromEntries(Object.keys(result).sort().map((key) => [key, result[key]])),
  };
  fs.writeFileSync(Popularity.FILE, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${Object.keys(result).length} articles (${failed} failed, previous values kept) to ${path.relative(ROOT, Popularity.FILE)}`);
}

if (require.main === module) main().catch((error) => { console.error(error.message); process.exitCode = 1; });

module.exports = { rawTopics, monthRange };
