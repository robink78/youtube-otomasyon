"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Provenance = require("../../lib/provenance");

test("PROV-01: IB/CT manifests carry source, URL, licence, evidence and attribution duty per asset", () => {
  const manifest = Provenance.build({ channel: "critical-thread", slug: "tunnel",
    stills: [{ file: "Tunel mont blanc.jpg", licence: "Public domain", author: "Pannage", sourceUrl: "https://commons.wikimedia.org/wiki/File:Tunel_mont_blanc.jpg", origin: "wikipedia-article" },
      { file: "Gotthard.jpg", licence: "CC BY 2.0", author: "Kecko", sourceUrl: "https://commons.wikimedia.org/wiki/File:Gotthard.jpg" }],
    clips: [{ file: "Pexels video 1", licence: "Pexels License", author: "A", sourceUrl: "https://www.pexels.com/video/1/", origin: "pexels" }], voiceProvider: "Microsoft Edge neural TTS" });
  assert.deepEqual(manifest.allowedChannels, ["critical-thread"]);
  const [pd, ccby, pexels] = manifest.assets;
  assert.deepEqual([pd.attributionRequired, ccby.attributionRequired, pexels.attributionRequired], [false, true, false]);
  assert.equal(ccby.licenceEvidence, "https://commons.wikimedia.org/wiki/File:Gotthard.jpg");
  assert.ok(manifest.assets.some((asset) => asset.generated && asset.kind === "audio" && /TTS/.test(asset.source)), "synthetic voice listed");
  assert.deepEqual(Provenance.check(manifest, { channel: "critical-thread", description: "Visual credits: Gotthard.jpg — Kecko; CC BY 2.0" }), []);
  assert.match(Provenance.check(manifest, { channel: "critical-thread", description: "no credits" }).join(), /attribution missing from description: Kecko/);
  assert.match(Provenance.check(manifest, { channel: "impossible-brief" }).join(), /cleared for critical-thread, not impossible-brief/, "assets never cross channels");
  assert.deepEqual(Provenance.check(null), ["provenance manifest missing"]);
});

test("PROV-01: Failure Reconstructed credit lines become provenance entries without guessing a licence", () => {
  const photo = Provenance.fromCreditLine("Archival film: Wikimedia Commons (Public domain) — https://commons.wikimedia.org/wiki/File:Dam_1971.jpg");
  assert.deepEqual([photo.kind, photo.source, photo.licence, photo.attributionRequired], ["image", "wikimedia-commons", "Public domain", false]);
  const film = Provenance.fromCreditLine("Archival film: Wikimedia Commons (Public domain) — https://commons.wikimedia.org/wiki/File:Collapse.ogv");
  assert.equal(film.kind, "video");
  const stock = Provenance.fromCreditLine("Stock footage: Pexels (Pexels License) — clips by Jane Doe, Joe — https://www.pexels.com/license/");
  assert.deepEqual([stock.source, stock.licence, stock.attribution.trim()], ["pexels", "Pexels License", "Jane Doe, Joe"]);
  const unknown = Provenance.fromCreditLine("Some image from somewhere");
  assert.equal(unknown.licence, null);
  assert.match(Provenance.check(Provenance.build({ channel: "failure-reconstructed", slug: "x", extra: [unknown] })).join(), /no licence recorded/);
});

test("THUMB-01: thumbnail variants are versioned by hash with concept, layout, text and selection", () => {
  const saved = process.env.GROWTH_STATE_ROOT;
  process.env.GROWTH_STATE_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "thumbs-"));
  try {
    const Thumbnails = require("../../core/growth/thumbnails");
    const ch = require("../../core/channel-context").getChannel("failure-reconstructed");
    const file = path.join(os.tmpdir(), `thumb-${process.pid}.jpg`);
    fs.writeFileSync(file, "jpeg-bytes");
    Thumbnails.recordVariants(ch, "challenger", [{ file, concept: "event-frame", layoutType: "subject-right-text-left", text: "73 SECONDS", templateVersion: "v1", selected: true },
      { file: file + "2", sha256: "b".repeat(64), concept: "big-number", text: "73", templateVersion: "v1" }]);
    Thumbnails.recordVariants(ch, "challenger", [{ file, concept: "event-frame" }]);
    const ledger = Thumbnails.read(ch);
    assert.equal(ledger.variants.length, 2, "same file hash is not recorded twice");
    assert.equal(ledger.variants[0].textLength, 10);
    Thumbnails.markSelected(ch, "challenger", file, "VID");
    const evaluated = Thumbnails.evaluate(Thumbnails.read(ch), [{ videoId: "VID", metrics: { averagePercentageViewed: 80, subscribersPer1000Views: 2, watchHoursPer1000Views: 5 } }]);
    assert.deepEqual([evaluated.length, evaluated[0].ctr, evaluated[0].averagePercentageViewed, evaluated[0].subscribersPer1000Views], [1, null, 80, 2], "judged on retention and conversion, CTR only if entered");
    const other = Thumbnails.read(require("../../core/channel-context").getChannel("impossible-brief"));
    assert.equal(other.variants.length, 0, "per-channel ledger");
  } finally { if (saved === undefined) delete process.env.GROWTH_STATE_ROOT; else process.env.GROWTH_STATE_ROOT = saved; }
});

test("the licensing gate is opt-in and blocks before any upload session", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../youtube-yukle.js"), "utf8");
  assert.match(source, /process\.env\.PROVENANCE_REQUIRED === "1" && kaynakSorunlari\.length/);
  assert.ok(source.indexOf("PROVENANCE_INCOMPLETE") < source.indexOf("Safety.runUpload"));
});
