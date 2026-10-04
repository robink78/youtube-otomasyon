"use strict";

// Builds the per-channel scoring context: inventory, template index, what the
// channel already published/produced, cluster depth and this channel's own
// adopted learning. Only one channel's files are read.

const fs = require("fs");
const path = require("path");
const M = require("../../lib/metin");
const Config = require("./config");
const Model = require("./topic-model");
const Sources = require("./sources");
const Hooks = require("./hooks");
const Scoring = require("./topic-scoring");

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function history(channel) {
  const legacy = channel.config.pathMode === "legacy-adapter";
  const state = channel.paths.state;
  const published = readJson(path.join(state, legacy ? "yayinlananlar.json" : "published.json"), [])
    .filter((item) => !item.channel || item.channel === channel.slug);
  const generatedRaw = readJson(path.join(state, legacy ? "uretilenler.json" : "generated.json"), []);
  const generated = (Array.isArray(generatedRaw) ? generatedRaw : []).map((item) => typeof item === "string" ? item : item.topicId || item.slug).filter(Boolean);
  const blocked = Object.keys(readJson(path.join(state, legacy ? "engellenen.json" : "blocked.json"), {}) || {});
  const failedRaw = readJson(path.join(state, legacy ? "basarisiz.json" : "failed.json"), []);
  const failed = Array.isArray(failedRaw) ? failedRaw : [];
  const used = new Set([...generated, ...published.map((item) => item.slug), ...published.map((item) => item.topicId), ...failed].filter(Boolean));
  return { published, generated, blocked, failed, used, publishedTitles: published.map((item) => item.baslik || item.title).filter(Boolean) };
}

function build(channel, options = {}) {
  const config = Config.forChannel(channel);
  const inventory = options.inventory || Model.inventory(channel);
  const index = Model.templateIndex(inventory, { minimumRepeats: config.topic.templateFieldMinimumRepeats, share: config.topic.templateFieldShare });
  const clusterSizes = {};
  for (const topic of inventory) clusterSizes[topic.cluster] = (clusterSizes[topic.cluster] || 0) + 1;
  const past = options.history || history(channel);
  const learning = options.learning || require("./learning").read(channel);
  const shortsLearning = (learning && learning.shorts) || {};
  const performanceRows = options.performanceRows || require("./analytics").readAll(channel).filter((row) => row.contentType === "short");
  const clusterPerformance = {};
  for (const row of performanceRows) {
    const cluster = row.topicCluster || "uncategorized";
    const group = clusterPerformance[cluster] = clusterPerformance[cluster] || { n: 0, recentN: 0, scores: [], breakouts: 0, subscribers: [] };
    group.n += 1;
    if (row.publishAt && Date.now() - Date.parse(row.publishAt) <= 30 * 86400000) group.recentN += 1;
    if (row.performance && Number.isFinite(row.performance.growthScore)) group.scores.push(row.performance.growthScore);
    if (row.performance && row.performance.classification === "BREAKOUT") group.breakouts += 1;
    if (row.normalized && Number.isFinite(row.normalized.subscriberConversion)) group.subscribers.push(row.normalized.subscriberConversion);
  }
  for (const group of Object.values(clusterPerformance)) {
    group.score = group.scores.length ? Math.round(group.scores.reduce((sum, value) => sum + value, 0) / group.scores.length) : 50;
    group.breakoutRate = group.n ? group.breakouts / group.n : 0;
    group.subscriberConversion = group.subscribers.length ? group.subscribers.reduce((sum, value) => sum + value, 0) / group.subscribers.length : null;
  }
  return {
    channel, config, inventory, index, clusterSizes, history: past,
    learnedWeights: (shortsLearning.adoptedWeights || {}),
    learnedFamilyBonus: (shortsLearning.adoptedHookFamilyBonus || {}),
    learnedTitlePatternBonus: (shortsLearning.adoptedTitlePatternBonus || {}),
    learnedClusterBonus: (shortsLearning.adoptedClusterBonus || {}),
    learnedDurationBucketBonus: (shortsLearning.adoptedDurationBucketBonus || {}),
    performanceRows,
    clusterPerformance,
    learning,
  };
}

function duplicateOf(topic, ctx) {
  const titles = ctx.history.publishedTitles;
  for (const title of titles) {
    if (M.kelimeBenzerlik(title, topic.title) >= ctx.config.topic.nearDuplicateTitleSimilarity) return `published title "${title}"`;
  }
  return null;
}

// Score one topic for Shorts; returns score record plus the hook bundle.
function evaluate(topic, ctx, options = {}) {
  const boilerplate = Model.boilerplate(topic, ctx.index);
  const hooks = Hooks.generate(topic, ctx.config, {
    templatedFields: boilerplate.templatedFields,
    openingMaxSeconds: (ctx.channel.config.retentionRules || {}).openingMaxSeconds,
    learnedFamilyBonus: ctx.learnedFamilyBonus,
  });
  const sourceQuality = Sources.sourceQuality(topic.sources);
  const scoringContext = {
    config: ctx.config, boilerplate, hooks, sourceQuality, publishedTitles: ctx.history.publishedTitles,
    clusterSizes: ctx.clusterSizes, learnedWeights: ctx.learnedWeights, learnedClusterBonus: ctx.learnedClusterBonus,
    clusterPerformance: ctx.clusterPerformance, duplicate: options.skipDuplicate ? null : duplicateOf(topic, ctx),
    performance: options.performance || {},
  };
  const score = Scoring.scoreShort(topic, scoringContext);
  return { topic, boilerplate, hooks, sourceQuality, score };
}

function evaluateLong(topic, ctx, options = {}) {
  const boilerplate = Model.boilerplate(topic, ctx.index);
  const sourceQuality = Sources.sourceQuality(topic.sources);
  return Scoring.scoreLongForm(topic, {
    config: ctx.config, boilerplate, sourceQuality, clusterSizes: ctx.clusterSizes,
    shortsEvidence: options.shortsEvidence || null, relatedCount: options.relatedCount || 0,
  });
}

// Rank unused topics. D never enters the production list.
function rank(channel, options = {}) {
  const ctx = options.context || build(channel, options);
  const rows = [];
  for (const topic of ctx.inventory) {
    if (!options.includeUsed && (ctx.history.used.has(topic.id) || ctx.history.used.has(topic.slug))) continue;
    if (topic.format === "long") continue;
    rows.push(evaluate(topic, ctx));
  }
  const order = { A: 0, B: 1, C: 2, D: 3 };
  rows.sort((a, b) => order[a.score.bucket] - order[b.score.bucket] || b.score.SelectionScore - a.score.SelectionScore || b.score.VideoPotentialScore - a.score.VideoPotentialScore);
  const distribution = { A: 0, B: 0, C: 0, D: 0 };
  for (const row of rows) distribution[row.score.bucket] += 1;
  return { channel: channel.slug, context: ctx, rows, distribution };
}

module.exports = { history, build, evaluate, evaluateLong, rank, duplicateOf };
