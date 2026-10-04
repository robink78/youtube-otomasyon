"use strict";

const fs = require("fs");
const path = require("path");
const { getChannel } = require("../channel-context");

const FIELDS = ["hookType", "durationRange", "secondBeat", "visualChangeFrequency", "questionStyle", "category", "ctaStyle"];

function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (error) { return fallback; }
}

function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }

function aggregate(samples, key) {
  const groups = new Map();
  for (const sample of samples) {
    if (sample[key] == null || !Number.isFinite(sample.averagePercentageViewed)) continue;
    const name = String(sample[key]);
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(sample.averagePercentageViewed);
  }
  return [...groups.entries()].map(([value, values]) => ({
    value,
    sample: values.length,
    averagePercentageViewed: Math.round(mean(values) * 100) / 100,
  })).sort((a, b) => b.averagePercentageViewed - a.averagePercentageViewed || b.sample - a.sample);
}

function learn(samples, channel = getChannel()) {
  const valid = (samples || []).filter((sample) => sample.channel === channel.slug && Number.isFinite(sample.averagePercentageViewed));
  const minimum = channel.config.retentionRules.learnAfterVideos || 5;
  const enoughOverall = valid.length >= minimum;
  const learnedRules = FIELDS.map((key) => {
    const evidence = aggregate(valid, key);
    // Never turn one video into a strategy. A pattern needs at least two videos
    // and the channel needs its configured overall sample floor.
    const supported = evidence.filter((row) => row.sample >= 2);
    const best = enoughOverall && supported.length ? supported[0] : null;
    const weak = enoughOverall && supported.length > 1 ? supported[supported.length - 1] : null;
    return {
      key,
      value: best && best.value || null,
      weakValue: weak && weak.value || null,
      evidenceVideos: valid.length,
      confidence: best ? "SUPPORTED" : "INSUFFICIENT_DATA",
      aggregates: evidence,
    };
  });
  const value = {
    channel: channel.slug,
    status: enoughOverall ? "sample-floor-met" : "insufficient-data",
    minimumSample: minimum,
    sampleSize: valid.length,
    learnedRules,
    lastUpdated: new Date().toISOString(),
    caveat: "Observed associations only; topic, timing and packaging can confound retention. No causal claim.",
  };
  fs.mkdirSync(channel.paths.memory, { recursive: true });
  fs.writeFileSync(path.join(channel.paths.memory, "retention-rules.json"), JSON.stringify(value, null, 2) + "\n");
  fs.writeFileSync(path.join(channel.paths.memory, "learning.json"), JSON.stringify(value, null, 2) + "\n");
  return value;
}

function latestMeasurement(directory) {
  if (!fs.existsSync(directory)) return null;
  return fs.readdirSync(directory).filter((file) => /^\d+d\.json$|^manual-.*\.json$/.test(file))
    .map((file) => read(path.join(directory, file), null)).filter(Boolean)
    .sort((a, b) => String(a.toplandi || "").localeCompare(String(b.toplandi || ""))).pop() || null;
}

function topicFor(channel, publication) {
  if (channel.config.pathMode === "legacy-adapter") return read(path.join(channel.paths.topics, publication.slug + ".json"), null);
  const universe = read(channel.paths.topicUniverse, { topics: [] });
  return (universe.topics || []).find((topic) => topic.id === publication.topicId || topic.slug === publication.slug) || null;
}

function classifyHook(text) {
  const value = String(text || "");
  if (/\?/.test(value)) return "question";
  if (/\d/.test(value)) return "number-or-countdown";
  if (/\b(?:died|explod|fell|collapse|destroy|sank|burn|tore|lost)\b/i.test(value)) return "consequence";
  return "statement";
}

function durationRange(seconds) {
  if (!Number.isFinite(seconds)) return null;
  if (seconds < 25) return "under-25s";
  if (seconds <= 35) return "25-35s";
  return "over-35s";
}

function samplesFromAnalytics(channel = getChannel()) {
  const legacy = channel.config.pathMode === "legacy-adapter";
  const publications = read(path.join(channel.paths.state, legacy ? "yayinlananlar.json" : "published.json"), []);
  const pacing = require("../../scene-pacing");
  const rows = [];
  for (const publication of publications) {
    if (!publication.videoId) continue;
    const measurement = latestMeasurement(path.join(channel.paths.analytics, publication.videoId));
    const avp = measurement && measurement.metrikler && measurement.metrikler.averageViewPercentage;
    if (!avp || avp.durum !== "ok" || !Number.isFinite(avp.deger)) continue;
    const topic = topicFor(channel, publication) || {};
    const scenes = topic.sahneler || [];
    const duration = measurement.sureSn;
    const first = scenes[0] && scenes[0].metin || topic.openingLine || topic.hook || "";
    const second = scenes[1] && scenes[1].metin || topic.secondBeat || "";
    rows.push({
      channel: channel.slug,
      videoId: publication.videoId,
      averagePercentageViewed: avp.deger,
      hookType: classifyHook(first),
      durationRange: durationRange(duration),
      secondBeat: second ? pacing.rolBul(second, 1, Math.max(3, scenes.length || 3)) : null,
      visualChangeFrequency: scenes.length && duration ? (duration / scenes.length <= 3.5 ? "fast" : "measured") : null,
      questionStyle: classifyHook(topic.soru || topic.coreQuestion || publication.baslik) === "question" ? "question" : "statement",
      category: topic.vaka && topic.vaka.kume || topic.category || null,
      ctaStyle: channel.config.ctaStrategy || null,
    });
  }
  return rows;
}

module.exports = { FIELDS, aggregate, learn, latestMeasurement, classifyHook, durationRange, samplesFromAnalytics };
