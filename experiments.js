// EXPERIMENTS — izlenme/abone buyume deneyleri (kayit + olculu degerlendirme).
//
// Her deney: hipotez, degisken, kollar (A/B), video kimlikleri, baslangic tarihi,
// olculen metrikler, sonuc, guven. Kucuk orneklemde NEDENSELLIK IDDIA EDILMEZ:
// kol basina 5'ten az video varsa sonuc "insufficient data" olarak yazilir;
// yeterli veride bile ifade "consistent with the hypothesis" seviyesinde kalir.
//
// Veri: experiments/experiments.json. Metrikler analytics/<id>/7d.json (yoksa en
// son olcum) dosyalarindan okunur — deney kendi basina veri uydurmaz.
//
// Kullanim:
//   node experiments.js                      liste + durum
//   node experiments.js ekle <deney-id> <videoId> <kol>
//   node experiments.js baslat <deney-id>
//   node experiments.js degerlendir [<deney-id>]
"use strict";
const fs = require("fs");
const path = require("path");
const { KOK, jsonOku, jsonYaz, metinYaz, bugun, videoIdGecerli } = require("./lib/ortak");

const DOSYA = path.join(KOK, "experiments", "experiments.json");
const MIN_KOL = 5;

const SABLON = [
  { id: "title-style", degisken: "title pattern", kollar: { TITLE_STYLE_A: "object-that / two-beat story title", TITLE_STYLE_B: "why/how question title" },
    hipotez: "Story-shaped titles (\"The Bridge That…\") earn more Shorts-feed views per video than question titles at 7 days.", metrik: "views_7d" },
  { id: "thumbnail-text", degisken: "thumbnail text", kollar: { THUMBNAIL_TEXT: "2-4 word text", NO_THUMBNAIL_TEXT: "frame only" },
    hipotez: "For long-form, a 2-4 word thumbnail text raises CTR versus a text-free frame.", metrik: "ctr" },
  { id: "cold-open", degisken: "cold open", kollar: { COLD_OPEN_EVENT: "opens on the failure itself", COLD_OPEN_QUESTION: "opens on a question" },
    hipotez: "Opening on the event keeps more viewers at 30 s than opening on a question.", metrik: "first30sRetention" },
  { id: "length", degisken: "long-form length", kollar: { "8_MIN_VIDEO": "~8 minutes", "12_MIN_VIDEO": "~12 minutes" },
    hipotez: "12-minute documentaries earn more watch time per impression without losing average % viewed.", metrik: "watchTimeMinutes" },
  { id: "cta-position", degisken: "CTA position", kollar: { CTA_MID: "contextual CTA after the technical payoff", CTA_END: "CTA near the end" },
    hipotez: "A mid-video contextual CTA converts more subscribers per 1,000 views than an end CTA.", metrik: "subsPer1000" },
];

const oku = () => jsonOku(DOSYA, null) || { olusturuldu: new Date().toISOString(), deneyler: SABLON.map((s) => ({ ...s, durum: "planned", baslangic: null, videolar: [], sonuc: null })) };
const yaz = (d) => jsonYaz(DOSYA, d);

function metrik(videoId, ad) {
  const dir = path.join(KOK, "analytics", videoId);
  const o = jsonOku(path.join(dir, "7d.json"), null) || (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => jsonOku(path.join(dir, f), null)).filter(Boolean).pop() : null);
  if (!o) return null;
  if (ad === "views_7d") return o.metrikler.views.deger;
  if (ad === "subsPer1000") return o.turetilmis.subsPer1000.deger;
  const m = o.metrikler[ad];
  return m && m.durum === "ok" ? m.deger : null;
}

const ort = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const vary = (a) => { const m = ort(a); return a.reduce((x, y) => x + (y - m) ** 2, 0) / Math.max(1, a.length - 1); };

