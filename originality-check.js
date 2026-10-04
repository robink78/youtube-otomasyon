// ORIGINALITY CHECK — yeni videoyu onceki Failure Reconstructed uretimleriyle karsilastirir.
//
// Amac: editoryal cesitlilik ve ozgunluk — tespit sistemlerini atlatmak DEGIL.
// Olculenler (0..1, yuksek = daha benzer):
//   title · hook · structure (sahne rol dizisi) · sentences (yakin-kopya cumle orani) ·
//   scenes (sahne arama/kaynak dizisi) · visualReuse (baska videoda kullanilmis goruntu orani) ·
//   thumbnail (kapak duzeni+metni) · cta (ekrandaki soru) · description · music (muzik profili)
// Cikti: ORIGINALITY /100 + ACTION: PASS | REVIEW | BLOCK
//
// Kullanim: node originality-check.js <slug> | --all   ->  icerik/paket/<slug>/originality.json
"use strict";
const { jsonOku, jsonYaz, yuvarla, sinirla } = require("./lib/ortak");
const { ayar } = require("./lib/ayar");
const M = require("./lib/metin");
const K = require("./lib/kutuphane");
const muzik = require("./lib/muzik");
const pacing = require("./scene-pacing");

// Taban: ayni kanaldaki ALAKASIZ iki video arasindaki olagan benzerlik (ayni dil,
// ayni marka). Puan, benzerligin bu tabanin ne kadar USTUNE ciktigini olcer;
// esige (reviewAt) yaklastikca puan duser.
const TABAN = { title: 0.3, hook: 0.3, structure: 0.6, sentences: 0.05, scenes: 0.3, visualReuse: 0, thumbnail: 0.3, cta: 0.3, description: 0.3, music: 0.6 };
const AGIRLIK = { title: 0.12, hook: 0.12, structure: 0.10, sentences: 0.18, scenes: 0.08, visualReuse: 0.15, thumbnail: 0.07, cta: 0.06, description: 0.07, music: 0.05 };

