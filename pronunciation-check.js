// PRONUNCIATION CHECK — TTS'ten ONCE anlatiyi tarar.
//
//  * config/pronunciation.json sozlugunu uygular (ttsMetni): altyazi orijinal
//    yazimi korur, sese yalnizca "tts" karsiligi gider.
//  * Sozlukte olmayan riskli kelimeleri bulur: kisaltmalar, rakamli/tireli
//    terimler (B-25, O-ring), ozel isimler, uzun teknik terimler.
//  * Yapay zeka kliselerini ("let's dive in", "in today's video"...) yakalar.
//
// Kullanim: node pronunciation-check.js <slug> | --all
// Cikti:    icerik/paket/<slug>/pronunciation-report.md (+ .json)
"use strict";
const path = require("path");
const { KOK, jsonOku, jsonYaz, metinYaz } = require("./lib/ortak");
const { DURAK, cumleler } = require("./lib/metin");
const K = require("./lib/kutuphane");

const sozluk = () => jsonOku(path.join(KOK, "config", "pronunciation.json"), { terms: {}, knownWords: [], cliches: [] });
const kacis = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Sozluk uygulamasi: uzun terimler once (O-rings, O-ring'den once).
function ttsMetni(metin, sz = sozluk()) {
  let out = String(metin);
  const terimler = Object.keys(sz.terms || {}).sort((a, b) => b.length - a.length);
  for (const t of terimler) {
    const hedef = sz.terms[t].tts;
    if (!hedef || hedef === t) continue;
    out = out.replace(new RegExp("(^|[^A-Za-z0-9-])" + kacis(t) + "(?![A-Za-z0-9-])", "gi"), (m, on) => on + hedef);
  }
  return out;
}

const TEKNIK = /(aero|hydro|thermo|electro|pyro|seism|oxid|corros|hemoglob|liquef|tensil|torsion|resonan|oscillat|ductil|buoyan|deflagr|detonat|exsolut|viscos)/i;

function dogrula(metin, sz = sozluk()) {
  const bilinenTerim = new Set(Object.keys(sz.terms || {}).map((x) => x.toLowerCase()));
  const bilinenKelime = new Set((sz.knownWords || []).map((x) => x.toLowerCase()));
  const bulunan = [], supheli = [];
  const gorulen = new Set();
  const ekle = (liste, kelime, tur, not) => {
    const k = kelime.toLowerCase() + "|" + tur;
    if (gorulen.has(k)) return; gorulen.add(k);
    liste.push({ kelime, tur, not });
  };
  for (const c of cumleler(metin)) {
    const tokenlar = c.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) || [];
    tokenlar.forEach((tok, i) => {
      const lw = tok.toLowerCase().replace(/['’]s$/, "");
      if (bilinenTerim.has(lw)) { const t = Object.entries(sz.terms).find(([k]) => k.toLowerCase() === lw);
        ekle(bulunan, tok, t[1].type || "term", "say: " + t[1].say + (t[1].tts !== t[0] ? " · tts: \"" + t[1].tts + "\"" : "")); return; }
      if (/^[A-Z]{2,}$/.test(tok)) {
        if (DURAK.has(lw) || tok.length >= 6) return;               // vurgu (THROUGH, ALL)
        return ekle(supheli, tok, "abbreviation", "TTS may read as a word or spell it — add to config/pronunciation.json");
      }
      if (/\d/.test(tok) && /[A-Za-z]/.test(tok) || /^[A-Za-z]-/.test(tok))
        return ekle(supheli, tok, "alphanumeric", "mixed letters/digits (e.g. B-25) — verify spoken form");
      if (i > 0 && /^[A-Z][a-z]/.test(tok) && !bilinenKelime.has(lw) && !DURAK.has(lw))
        return ekle(supheli, tok, "proper-noun", "name/place — confirm the voice pronounces it correctly");
      if (TEKNIK.test(tok) && tok.length >= 10)
        return ekle(supheli, tok, "engineering", "technical term — confirm pronunciation");
    });
    if (/\d+\s*[–-]\s*\d+\s*%/.test(c)) ekle(supheli, c.match(/\d+\s*[–-]\s*\d+\s*%/)[0], "number-range", "ranges are often read oddly — write in words");
  }
  const kucuk = String(metin).toLowerCase().replace(/[’]/g, "'");
  const kliseler = (sz.cliches || []).filter((k) => kucuk.includes(k));
  const risk = supheli.filter((s) => s.tur !== "engineering").length;
  const puan = Math.max(0, 100 - risk * 8 - supheli.filter((s) => s.tur === "engineering").length * 3 - kliseler.length * 20);
  return { bulunan, supheli, kliseler, puan };
}

function rapor(slug, konu, sonuc) {
  const satir = (x) => `| ${x.kelime} | ${x.tur} | ${x.not} |`;
  return [
    `# Pronunciation validation — ${slug}`, "",
    `Score: **${sonuc.puan}/100** (unresolved risky words: ${sonuc.supheli.length}, AI-cliché phrases: ${sonuc.kliseler.length})`, "",
    "## Dictionary matches (handled automatically)", "",
    sonuc.bulunan.length ? ["| Word | Type | Guide |", "|---|---|---|", ...sonuc.bulunan.map(satir)].join("\n") : "_none_", "",
    "## Needs a human ear (not in config/pronunciation.json)", "",
    sonuc.supheli.length ? ["| Word | Type | Why |", "|---|---|---|", ...sonuc.supheli.map(satir)].join("\n") : "_none_", "",
    "## AI-cliché phrases", "",
    sonuc.kliseler.length ? sonuc.kliseler.map((k) => "- \"" + k + "\" — rewrite in documentary voice").join("\n") : "_none found_", "",
    "To fix: add an entry to `config/pronunciation.json` → `terms` (`say` for humans, `tts` for the voice), or add safe names to `knownWords`.",
  ].join("\n");
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  // Yalnizca SESLENDIRILEN metin telaffuz icin taranir; ekrandaki hook/soru
  // seslendirilmez ama klise taramasina girer.
  const sonuc = dogrula(K.anlati(konu));
  const sz = sozluk(), ekran = [konu.hook, konu.soru].filter(Boolean).join(". ").toLowerCase();
  for (const k of sz.cliches || []) if (ekran.includes(k) && !sonuc.kliseler.includes(k)) {
    sonuc.kliseler.push(k); sonuc.puan = Math.max(0, sonuc.puan - 20);
  }
  jsonYaz(K.paketYolu(slug, "pronunciation-report.json"), sonuc);
  metinYaz(K.paketYolu(slug, "pronunciation-report.md"), rapor(slug, konu, sonuc));
  return sonuc;
}

module.exports = { ttsMetni, dogrula, sozluk, calistir };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error("Kullanim: node pronunciation-check.js <slug> | --all"); process.exit(1); }
  const sluglar = arg === "--all" ? K.konular().map((k) => k.slug) : [arg];
  for (const s of sluglar) {
    const r = calistir(s);
    console.log(`${s.padEnd(30)} ${String(r.puan).padStart(3)}/100  supheli:${r.supheli.length} klise:${r.kliseler.length}`);
  }
}
