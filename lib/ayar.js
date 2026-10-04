// AYAR — config/growth.json'u varsayilanlarla birlestirerek okur.
// Dosya eksik/bozuk olsa bile sistem guvenli varsayilanlarla calisir.
"use strict";
const path = require("path");
const { KOK, jsonOku } = require("./ortak");
const Channel = require("../core/channel-context");

const VARSAYILAN = {
  brand: {
    name: "Failure Reconstructed",
    tagline: "Forensic Engineering Documentaries",
    handle: "@FailureReconstructed",
  },
  ctaStrategy: "adaptive",
  disclosure: { enabled: true, label: "AI RECONSTRUCTION", labelDiagrams: false,
    descriptionNote: true, voiceNote: "Narration uses a synthetic voice. Footage is real archival or licensed stock unless labelled RECONSTRUCTION." },
  qualityGate: {
    publish: 85, review: 70,
    weights: { title: 1, thumbnail: 0.8, hook: 1.2, script: 1.2, originality: 1.2, visual: 1, engineering: 1.1, source: 1, audio: 0.8 },
    hardBlocks: { originality: 40, source: 40, audio: 30 },
    blockOnReview: false,
  },
  publishing: {
    short: { everyDays: 1, maxStretchDays: 3 },
    long: { everyDays: 5, maxStretchDays: 10 },
    stretchWhenRecentBlocks: 2, stretchOnReview: false,
    schedule: { enabled: false, hourUTC: 18, minLeadHours: 1, gates: ["PUBLISH"] },
  },
  originality: { reviewAt: { title: 0.72, hook: 0.7, structure: 0.9, sentences: 0.25, scenes: 0.8, visualReuse: 0.35,
    thumbnail: 0.75, cta: 0.85, description: 0.6, music: 0.95 }, blockAt: { title: 0.92, sentences: 0.6 } },
  renk: { stok: "eq=saturation=0.5:contrast=1.12:brightness=-0.04:gamma=0.95,colorbalance=rs=-0.06:gs=-0.01:bs=0.07:rm=-0.03:bm=0.03:rh=-0.02:bh=0.02,curves=all='0/0.03 0.5/0.47 1/0.95'" },
  clusters: { minVideosForPlaylist: 3 },
  pinnedComment: { post: true },
  analytics: { checkpoints: [1, 3, 7, 14, 30], minSampleForInsight: 5, minViewsForRates: 100 },
};

function birlestir(a, b) {
  if (Array.isArray(a) || typeof a !== "object" || a === null) return b === undefined ? a : b;
  const o = { ...a };
  for (const [k, v] of Object.entries(b || {})) o[k] = (k in a) ? birlestir(a[k], v) : v;
  return o;
}

const _onbellek = new Map();
function ayar() {
  const channel = Channel.getChannel();
  if (_onbellek.has(channel.slug)) return _onbellek.get(channel.slug);
  const cadence = channel.config.publishingCadence || {};
  const thresholds = channel.config.qualityThresholds || {};
  const channelSettings = {
    brand: { ...channel.brand, name: channel.name },
    ctaStrategy: channel.config.ctaStrategy,
    qualityGate: {
      publish: thresholds.publish,
      review: thresholds.review,
      hardBlocks: {
        originality: thresholds.originalityMinimum,
        source: thresholds.sourceQualityMinimum || thresholds.sourceMinimum,
      },
    },
    publishing: {
      short: { everyDays: cadence.shorts && cadence.shorts.everyDays, maxStretchDays: Math.max(3, (cadence.shorts && cadence.shorts.everyDays) || 1) },
      long: { everyDays: cadence.longForm && cadence.longForm.everyDays, maxStretchDays: Math.max(10, (cadence.longForm && cadence.longForm.everyDays) || 7) },
      schedule: {
        enabled: true,
        hourUTC: Number(String(channel.config.publishTimeUtc || "18:00").split(":")[0]),
        minLeadHours: 1,
        gates: ["PUBLISH"],
      },
    },
    analytics: {
      checkpoints: channel.config.analytics && channel.config.analytics.checkpointsDays,
      minSampleForInsight: channel.config.analytics && channel.config.analytics.minSample,
    },
  };
  const legacyMode = channel.config.pathMode === "legacy-adapter";
  const legacy = legacyMode ? jsonOku(path.join(KOK, "config", "growth.json"), {}) : {};
  // The original channel must remain byte-for-byte compatible in behavior; its
  // established growth.json therefore remains authoritative during migration.
  const value = legacyMode ? birlestir(VARSAYILAN, legacy) : birlestir(VARSAYILAN, channelSettings);
  _onbellek.set(channel.slug, value);
  return value;
}

module.exports = { ayar, VARSAYILAN, birlestir };
