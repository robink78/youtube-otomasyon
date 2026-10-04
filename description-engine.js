// DESCRIPTION ENGINE — anahtar kelime yigini olmayan belgesel aciklamasi.
//
//   2-3 cumlelik ozet · arizanin zinciri · goruntu kaynaklari (lisansli) ·
//   ilgili Failure Reconstructed bolumu · seri/playlist · teknik kaynaklar ·
//   bolum zaman damgalari (uzun format) · sentetik ses aciklamasi · en fazla 3 hashtag
//
// Etiketler: yalnizca konuyla ilgili, tekrar yok, <=12 adet, <=400 karakter.
//
// Kullanim: node description-engine.js <slug>   ->  icerik/paket/<slug>/description.txt (+ tags.json)
"use strict";
const fs = require("fs");
const path = require("path");
const { KOK, jsonOku, jsonYaz, metinYaz } = require("./lib/ortak");
const { ayar } = require("./lib/ayar");
const K = require("./lib/kutuphane");
const Hashtags = require("./core/hashtags");

const HASHTAG = { "bridge-failures": "#bridges", "structural-failures": "#structuralengineering", "aviation-failures": "#aviation",
  "spaceflight-disasters": "#spaceflight", "maritime-disasters": "#maritime", "nuclear-accidents": "#nuclear",
  "fire-and-explosions": "#firesafety", "industrial-disasters": "#industrial", "infrastructure-failures": "#infrastructure",
  "materials-failures": "#materials", "natural-hazards": "#disaster", "rail-disasters": "#railways", "software-and-control-failures": "#software" };

const zaman = (s) => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

