// KONU PUAN — Failure Reconstructed icin konu secimi (topic scoring).
//
// Yalnizca yuksek hacimli anahtar kelimeyi secmez. Hem MUHENDISLIK DERINLIGI hem
// GENIS KITLE MERAKI olan konular one cikar. 11 olcut (her biri 0-10):
//   search demand · recent momentum · competition · evergreen value ·
//   archival material availability · engineering depth · general audience appeal ·
//   visual potential · title potential · thumbnail potential · similar channel performance
//
// Ucretsiz, anahtarsiz sinyaller: Wikipedia sayfa goruntulenmeleri (ilgi + ivme),
// Wikipedia tam metni (farkli muhendislik terimleri), Wikimedia Commons / NASA / archive.org
// arama sayilari (arsiv & gorsel). YouTube arama (talep, rekabet, benzer kanal
// performansi) YouTube kimligi varsa kullanilir (search.list = 100 kota birimi).
// Erisilemeyen sinyal "unavailable" yazilir ve puan kalan sinyallerle normalize
// edilir; guven (confidence) = mevcut sinyal orani.
//
// Kullanim:
//   node konu-puan.js "Challenger disaster" [--wiki Space_Shuttle_Challenger_disaster]
//   node konu-puan.js --adaylar      icerik/aday-konular.json -> icerik/aday-konular-puan.md
"use strict";
const https = require("https");
const path = require("path");
const { KOK, jsonOku, jsonYaz, metinYaz, sinirla, yuvarla } = require("./lib/ortak");

const UA = "FailureReconstructedBot/1.0 (+https://github.com/eyazan/youtube-otomasyon)";
function getJSON(url, basliklar = {}) {
  return new Promise((coz) => {
    const r = https.get(url, { headers: { "User-Agent": UA, Accept: "application/json", "Accept-Encoding": "identity", ...basliklar }, timeout: 20000 }, (res) => {
      const p = []; res.on("data", (d) => p.push(d));
      res.on("end", () => { try { coz(res.statusCode === 200 ? JSON.parse(Buffer.concat(p).toString("utf8")) : null); } catch (e) { coz(null); } });
    });
    r.on("timeout", () => { r.destroy(); coz(null); });
    r.on("error", () => coz(null));
  });
}

const MUH = /\b(engineer\w*|design\w*|structur\w*|load|stress|fatigue|pressure|failure|fracture|weld\w*|corrosion|reactor|coolant|valve|o-rings?|seals?|turbine|flutter|resonance|vibration|collapse|investigation|ntsb|defect|temperature|combustion|explosion|safety|regulat\w*|inspection|crack\w*|beam|girder|foundation|bolt\w*|rod|tank|hull|sensor|software|redundan\w*|tolerance|specification|material|steel|concrete|alloy|insulation|thermal|hydraulic|pump|pipe|cooling|meltdown|breach|overload|buckl\w*|shear|tensile|torsion|aerodynamic|stall|fuel|oxidizer|joint|weld)\b/gi;

const log10 = (x) => Math.log10(Math.max(1, x));

// Sinyal toplama (fetch enjekte edilebilir — testlerde sahte veri)
async function sinyaller(konu, ops = {}, get = getJSON) {
  const s = {};
  let wiki = ops.wiki || null;
  if (!wiki) {
    const os = await get("https://en.wikipedia.org/w/api.php?action=opensearch&limit=1&namespace=0&format=json&search=" + encodeURIComponent(konu));
    wiki = os && os[3] && os[3][0] ? decodeURIComponent(os[3][0].split("/wiki/")[1] || "") : null;
  }
  s.wiki = wiki;
  if (wiki) {
    const bit = new Date(); bit.setUTCDate(1);
    const bas = new Date(bit); bas.setUTCFullYear(bas.getUTCFullYear() - 1);
    const f = (d) => d.toISOString().slice(0, 10).replace(/-/g, "");
    const pv = await get(`https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(wiki)}/monthly/${f(bas)}/${f(bit)}`);
    const aylar = pv && pv.items ? pv.items.map((i) => i.views) : null;
    if (aylar && aylar.length >= 3) {
      const ort = aylar.reduce((a, b) => a + b, 0) / aylar.length;
      const son = aylar[aylar.length - 1];
      const sd = Math.sqrt(aylar.reduce((a, b) => a + (b - ort) ** 2, 0) / aylar.length);
      s.pageviews = { aylikOrtalama: Math.round(ort), sonAy: son, ivme: yuvarla(son / Math.max(1, ort)), degiskenlik: yuvarla(sd / Math.max(1, ort)) };
    }
    // Tam makale metni: kisa ozet muhendislik derinligini olcmeye yetmiyor (Challenger
    // ozeti O-ring'den bahsetmeyebilir). FARKLI muhendislik terimi sayisi kullanilir.
    const ex = await get("https://en.wikipedia.org/w/api.php?action=query&prop=extracts&explaintext=1&format=json&redirects=1&titles=" + encodeURIComponent(wiki));
    const metin = ex && ex.query ? (Object.values(ex.query.pages)[0] || {}).extract || "" : "";
    if (metin) {
      const farkli = new Set((metin.match(MUH) || []).map((w) => w.toLowerCase().replace(/(s|ed|ing|al)$/, "")));
      s.ozet = { muhendislikTerimi: farkli.size, uzunluk: metin.length,
        yil: +((metin.slice(0, 1500).match(/\b(1[89]\d\d|20[0-2]\d)\b/) || [])[1] || 0) || null };
    }
  }
  const c = async (ft) => {
    const d = await get("https://commons.wikimedia.org/w/api.php?action=query&list=search&srnamespace=6&srinfo=totalhits&srlimit=1&format=json&srsearch=" + encodeURIComponent(konu + " filetype:" + ft));
    return d && d.query && d.query.searchinfo ? d.query.searchinfo.totalhits : null;
  };
  s.commonsVideo = await c("video");
  s.commonsGorsel = await c("bitmap");
  const n = await get("https://images-api.nasa.gov/search?media_type=image,video&q=" + encodeURIComponent(konu));
  s.nasa = n && n.collection && n.collection.metadata ? n.collection.metadata.total_hits : null;
  const ar = await get("https://archive.org/advancedsearch.php?rows=0&output=json&q=" + encodeURIComponent(`(${konu}) AND mediatype:(movies)`));
  s.archiveOrg = ar && ar.response ? ar.response.numFound : null;
  if (ops.youtube) s.youtube = await ops.youtube(konu);
  return s;
}

