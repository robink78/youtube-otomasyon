"use strict";

// THUMBNAIL LEDGER — versioned thumbnail variants per channel.
//
//   channels/<slug>/state/growth/thumbnails.json
//   { variants: [{ slug, file, sha256, concept, layoutType, text, textLength,
//                  templateVersion, human, experimentId, createdAt,
//                  selected, videoId }] }
//
// Success is judged on more than CTR: evaluate() joins the selected variant
// with post-click retention, watch time and subscriber conversion from the
// video's performance record. CTR is only present when entered from Studio;
// there is no thumbnail A/B API, so tests use YouTube Studio's native
// "Test & compare" and are recorded here as experiments.

const fs = require("fs");
const crypto = require("crypto");
const Store = require("./store");

const FILE = "thumbnails.json";

function sha256(file) {
  try { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex"); } catch (error) { return null; }
}

function read(channel) { return Store.readState(channel, "growth", FILE, { variants: [] }) || { variants: [] }; }

function recordVariants(channel, slug, variants, options = {}) {
  const ledger = read(channel);
  const now = (options.now || new Date()).toISOString();
  for (const variant of variants) {
    const hash = variant.sha256 || sha256(variant.file);
    if (ledger.variants.some((item) => item.slug === slug && item.sha256 && item.sha256 === hash)) continue;
    ledger.variants.push({
      slug, file: variant.file, sha256: hash, concept: variant.concept || null, layoutType: variant.layoutType || null,
      text: variant.text || null, textLength: variant.text ? String(variant.text).length : 0, templateVersion: variant.templateVersion || null,
      human: !!variant.human, experimentId: variant.experimentId || null, createdAt: now, selected: !!variant.selected, videoId: variant.videoId || null,
    });
  }
  ledger.variants = ledger.variants.slice(-1000);
  if (options.write !== false) Store.writeState(channel, "growth", FILE, ledger);
  return ledger;
}

function markSelected(channel, slug, file, videoId) {
  const ledger = read(channel);
  for (const item of ledger.variants.filter((variant) => variant.slug === slug)) item.selected = item.file === file || (item.selected && !file);
  for (const item of ledger.variants.filter((variant) => variant.slug === slug && variant.selected)) item.videoId = videoId || item.videoId;
  Store.writeState(channel, "growth", FILE, ledger);
  return ledger;
}

// Selected variants with the video's measured outcome (CTR only if manual).
function evaluate(ledger, performanceRows) {
  const byVideo = new Map((performanceRows || []).map((row) => [row.videoId, row]));
  return (ledger.variants || []).filter((item) => item.selected && item.videoId).map((item) => {
    const metrics = (byVideo.get(item.videoId) || {}).metrics || {};
    return { slug: item.slug, videoId: item.videoId, concept: item.concept, layoutType: item.layoutType, textLength: item.textLength,
      ctr: Number.isFinite(metrics.ctr) ? metrics.ctr : null, averagePercentageViewed: metrics.averagePercentageViewed ?? null,
      watchHoursPer1000Views: metrics.watchHoursPer1000Views ?? null, subscribersPer1000Views: metrics.subscribersPer1000Views ?? null };
  });
}

module.exports = { FILE, sha256, read, recordVariants, markSelected, evaluate };
