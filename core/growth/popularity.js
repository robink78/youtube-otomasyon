"use strict";

// Topic popularity from Wikipedia pageviews (Wikimedia REST API, free, no key).
//
// Shorts that name something viewers already know (Challenger, Apollo 13,
// Chernobyl) are swiped away less than obscure cases. Monthly pageviews of a
// topic's own Wikipedia article are a measured, public proxy for that
// recognition. scripts/wiki-popularity.js refreshes config/wiki-popularity.json;
// scoring reads only that committed file, so production never depends on the
// network for ranking.
//
//   score = 20 * log10(monthly views / 10), clamped 0-100
//   1k/month -> 40 · 10k -> 60 · 100k -> 80 · 1M -> 100

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "..", "config", "wiki-popularity.json");
let cache = null;

function load(file = FILE) {
  if (file === FILE && cache) return cache;
  let data;
  try { data = JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { data = { articles: {} }; }
  if (!data.articles) data.articles = {};
  if (file === FILE) cache = data;
  return data;
}

function score(monthlyViews) {
  const views = Number(monthlyViews);
  if (!Number.isFinite(views) || views <= 0) return null;
  return Math.max(0, Math.min(100, Math.round(20 * Math.log10(views / 10))));
}

function wikiTitle(url) {
  const match = String(url || "").match(/en\.wikipedia\.org\/wiki\/([^#?\s]+)/);
  if (!match) return null;
  try { return decodeURIComponent(match[1]).replace(/_/g, " "); } catch (error) { return match[1].replace(/_/g, " "); }
}

// The topic's own article: Failure Reconstructed's first technical reference,
// ImpossibleBrief / CriticalThread's first sourced fact.
function primaryArticle(channelSlug, raw = {}) {
  const references = channelSlug === "failure-reconstructed"
    ? ((raw.vaka || {}).kaynakca || [])
    : [...(raw.facts || []), ...(raw.researchEvidence || [])];
  for (const item of references) {
    const title = wikiTitle(item && item.url);
    if (title) return title;
  }
  return null;
}

function forTopic(channelSlug, raw, data = load()) {
  const article = primaryArticle(channelSlug, raw);
  if (!article) return null;
  const entry = data.articles[article];
  if (!entry || !Number.isFinite(entry.monthlyViews)) return { article, monthlyViews: null, score: null };
  return { article, monthlyViews: entry.monthlyViews, score: score(entry.monthlyViews) };
}

module.exports = { FILE, load, score, wikiTitle, primaryArticle, forTopic };