// YouTube arama sinyali (kimlik varsa): ilk 10 sonucun izlenme ortancasi + tazelik
async function youtubeSinyal(konu) {
  const yt = require("./lib/yt");
  if (!yt.kimlikVar()) return null;
  try {
    const api = yt.istemci(await yt.token());
    const r = await api.data("search?part=snippet&type=video&maxResults=10&relevanceLanguage=en&q=" + encodeURIComponent(konu));
    if (!r.ok) return null;
    const ids = (r.veri.items || []).map((i) => i.id.videoId);
    const v = await yt.videolar(api, ids);
    const g = v.map((x) => +x.statistics.viewCount || 0).sort((a, b) => a - b);
    const yeni = v.filter((x) => Date.now() - Date.parse(x.snippet.publishedAt) < 365 * 86400000).length;
    return { top10MedyanIzlenme: g[Math.floor(g.length / 2)] || 0, sonYilVideo: yeni, toplamSonuc: r.veri.pageInfo ? r.veri.pageInfo.totalResults : null, kanalSayisi: new Set(v.map((x) => x.snippet.channelId)).size };
  } catch (e) { return null; }
}

function puanla(s, aday = {}) {
  const p = {}, yok = [];
  const koy = (k, deger) => { if (deger == null || Number.isNaN(deger)) { p[k] = null; yok.push(k); } else p[k] = yuvarla(sinirla(deger, 0, 10), 1); };
  const yt = s.youtube;
  koy("searchDemand", yt ? (log10(yt.top10MedyanIzlenme) - 3) * 2.2 : null);                   // 1k -> 0, 100k -> 4.4, 10M -> 8.8
  koy("recentMomentum", s.pageviews ? 5 + (s.pageviews.ivme - 1) * 6 : null);                  // son ay / 12 ay ortalamasi
  koy("competition", yt ? 10 - yt.sonYilVideo * 1.2 : null);                                    // yuksek = az yeni rakip (iyi)
  const yas = s.ozet && s.ozet.yil ? new Date().getUTCFullYear() - s.ozet.yil : null;
  koy("evergreenValue", s.pageviews ? 10 - s.pageviews.degiskenlik * 10 + (yas && yas > 10 ? 1 : 0) : (yas ? (yas > 10 ? 8 : 5) : null));
  const arsiv = [s.commonsVideo, s.nasa, s.archiveOrg].filter((x) => x != null);
  koy("archivalAvailability", arsiv.length ? log10((s.commonsVideo || 0) * 5 + (s.nasa || 0) + (s.archiveOrg || 0)) * 3.3 : null);
  koy("engineeringDepth", aday.muhendislik != null ? aday.muhendislik : s.ozet ? s.ozet.muhendislikTerimi * 0.42 : null);   // ~24 farkli terim = 10
  koy("audienceAppeal", s.pageviews ? (log10(s.pageviews.aylikOrtalama) - 2) * 3.3 : null);    // 100/ay -> 0, 100k/ay -> 10
  koy("visualPotential", s.commonsGorsel != null ? log10((s.commonsGorsel || 0) + (s.commonsVideo || 0) * 10) * 3 : null);
  koy("titlePotential", aday.baslikPuani != null ? aday.baslikPuani / 10 : (s.ozet ? 5 + (s.ozet.yil ? 1 : 0) + (/\d/.test(aday.ad || "") ? 1 : 0) : null));
  koy("thumbnailPotential", s.commonsGorsel != null ? Math.min(10, log10(s.commonsGorsel + 1) * 3 + (aday.sayi ? 2 : 0)) : null);
  koy("similarChannelPerformance", yt ? (log10(yt.top10MedyanIzlenme) - 3) * 2 + (yt.kanalSayisi >= 7 ? 1 : 0) : null);
  const A = { searchDemand: 1, recentMomentum: 0.6, competition: 0.7, evergreenValue: 1, archivalAvailability: 1.2, engineeringDepth: 1.4,
    audienceAppeal: 1.3, visualPotential: 1, titlePotential: 0.7, thumbnailPotential: 0.7, similarChannelPerformance: 0.8 };
  let t = 0, w = 0;
  for (const [k, a] of Object.entries(A)) if (p[k] != null) { t += p[k] * a; w += a; }
  const toplam = w ? Math.round(t / w * 10) : null;
  const guven = yuvarla(1 - yok.length / Object.keys(A).length);
  const oncelik = p.engineeringDepth >= 6 && p.audienceAppeal >= 6 ? "PRIORITY (engineering depth + mass curiosity)"
    : p.engineeringDepth != null && p.engineeringDepth < 4 ? "weak engineering angle" : p.audienceAppeal != null && p.audienceAppeal < 4 ? "niche audience" : "normal";
  return { puan: toplam, guven, oncelik, olcutler: p, unavailable: yok };
}