// Goruntu kaynaklari: konu.kaynaklar (arsiv) + uretimdeki GORSEL-KAYNAKLARI.txt + kaynak defteri
function goruntuKaynaklari(konu) {
  const l = [];
  for (const k of konu.kaynaklar || []) {
    if (k.wikimedia) l.push(`Archival film: "${k.wikimedia.replace(/\.(ogv|webm|mp4)$/i, "")}" — Wikimedia Commons (public domain / free licence): https://commons.wikimedia.org/wiki/File:${encodeURIComponent(k.wikimedia.replace(/ /g, "_"))}`);
    else if (k.archive) l.push(`Archival film: Internet Archive — https://archive.org/details/${k.archive}`);
    else if (k.url) l.push(`Footage: ${k.url}`);
  }
  // Kaynak defterinden: arsiv satirlari konu.kaynaklar'dan zaten yazildi (tekrar yok);
  // stok klipler tek satirda ozetlenir (Pexels atif zorunlu tutmaz; tam liste depoda
  // GORSEL-KAYNAKLARI.txt ve kaynak-defteri.json'da kalir).
  const d = K.defter()[konu.slug];
  const krediler = d && Array.isArray(d.krediler) ? d.krediler : [];
  if (!l.length) for (const c of krediler) if (/^Archival film:/.test(c) && !l.includes(c)) l.push(c);
  const yazarlar = [...new Set(krediler.map((c) => (c.match(/^Stock footage: Pexels \/ (.+?) \(Pexels License\)/) || [])[1]).filter(Boolean)
    .map((x) => x.replace(/[^\p{L}\p{N} .'-]/gu, "").trim()).filter(Boolean))];
  if (yazarlar.length) l.push(`Stock footage: Pexels (Pexels License) — clips by ${yazarlar.slice(0, 6).join(", ")}` +
    (yazarlar.length > 6 ? ` and ${yazarlar.length - 6} more` : "") + " — https://www.pexels.com/license/");
  const dosya = path.join(KOK, "uretim", konu.slug, "GORSEL-KAYNAKLARI.txt");
  if (!l.length && fs.existsSync(dosya)) {
    for (const satir of fs.readFileSync(dosya, "utf8").split(/\r?\n/).filter(Boolean).slice(0, 12)) l.push(satir.replace(/^\S+\s+—\s+/, ""));
  }
  if (konu.tur === "stok" && !l.some((x) => /pexels/i.test(x))) l.push("Stock footage: Pexels (Pexels License) — https://www.pexels.com/license/");
  return [...new Set(l)];
}

function ozet(konu) {
  const v = konu.vaka || {};
  const ham = String(konu.aciklama || "").replace(/#\w+/g, "").trim().split(/\n\s*\n/)[0] || "";
  const cumleler = ham.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2);
  if (v.mekanizma && !ham.toLowerCase().includes(v.mekanizma.toLowerCase().split(" ")[0]))
    cumleler.push(`The failure mechanism: ${v.mekanizma}.`);
  return cumleler.slice(0, 3).join(" ");
}

function etiketler(konu) {
  const v = konu.vaka || {};
  const kume = K.KUMELER[K.kumeBul(konu)];
  // YouTube etiketi virgul/<> iceremez (virgul etiketi boler, yukleme reddedilir); mekanizma
  // cumlesinin yalnizca ilk bolumu alinir ve cok uzun etiketler atlanir.
  const aday = [...(konu.etiketler || []), v.kisa, v.mekanizma && v.mekanizma.replace(/\s*\(.*\)/, "").split(/[,;:]/)[0], kume && kume.ad.toLowerCase(),
    "engineering failure", "forensic engineering"].filter(Boolean).map((x) => String(x).replace(/[,<>"]/g, " ").replace(/\s+/g, " ").trim())
    .filter((x) => x && x.length <= 60);
  const out = []; let uz = 0;
  for (const t of aday) {
    const k = t.toLowerCase();
    if (out.some((o) => o.toLowerCase() === k) || /^(shorts|viral|fyp|trending)$/.test(k)) continue;   // alakasiz/spam etiket yok
    if (out.length >= 12 || uz + t.length > 400) break;
    out.push(t); uz += t.length + 1;
  }
  return out;
}

function olustur(konu, ops = {}) {
  const a = ayar();
  const v = konu.vaka || {};
  const format = ops.format || K.formatBul(konu);
  const kumeId = K.kumeBul(konu);
  const plan = ops.plan || require("./channel-plan").kur();
  const b = require("./channel-plan").baglanti(plan, konu.slug) || {};
  const bl = [];
  bl.push(ozet(konu));
  if (Array.isArray(v.zincir) && v.zincir.length >= 3) {
    // Cumle bicimi; rakamli kelimeler (M7.9, B-25s) ve metinde buyuk harfle gecen ozel isimler korunur
    // Ozel isimler: vaka adindaki kelimeler + anlatida CUMLE ORTASINDA buyuk harfle
    // gecenler (cumle basindaki "Snow falls..." ozel isim sayilmaz).
    const ozel = new Set([...String(v.ad || "").split(/\s+/), ...String(v.kisa || "").split(/\s+/)]
      .filter((w) => /^[A-Z][a-z]/.test(w) && w !== "The"));
    for (const m of K.anlati(konu).matchAll(/[a-z,;] ([A-Z][a-z]+)/g)) ozel.add(m[1]);
    // Telaffuz sozlugundeki yer/arac/sirket adlari da ozel isimdir (Mont-Blanc, Imo...)
    const sozluk = require("./pronunciation-check").sozluk().terms || {};
    for (const [t, x] of Object.entries(sozluk)) if (["place", "vehicle", "company"].includes(x.type)) ozel.add(t);
    const ozelMap = new Map([...ozel].map((w) => [w.toLowerCase(), w]));
    const kelime = (w, i) => /\d/.test(w) ? w.replace(/[A-Z]{3,}/g, (m) => m.toLowerCase())
      : ozelMap.has(w.toLowerCase()) && i > 0 ? ozelMap.get(w.toLowerCase())
      : i === 0 ? w.charAt(0) + w.slice(1).toLowerCase() : w.toLowerCase();
    bl.push("Failure chain: " + v.zincir.map((x) => x.split(" ").map(kelime).join(" ")).join(" → "));
  }
  const ilgili = b.aciklamaVideo && b.aciklamaVideo.url ? b.aciklamaVideo : null;
  // Ayni kumedense "Related episode", degilse kanalin baska bir yeniden kurgusu
  const ayniKume = ilgili && [b.onceki, b.sonraki].some((x) => x && x.slug === ilgili.slug);
  if (ilgili) bl.push(`${ayniKume ? "Related episode" : "Another reconstruction"}: ${ilgili.baslik} — ${ilgili.url}`);
  if (b.playlist && b.playlist.id) bl.push(`Series — ${b.playlist.ad}: https://www.youtube.com/playlist?list=${b.playlist.id}`);
  const kaynak = goruntuKaynaklari(konu);
  if (kaynak.length) bl.push("Footage & sources:\n" + kaynak.map((x) => "• " + x).join("\n"));
  if (Array.isArray(v.kaynakca) && v.kaynakca.length) bl.push("Technical references:\n" + v.kaynakca.map((r) => `• ${r.ad} — ${r.url}`).join("\n"));
  const bolumler = ops.bolumler || jsonOku(path.join(KOK, "uretim", konu.slug, "Videos", "bolumler.json"), null);
  if (format === "long" && Array.isArray(bolumler) && bolumler.length >= 3 && bolumler[0].t === 0)
    bl.push("Chapters:\n" + bolumler.map((c) => `${zaman(c.t)} ${c.baslik}`).join("\n"));
  if (a.disclosure.descriptionNote && a.disclosure.voiceNote) bl.push(a.disclosure.voiceNote);
  const seri = require("./core/series").descriptionLine(require("./core/channel-context").getChannel("failure-reconstructed"), konu.slug);
  if (seri) bl.push(seri);
  // En fazla 5 hashtag: #shorts + genis kanal etiketi + vakanin kendi adi (#VanNormanDam)
  // + kume + ikinci genis etiket. Ilk ucu basligin ustunde gorunur.
  const konuEtiketi = Hashtags.subjectHashtag({ names: [v.kisa, v.ad], references: v.kaynakca || [] });
  bl.push(Hashtags.compose({ format, subject: konuEtiketi, category: HASHTAG[kumeId] || "#disaster",
    broad: Hashtags.BROAD["failure-reconstructed"] }).join(" "));
  const metin = bl.filter(Boolean).join("\n\n").replace(/[<>]/g, "");
  return { metin: metin.slice(0, 4900), etiketler: etiketler(konu) };
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const r = olustur(konu);
  metinYaz(K.paketYolu(slug, "description.txt"), r.metin);
  jsonYaz(K.paketYolu(slug, "tags.json"), r.etiketler);
  return r;
}

module.exports = { olustur, calistir, etiketler, goruntuKaynaklari, zaman };

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) { console.error("Kullanim: node description-engine.js <slug>"); process.exit(1); }
  const r = calistir(slug);
  console.log(r.metin + "\n\nTAGS: " + r.etiketler.join(", "));
}