function degerlendir(d) {
  const kollar = {};
  for (const k of Object.keys(d.kollar)) {
    const deg = d.videolar.filter((v) => v.kol === k).map((v) => metrik(v.videoId, d.metrik)).filter((x) => x != null);
    kollar[k] = { n: deg.length, ortalama: deg.length ? Math.round(ort(deg) * 100) / 100 : null, degerler: deg };
  }
  const l = Object.values(kollar);
  let guven = "insufficient data", sonuc;
  if (l.some((k) => k.n < MIN_KOL)) {
    sonuc = `Not enough videos per arm (need ≥${MIN_KOL}; have ${Object.entries(kollar).map(([k, v]) => k + "=" + v.n).join(", ")}). No conclusion — and no causal claim.`;
  } else {
    const [a, b] = l;
    const se = Math.sqrt(vary(a.degerler) / a.n + vary(b.degerler) / b.n) || 1e-9;
    const t = Math.abs(a.ortalama - b.ortalama) / se;
    guven = t >= 2.5 ? "moderate" : t >= 1.5 ? "low" : "none";
    const [ka, kb] = Object.keys(kollar);
    const ustun = a.ortalama >= b.ortalama ? ka : kb;
    sonuc = guven === "none" ? "No meaningful difference between arms at this sample size."
      : `${ustun} is ahead on ${d.metrik} (Welch t≈${t.toFixed(1)}). Correlational only: topics and timing differ between videos, so this is consistent with — not proof of — the hypothesis.`;
  }
  return { kollar, sonuc, guven, tarih: new Date().toISOString() };
}

function rapor(veri) {
  const s = ["# Growth experiments", "", `Rules: one variable per experiment · ≥${MIN_KOL} videos per arm before reading results · correlation is not causation · never re-upload to reset an experiment.`, ""];
  for (const d of veri.deneyler) {
    s.push(`## ${d.id} — ${d.durum}`, "", `Hypothesis: ${d.hipotez}`, `Variable: ${d.degisken} · metric: \`${d.metrik}\` · start: ${d.baslangic || "—"}`, "",
      "| Arm | Meaning | Videos |", "|---|---|---|", ...Object.entries(d.kollar).map(([k, a]) => `| ${k} | ${a} | ${d.videolar.filter((v) => v.kol === k).map((v) => v.videoId).join(", ") || "—"} |`), "");
    if (d.sonuc) s.push(`Result (${d.sonuc.guven} confidence): ${d.sonuc.sonuc}`, "");
  }
  return s.join("\n");
}

function main() {
  const [komut, a, b, c] = process.argv.slice(2);
  const veri = oku();
  const bul = (id) => { const d = veri.deneyler.find((x) => x.id === id); if (!d) throw new Error("deney yok: " + id); return d; };
  if (komut === "ekle") {
    const d = bul(a);
    if (!videoIdGecerli(b) || !d.kollar[c]) throw new Error("Kullanim: ekle <deney> <videoId> <" + Object.keys(d.kollar).join("|") + ">");
    d.videolar = d.videolar.filter((v) => v.videoId !== b).concat({ videoId: b, kol: c, eklendi: bugun() });
    if (d.durum === "planned") { d.durum = "running"; d.baslangic = d.baslangic || bugun(); }
  } else if (komut === "baslat") { const d = bul(a); d.durum = "running"; d.baslangic = bugun(); }
  else if (komut === "degerlendir") { for (const d of veri.deneyler.filter((x) => !a || x.id === a)) if (d.videolar.length) d.sonuc = degerlendir(d); }
  yaz(veri);
  metinYaz(path.join(KOK, "experiments", "EXPERIMENTS.md"), rapor(veri));
  for (const d of veri.deneyler) console.log(`${d.id.padEnd(16)} ${d.durum.padEnd(8)} ${d.videolar.length} video  ${d.sonuc ? d.sonuc.guven : ""}`);
}

// Yuklemede otomatik kayit: basligin kalibina gore title-style deneyinin koluna eklenir
// (deney kaydi yuklemeyi asla engellemez).
function otomatikAta(videoId, baslik) {
  const k = require("./title-engine").kalip(baslik);
  const kol = ["the-x-that", "two-beat", "label-colon", "statement", "real-reason"].includes(k) ? "TITLE_STYLE_A"
    : ["why", "how", "what", "what-really", "physics-of"].includes(k) ? "TITLE_STYLE_B" : null;
  if (!kol || !videoIdGecerli(videoId)) return null;
  const veri = oku();
  const d = veri.deneyler.find((x) => x.id === "title-style");
  if (!d || d.videolar.some((v) => v.videoId === videoId)) return null;
  d.videolar.push({ videoId, kol, eklendi: bugun(), otomatik: true, kalip: k });
  if (d.durum === "planned") { d.durum = "running"; d.baslangic = bugun(); }
  yaz(veri);
  metinYaz(path.join(KOK, "experiments", "EXPERIMENTS.md"), rapor(veri));
  return kol;
}

module.exports = { degerlendir, otomatikAta, SABLON, MIN_KOL };

if (require.main === module) { try { main(); } catch (e) { console.error("Hata: " + e.message); process.exit(1); } }
