// PROVENANCE — one manifest per video listing every external and generated
// asset with its source, licence, licence evidence and attribution duty.
//
//   <package>/provenance.json
//   { channel, slug, allowedChannels: [channel], createdAt, assets: [...] }
//
// An asset may only be used by the channel it was cleared for
// (allowedChannels). Generated assets (synthetic narration, procedural music,
// number cards) are listed too, so the manifest is complete. Licence values
// are copied from the source records (Wikimedia/NASA/Pexels metadata); this
// module never upgrades or guesses a licence.
"use strict";

const fs = require("fs");
const path = require("path");

const NO_ATTRIBUTION = /public domain|cc0|pd-|pexels licen[cs]e|nasa media usage/i;

function attributionRequired(licence) {
  return !NO_ATTRIBUTION.test(String(licence || ""));
}

function fromStill(still) {
  return { kind: "image", source: still.origin || "wikimedia-commons", title: still.file || null, sourceUrl: still.sourceUrl || null,
    licence: still.licence || null, licenceEvidence: still.sourceUrl || null, attribution: still.author || null,
    attributionRequired: attributionRequired(still.licence), expiry: null };
}

function fromClip(clip) {
  return { kind: "video", source: clip.origin || "pexels", title: clip.file || null, sourceUrl: clip.sourceUrl || null,
    licence: clip.licence || null, licenceEvidence: clip.sourceUrl || null, attribution: clip.author || null,
    attributionRequired: attributionRequired(clip.licence), expiry: null };
}

const GENERATED = Object.freeze({
  voice: (provider) => ({ kind: "audio", source: provider || "Microsoft Edge neural TTS", title: "narration", licence: "generated — synthetic voice, disclosed in the description", licenceEvidence: null, attribution: null, attributionRequired: false, expiry: null, generated: true }),
  music: () => ({ kind: "audio", source: "procedural synthesis (ffmpeg)", title: "music bed", licence: "original — generated per video", licenceEvidence: null, attribution: null, attributionRequired: false, expiry: null, generated: true }),
  graphics: () => ({ kind: "image", source: "generated graphics (captions, number cards, diagrams)", title: "on-screen graphics", licence: "original", licenceEvidence: null, attribution: null, attributionRequired: false, expiry: null, generated: true }),
});

// Failure Reconstructed's source ledger stores one credit line per asset:
//   "Archival film: Wikimedia Commons (Public domain) — https://commons..."
//   "Stock footage: Pexels (Pexels License) — clips by A, B — https://www.pexels.com/license/"
// Licence and URL are taken from the line; an unparseable line keeps
// licence null so check() reports it.
function fromCreditLine(line) {
  const text = String(line || "");
  const url = (text.match(/https?:\/\/\S+/) || [null])[0];
  const licence = (text.match(/\(([^)]+)\)/) || [null, null])[1];
  const source = /wikimedia/i.test(text) ? "wikimedia-commons" : /pexels/i.test(text) ? "pexels" : /archive\.org|internet archive/i.test(text) ? "internet-archive" : /nasa/i.test(text) ? "nasa" : "external";
  const kind = /\.(jpe?g|png|webp|tiff?|gif|svg)\b/i.test(url || "") ? "image" : /\.(ogv|webm|mp4|mov|mpe?g)\b/i.test(url || "") || /footage|clip/i.test(text) ? "video" : /film/i.test(text) ? "video" : "image";
  return { kind, source, title: text.split(" — ")[0].slice(0, 160), sourceUrl: url,
    licence, licenceEvidence: url, attribution: source === "pexels" ? (text.match(/clips by ([^—]+)/) || [null, null])[1] : null,
    attributionRequired: licence ? attributionRequired(licence) : true, expiry: null };
}

function build({ channel, slug, stills = [], clips = [], voiceProvider = null, music = true, extra = [] }) {
  return {
    channel, slug, allowedChannels: [channel], createdAt: new Date().toISOString(),
    assets: [...stills.map(fromStill), ...clips.map(fromClip), ...extra, GENERATED.voice(voiceProvider), ...(music ? [GENERATED.music()] : []), GENERATED.graphics()],
  };
}

// Problems that should stop a publish when the provenance gate is enabled.
function check(manifest, { channel, description = "" } = {}) {
  const problems = [];
  if (!manifest) return ["provenance manifest missing"];
  if (channel && !(manifest.allowedChannels || []).includes(channel)) problems.push(`assets cleared for ${(manifest.allowedChannels || []).join(",")}, not ${channel}`);
  for (const asset of manifest.assets || []) {
    if (asset.generated) continue;
    if (!asset.licence) problems.push(`no licence recorded: ${asset.title || asset.sourceUrl}`);
    if (asset.attributionRequired && asset.attribution && description && !description.includes(String(asset.attribution).trim().slice(0, 40))) {
      problems.push(`attribution missing from description: ${asset.attribution}`);
    }
  }
  return problems;
}

function write(directory, manifest) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, "provenance.json"), JSON.stringify(manifest, null, 2) + "\n");
  return path.join(directory, "provenance.json");
}

function read(directory) {
  try { return JSON.parse(fs.readFileSync(path.join(directory, "provenance.json"), "utf8")); } catch (error) { return null; }
}

module.exports = { attributionRequired, fromStill, fromClip, fromCreditLine, build, check, write, read };