// Bir uretimin karsilastirilabilir ozeti
function iz(konu) {
  const slug = konu.slug;
  const titles = jsonOku(K.paketYolu(slug, "titles.json"), null);
  const thumbs = jsonOku(K.paketYolu(slug, "thumbnails.json"), null);
  const yay = K.yayinBul(slug);
  const d = K.defter()[slug] || {};
  const anlati = K.anlati(konu);
  const c = M.cumleler(anlati);
  const kapak = thumbs && thumbs.konseptler && (thumbs.konseptler.find((c) => c.id === thumbs.birincil) || thumbs.konseptler[0]);
  return {
    slug,
    title: (yay && yay.baslik) || (titles && titles.secilen) || konu.baslik || "",
    hook: [konu.hook, c[0]].filter(Boolean).join(" | "),
    structure: pacing.planKisa(konu, null).map((p) => p.rol),
    sentences: c,
    scenes: (konu.sahneler || []).map((s) => (s.arama || s.kaynak || "").toLowerCase().split(/\s+/).slice(0, 2).join(" ")),
    visuals: d.kaynakKimlikleri || (konu.kaynaklar || []).map((k) => k.wikimedia || k.archive || k.url).filter(Boolean),
    thumbnail: kapak ? { duzen: kapak.duzen, metin: kapak.metin || "" } : null,
    cta: konu.soru || "",
    description: String(konu.aciklama || "").replace(/#\w+/g, ""),
    music: d.muzik || muzik.profil(slug, K.kumeBul(konu)),
  };
}

function karsilastir(yeni, digerleri) {
  const enYuksek = (f) => { let m = 0, kim = null; for (const o of digerleri) { const s = f(o); if (s > m) { m = s; kim = o.slug; } } return { deger: yuvarla(m), kim }; };
  const r = {};
  r.title = enYuksek((o) => Math.max(M.trigramBenzerlik(yeni.title, o.title), M.kelimeBenzerlik(yeni.title, o.title)));
  r.hook = enYuksek((o) => M.trigramBenzerlik(yeni.hook, o.hook));
  r.structure = enYuksek((o) => M.diziBenzerlik(yeni.structure, o.structure));
  // Yakin-kopya cumle orani: baska bir uretimde >=0.6 kelime benzerligi olan cumlelerin payi
  const tumCumle = digerleri.flatMap((o) => o.sentences.map((s) => ({ s, slug: o.slug })));
  const kopya = yeni.sentences.map((s) => {
    let m = 0, kim = null; for (const o of tumCumle) { const b = M.kelimeBenzerlik(s, o.s); if (b > m) { m = b; kim = o.slug; } }
    return { cumle: s, benzerlik: yuvarla(m), kim };
  }).filter((x) => x.benzerlik >= 0.6);
  r.sentences = { deger: yuvarla(yeni.sentences.length ? kopya.length / yeni.sentences.length : 0), ornekler: kopya.slice(0, 5) };
  r.scenes = enYuksek((o) => o.scenes.length && yeni.scenes.length ? M.diziBenzerlik(yeni.scenes, o.scenes) : 0);
  const baskaGorsel = new Set(digerleri.flatMap((o) => o.visuals));
  const reuse = yeni.visuals.filter((x) => baskaGorsel.has(x));
  r.visualReuse = { deger: yuvarla(yeni.visuals.length ? reuse.length / yeni.visuals.length : 0), tekrar: reuse.slice(0, 10) };
  // Kapak: ayni duzen (yarim puan) + metin benzerligi (yarim puan)
  r.thumbnail = enYuksek((o) => o.thumbnail && yeni.thumbnail ? 0.5 * (o.thumbnail.duzen === yeni.thumbnail.duzen ? 1 : 0) +
    0.5 * (o.thumbnail.metin && yeni.thumbnail.metin ? M.trigramBenzerlik(yeni.thumbnail.metin, o.thumbnail.metin) : 0) : 0);
  r.cta = enYuksek((o) => o.cta && yeni.cta ? M.trigramBenzerlik(yeni.cta, o.cta) : 0);
  r.description = enYuksek((o) => M.kelimeBenzerlik(yeni.description, o.description));
  r.music = enYuksek((o) => muzik.benzerlik(yeni.music, o.music));
  return r;
}

// Karsilastirma evreni: yayinlananlar + zaten uretilmis konular (henuz
// uretilmemis kutuphane konulari birbirinin "tekrari" sayilmaz — yuzlerce
// konuluk bir kutuphanede sahne-rol dizileri kacinilmaz olarak cakisir).
// Izleyicinin algiladigi tekrar penceresi: yapi/hook/sahne dizisi son
// RECENT_WINDOW uretimle; baslik, cumle ve gorsel tekrari TUM uretimlerle.
const RECENT_WINDOW = 30;
function uretimEvreni() {
  const sirali = [];
  const ekle = (slug) => { if (slug && !sirali.includes(slug)) sirali.push(slug); };
  for (const y of K.yayinlananlar().slice().sort((a, b) => String(a.tarih || "").localeCompare(String(b.tarih || "")))) ekle(y.slug);
  for (const slug of jsonOku(K.YOL.uretildi, [])) ekle(typeof slug === "string" ? slug : slug && slug.slug);
  return sirali;
}

function degerlendir(konu, ops = {}) {
  const a = ayar().originality;
  let tum, yakin;
  if (ops.konular) { tum = ops.konular.filter((k) => k.slug !== konu.slug); yakin = tum; }
  else {
    const evren = uretimEvreni().filter((slug) => slug !== konu.slug);
    const bySlug = new Map(K.konular().map((k) => [k.slug, k]));
    tum = evren.map((slug) => bySlug.get(slug)).filter(Boolean);
    const son = new Set(evren.slice(-RECENT_WINDOW));
    yakin = tum.filter((k) => son.has(k.slug));
  }
  const yeni = iz(konu);
  const digerleri = tum.map(iz);
  const r = karsilastir(yeni, digerleri);
  // Yapi, hook ve sahne dizisi yalnizca yakin pencerede olculur.
  const rYakin = karsilastir(yeni, yakin.map(iz));
  for (const k of ["structure", "hook", "scenes", "thumbnail", "cta", "music"]) r[k] = rYakin[k];
  const fazla = Object.entries(AGIRLIK).reduce((t, [k, w]) => {
    const esik = a.reviewAt[k] || 0.9, taban = TABAN[k] || 0;
    return t + w * sinirla(((r[k].deger || 0) - taban) / Math.max(0.05, esik - taban), 0, 1.5);
  }, 0);
  const puan = Math.round(sinirla(100 * (1 - fazla)));
  const bayrak = [];
  for (const [k, esik] of Object.entries(a.reviewAt)) if ((r[k] || {}).deger >= esik) bayrak.push({ metrik: k, deger: r[k].deger, esik, kim: r[k].kim || null });
  const blok = Object.entries(a.blockAt).filter(([k, esik]) => (r[k] || {}).deger >= esik).map(([k]) => k);
  const aksiyon = blok.length ? "BLOCK" : bayrak.length ? "REVIEW" : "PASS";
  return { slug: konu.slug, olusturuldu: new Date().toISOString(), originality: puan, aksiyon, bayraklar: bayrak, engelleyen: blok, metrikler: r,
    ozet: Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/([A-Z])/g, "_$1").toUpperCase() + "_SIMILARITY", v.deger])),
    not: "Measures editorial repetition across this channel's own productions. It is not designed to, and must not be used to, evade platform detection." };
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const r = degerlendir(konu);
  jsonYaz(K.paketYolu(slug, "originality.json"), r);
  return r;
}

module.exports = { iz, karsilastir, degerlendir, calistir, AGIRLIK };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error("Kullanim: node originality-check.js <slug> | --all"); process.exit(1); }
  for (const s of arg === "--all" ? K.konular().map((k) => k.slug) : [arg]) {
    const r = calistir(s);
    const top = r.bayraklar.map((b) => `${b.metrik}=${b.deger}${b.kim ? "(" + b.kim + ")" : ""}`).join(" ");
    console.log(`${s.padEnd(30)} ${String(r.originality).padStart(3)}/100  ${r.aksiyon.padEnd(6)} ${top}`);
    if (arg !== "--all") console.log(JSON.stringify(r.ozet, null, 1));
  }
}