async function konuPuanla(konu, ops = {}) {
  const s = await sinyaller(konu, { wiki: ops.wiki, youtube: ops.youtube === false ? null : youtubeSinyal });
  return { konu, ...puanla(s, ops.aday || {}), sinyaller: s, tarih: new Date().toISOString() };
}

// Markdown bolumu (trend-ara.js / viral-analiz.js raporlarina eklenir)
function mdBolum(r) {
  const s = ["## Failure Reconstructed topic score", "",
    `**${r.konu}** — ${r.puan ?? "n/a"}/100 · ${r.oncelik} · confidence ${Math.round(r.guven * 100)}%` + (r.sinyaller.wiki ? ` · Wikipedia: ${r.sinyaller.wiki}` : ""), "",
    "| Criterion | Score /10 |", "|---|---:|"];
  for (const [k, v] of Object.entries(r.olcutler)) s.push(`| ${k} | ${v == null ? "unavailable" : v} |`);
  s.push("", "_Signals: Wikipedia pageviews/summary, Wikimedia Commons, NASA, archive.org" + (r.sinyaller.youtube ? ", YouTube search" : " (YouTube search unavailable)") + ". Scores guide selection; they are not predictions._", "");
  return s.join("\n");
}

async function adaylariPuanla() {
  const dosya = path.join(KOK, "icerik", "aday-konular.json");
  const l = jsonOku(dosya, []);
  const out = [];
  for (const a of l) {
    const r = await konuPuanla(a.ad, { wiki: a.wiki, aday: a });
    out.push(r);
    console.log(`${String(r.puan).padStart(4)}  ${r.oncelik.padEnd(44)} ${a.ad}`);
  }
  out.sort((a, b) => (b.puan || 0) - (a.puan || 0));
  jsonYaz(path.join(KOK, "icerik", "aday-konular-puan.json"), out);
  const s = ["# Candidate topics — scored", "", `Generated ${new Date().toISOString().slice(0, 10)} by \`node konu-puan.js --adaylar\`. PRIORITY = engineering depth ≥6 AND audience appeal ≥6.`, "",
    "| Rank | Topic | Score | Priority | Confidence | Depth | Appeal | Archive | Momentum | Demand |", "|---:|---|---:|---|---:|---:|---:|---:|---:|---:|"];
  out.forEach((r, i) => { const o = r.olcutler; const f = (x) => x == null ? "—" : x;
    s.push(`| ${i + 1} | ${r.konu} | ${r.puan ?? "—"} | ${r.oncelik} | ${Math.round(r.guven * 100)}% | ${f(o.engineeringDepth)} | ${f(o.audienceAppeal)} | ${f(o.archivalAvailability)} | ${f(o.recentMomentum)} | ${f(o.searchDemand)} |`); });
  metinYaz(path.join(KOK, "icerik", "aday-konular-puan.md"), s.join("\n"));
  return out;
}

module.exports = { sinyaller, puanla, konuPuanla, mdBolum, adaylariPuanla };

if (require.main === module) {
  const argv = process.argv.slice(2);
  (async () => {
    if (argv[0] === "--adaylar") return adaylariPuanla();
    const konu = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--wiki");
    if (!konu) { console.error('Kullanim: node konu-puan.js "<konu>" [--wiki Baslik] | --adaylar'); process.exit(1); }
    const i = argv.indexOf("--wiki");
    console.log(mdBolum(await konuPuanla(konu, { wiki: i >= 0 ? argv[i + 1] : null })));
  })().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
}
