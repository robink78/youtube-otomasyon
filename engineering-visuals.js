// ENGINEERING VISUALS — adli muhendislik gorsel katmani (tamamen yerel ffmpeg).
//
// Kanalin "stok goruntu slayt gosterisi" degil "muhendislik sorusturmasi" gibi
// gorunmesini saglayan tekrar eden marka ogeleri. Her biri vaka dosyasindaki
// (konu.vaka) GERCEK veriden cizilir; veri yoksa o gorsel uretilmez (uydurma yok).
//
//   failure-chain   NORMAL LOAD ↓ OSCILLATION ↓ ... ↓ STRUCTURAL FAILURE
//   timeline        tarihli olay dizisi
//   root-cause      kok neden + tetikleyici
//   myth-vs-evidence yaygin inanis / kanitin gosterdigi
//   key-number      tek carpici olcu (40 MPH, 34 SECONDS)
//   what-changed    olaydan sonra degisen muhendislik pratigi
//   critical-decision / warning-signs  (vaka.karar / vaka.uyarilar varsa)
//
// Ayni marka dili (mavi-kopya zemin, kehribar vurgu) ama duzen gorsele gore
// degisir — her bolum ayni sablonun kopyasi olmasin.
//
// Kullanim:
//   node engineering-visuals.js <slug>            uzun format: Visuals/<sahne>/eng-*.png
//   node engineering-visuals.js <slug> --onizle   icerik/paket/<slug>/visuals/ altina tum kartlar
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const { KOK, jsonYaz } = require("./lib/ortak");
const K = require("./lib/kutuphane");

const RENK = { zemin: "0x0B1522", izgara: "0x1C3350", kutu: "0x13243A", kenar: "0x3E6D9C", vurgu: "0xD9A441",
  kirmizi: "0xD9534F", kirmiziZemin: "0x3A1418", yazi: "0xF2F4F7", soluk: "0x9FB3C8" };

function fontYolu() {
  // drawtext fontfile icin kacisli yol (font-yol.js ile ayni kurallar)
  try { return require("./font-yol")(true); } catch (e) { return null; }
}

// Metni satirlara sar
function sar(metin, max) {
  const out = []; let cur = "";
  for (const w of String(metin).split(/\s+/)) {
    if ((cur + " " + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + " " + w).trim();
  }
  if (cur) out.push(cur);
  return out;
}

class Tuval {
  constructor(W, H, seffaf) { this.W = W; this.H = H; this.seffaf = seffaf; this.f = []; this.tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ev-")); this.n = 0; this.font = fontYolu(); }
  // Seffaf tuvalde drawbox alfa kanalini ancak replace=1 ile yazar (yoksa kutu gorunmez).
  kutu(x, y, w, h, renk, kalinlik = "fill") { this.f.push(`drawbox=x=${Math.round(x)}:y=${Math.round(y)}:w=${Math.round(w)}:h=${Math.round(h)}:color=${renk}:t=${kalinlik}${this.seffaf ? ":replace=1" : ""}`); }
  // yazi: textfile ile — kacis derdi yok (tirnak, iki nokta, yuzde)
  yazi(metin, x, y, boyut, renk, hiza = "sol") {
    const tf = path.join(this.tmp, `t${this.n++}.txt`);
    fs.writeFileSync(tf, String(metin));
    const xs = hiza === "orta" ? `(w-text_w)/2+${Math.round(x)}` : hiza === "sag" ? `${Math.round(x)}-text_w` : Math.round(x);
    this.f.push(`drawtext=${this.font ? `fontfile='${this.font}':` : ""}textfile='${tf}':x=${xs}:y=${Math.round(y)}:fontsize=${Math.round(boyut)}:fontcolor=${renk}`);
  }
  kaydet(cikti) {
    fs.mkdirSync(path.dirname(cikti), { recursive: true });
    const FF = require("./ff-yol").ffmpeg;
    const giris = this.seffaf ? `color=c=black@0.0:s=${this.W}x${this.H},format=rgba`
      : `color=c=${RENK.zemin}:s=${this.W}x${this.H}`;
    const zemin = this.seffaf ? [] : [`drawgrid=w=${Math.round(this.W / 24)}:h=${Math.round(this.W / 24)}:t=1:c=${RENK.izgara}@0.55`, "vignette=angle=PI/5"];
    const vf = [...zemin, ...this.f].join(",") || "null";
    const script = path.join(this.tmp, "fc.txt");
    fs.writeFileSync(script, "[0:v]" + vf + "[o]");
    try {
      cp.execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", giris,
        require("./ff-yol").filtreBayragi, script, "-map", "[o]", "-frames:v", "1", cikti], { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      throw new Error("engineering visual render failed: " + String(e.stderr || e.message).slice(-300));
    }
    fs.rmSync(this.tmp, { recursive: true, force: true });
    return cikti;
  }
}

function baslikEtiketi(t, metin, x, y, s) {
  t.kutu(x, y + s * 0.12, s * 0.16, s * 0.9, RENK.vurgu);
  t.yazi(metin, x + s * 0.4, y, s, RENK.vurgu);
}

// ---------------- cizimler ----------------
const CIZ = {
  "failure-chain"(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, !long);
    const adim = veri.adimlar.slice(0, 6);
    // Uzun formatta alt ~%22 altyaziya ayrilir (diyagram altyaziyla cakismasin)
    const kutuW = long ? 1000 : 900, kutuH = 84, ok = 38, fs_ = long ? 40 : 38;
    const toplamH = adim.length * kutuH + (adim.length - 1) * ok;
    const y0 = long ? Math.max(160, (840 - toplamH) / 2 + 80) : 330;
    const x0 = (W - kutuW) / 2;
    if (!long) t.kutu(x0 - 40, y0 - 120, kutuW + 80, toplamH + 170, RENK.zemin + "@0.86");
    baslikEtiketi(t, "FAILURE CHAIN", long ? 120 : x0, long ? 90 : y0 - 100, long ? 46 : 40);
    adim.forEach((a, i) => {
      const y = y0 + i * (kutuH + ok);
      const son = i === adim.length - 1;
      t.kutu(x0, y, kutuW, kutuH, son ? RENK.kirmiziZemin : RENK.kutu);
      t.kutu(x0, y, kutuW, kutuH, son ? RENK.kirmizi : RENK.kenar, 4);
      t.yazi(String(i + 1).padStart(2, "0"), x0 + 26, y + (kutuH - fs_ * 0.8) / 2, fs_ * 0.7, son ? RENK.kirmizi : RENK.soluk);
      t.yazi(a, 0, y + (kutuH - fs_) / 2 + 4, a.length > 26 ? fs_ * 0.82 : fs_, RENK.yazi, "orta");
      if (!son) t.yazi("↓", 0, y + kutuH + (ok - fs_) / 2 - 4, fs_, RENK.vurgu, "orta");
    });
    return t;
  },
  timeline(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, false);
    const z = veri.olaylar.slice(0, 5);
    baslikEtiketi(t, veri.baslik || "TIMELINE", long ? 120 : 90, long ? 90 : 160, long ? 46 : 44);
    if (long) {
      const y = 560, x0 = 190, x1 = W - 190;
      t.kutu(x0, y - 3, x1 - x0, 6, RENK.kenar);
      z.forEach((o, i) => {
        const x = z.length === 1 ? (x0 + x1) / 2 : x0 + (x1 - x0) * i / (z.length - 1);
        const son = i === z.length - 1;
        t.kutu(x - 13, y - 13, 26, 26, son ? RENK.kirmizi : RENK.vurgu);
        const ust = i % 2 === 0;
        const satir = sar(o.olay, 22).slice(0, 3);
        // hiza: ilk isaret sola, son isaret saga, digerleri ortaya — metin kenardan tasmasin
        const hiza = i === 0 ? "sol" : i === z.length - 1 ? "sag" : "orta";
        const hx = hiza === "sol" ? x - 20 : hiza === "sag" ? x + 20 : x - W / 2;
        const yTarih = ust ? y - 70 - satir.length * 40 - 46 : y + 44;
        t.yazi(o.t, hx, yTarih, 36, RENK.vurgu, hiza);
        satir.forEach((l, j) => t.yazi(l, hx, yTarih + 50 + j * 40, 30, RENK.yazi, hiza));
      });
    } else {
      const x = 170, y0 = 330, y1 = 1500;
      t.kutu(x - 3, y0, 6, y1 - y0, RENK.kenar);
      z.forEach((o, i) => {
        const y = y0 + (y1 - y0) * i / Math.max(1, z.length - 1);
        t.kutu(x - 14, y - 14, 28, 28, i === z.length - 1 ? RENK.kirmizi : RENK.vurgu);
        t.yazi(o.t, x + 50, y - 36, 44, RENK.vurgu);
        sar(o.olay, 28).slice(0, 2).forEach((l, j) => t.yazi(l, x + 50, y + 18 + j * 46, 38, RENK.yazi));
      });
    }
    return t;
  },
  "root-cause"(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, false);
    const x = long ? 160 : 90;
    baslikEtiketi(t, "ROOT CAUSE", x, long ? 170 : 520, long ? 48 : 46);
    const satir = sar(veri.neden.toUpperCase(), long ? 32 : 20).slice(0, 3);
    satir.forEach((l, i) => t.yazi(l, x, (long ? 260 : 620) + i * 92, long ? 80 : 72, RENK.yazi));
    if (veri.tetik) {
      const y = long ? 300 + satir.length * 92 : 1020;
      t.kutu(x, y, long ? 1100 : 900, 4, RENK.kenar);
      t.yazi("TRIGGER", x, y + 36, long ? 32 : 34, RENK.soluk);
      sar(veri.tetik, long ? 50 : 34).slice(0, 2).forEach((l, i) => t.yazi(l, x, y + 90 + i * 54, long ? 44 : 44, RENK.vurgu));
    }
    return t;
  },
  "myth-vs-evidence"(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, false);
    const x = long ? 160 : 90, gen = long ? 1600 : 900;
    const blok = (etiket, metin, y, vurgu) => {
      t.kutu(x, y, gen, long ? 250 : 380, vurgu ? RENK.kutu : "0x101A27");
      t.kutu(x, y, 10, long ? 250 : 380, vurgu ? RENK.vurgu : RENK.soluk);
      t.yazi(etiket, x + 50, y + 30, long ? 34 : 36, vurgu ? RENK.vurgu : RENK.soluk);
      sar(metin, long ? 62 : 32).slice(0, 4).forEach((l, i) => t.yazi(l, x + 50, y + (long ? 90 : 100) + i * (long ? 48 : 60), long ? 40 : 44, RENK.yazi));
    };
    blok("COMMON BELIEF", veri.inanis, long ? 190 : 420, false);
    blok("WHAT THE EVIDENCE SHOWS", veri.kanit, long ? 520 : 900, true);
    return t;
  },
  "key-number"(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, false);
    const boyut = Math.min(long ? 260 : 200, Math.round((long ? 3000 : 1900) / Math.max(4, veri.sayi.length)));
    t.yazi(veri.sayi, 0, H / 2 - boyut * 0.75, boyut, RENK.vurgu, "orta");
    sar(veri.aciklama, long ? 48 : 30).slice(0, 2).forEach((l, i) => t.yazi(l, 0, H / 2 + boyut * 0.45 + i * 60, long ? 46 : 46, RENK.yazi, "orta"));
    return t;
  },
  "what-changed"(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, false);
    const x = long ? 160 : 90;
    baslikEtiketi(t, "WHAT CHANGED AFTERWARDS", x, long ? 300 : 620, long ? 46 : 42);
    sar(veri.ders.charAt(0).toUpperCase() + veri.ders.slice(1), long ? 40 : 26).slice(0, 4)
      .forEach((l, i) => t.yazi(l, x, (long ? 400 : 730) + i * (long ? 80 : 76), long ? 66 : 60, RENK.yazi));
    return t;
  },
  "critical-decision"(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, false);
    const x = long ? 160 : 90;
    t.kutu(x, long ? 260 : 560, long ? 1600 : 900, long ? 520 : 700, RENK.kirmiziZemin);
    t.kutu(x, long ? 260 : 560, long ? 1600 : 900, long ? 520 : 700, RENK.kirmizi, 5);
    t.yazi("CRITICAL DECISION" + (veri.t ? "  ·  " + veri.t : ""), x + 50, (long ? 300 : 600), long ? 40 : 38, RENK.kirmizi);
    sar(veri.metin, long ? 44 : 28).slice(0, 5).forEach((l, i) => t.yazi(l, x + 50, (long ? 380 : 690) + i * (long ? 72 : 70), long ? 56 : 52, RENK.yazi));
    return t;
  },
  "warning-signs"(veri, f) {
    const long = f === "long";
    const W = long ? 1920 : 1080, H = long ? 1080 : 1920;
    const t = new Tuval(W, H, false);
    const x = long ? 160 : 90;
    baslikEtiketi(t, "WARNING SIGNS", x, long ? 150 : 400, long ? 46 : 44);
    veri.isaretler.slice(0, 5).forEach((w, i) => {
      const y = (long ? 260 : 520) + i * (long ? 140 : 170);
      t.yazi("!", x, y, long ? 60 : 60, RENK.vurgu);
      sar(w, long ? 60 : 30).slice(0, 2).forEach((l, j) => t.yazi(l, x + 70, y + 6 + j * 52, long ? 44 : 44, RENK.yazi));
    });
    return t;
  },
};

// Vaka dosyasindan hangi gorsellerin cizilebilecegi (veri yoksa YOK)
function adaylar(konu) {
  const v = konu.vaka || {};
  const l = [];
  if (Array.isArray(v.zaman) && v.zaman.length >= 2) l.push({ tip: "timeline", rol: "context", veri: { olaylar: v.zaman, baslik: (v.kisa || "") ? (v.kisa + " — TIMELINE").toUpperCase() : "TIMELINE" } });
  if (Array.isArray(v.zincir) && v.zincir.length >= 3) l.push({ tip: "failure-chain", rol: "technical", veri: { adimlar: v.zincir } });
  if (v.mekanizma) l.push({ tip: "root-cause", rol: "discovery", veri: { neden: v.mekanizma, tetik: v.tetik ? v.tetik.charAt(0).toUpperCase() + v.tetik.slice(1) : "" } });
  if (v.yanilgi && /,?\s+but\s+|\s+—\s+/.test(v.yanilgi)) {
    const [a, ...b] = v.yanilgi.split(/,?\s+but\s+|\s+—\s+/);
    l.push({ tip: "myth-vs-evidence", rol: "technical", veri: { inanis: a.replace(/\.$/, "") + ".", kanit: b.join(" — ").charAt(0).toUpperCase() + b.join(" — ").slice(1) } });
  }
  if (v.sayi && /\d/.test(v.sayi)) l.push({ tip: "key-number", rol: "event", veri: { sayi: v.sayi, aciklama: v.tetik ? M1(v.tetik) : "" } });
  if (v.ders) l.push({ tip: "what-changed", rol: "lesson", veri: { ders: v.ders } });
  if (v.karar && v.karar.metin) l.push({ tip: "critical-decision", rol: "discovery", veri: v.karar });
  if (Array.isArray(v.uyarilar) && v.uyarilar.length) l.push({ tip: "warning-signs", rol: "context", veri: { isaretler: v.uyarilar } });
  return l;
}
const M1 = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);

function ciz(tip, veri, cikti, format = "long") {
  if (!CIZ[tip]) throw new Error("bilinmeyen gorsel tipi: " + tip);
  return CIZ[tip](veri, format).kaydet(cikti);
}

// UZUN FORMAT: gorselleri rolune en uygun sahne klasorune yerlestir (video-yap.js bunlari
// sahnenin kendi zamaninda gosterir, renk/hareket uygulamadan).
function uzunIcinUret(slug) {
  const BASE = path.join(KOK, "uretim", slug);
  const VIS = path.join(BASE, "Visuals");
  if (!fs.existsSync(VIS)) throw new Error("Visuals yok — once gorsel-bul.js");
  const konu = K.uretimKonusu(slug);
  const klasorler = fs.readdirSync(VIS).filter((x) => fs.statSync(path.join(VIS, x)).isDirectory()).sort();
  const metinDosya = path.join(BASE, "Voice", "SESLENDIRME-TAM-METIN.txt");
  const paragraflar = fs.existsSync(metinDosya) ? require("./lib/sahne").sahneParagraflari(fs.readFileSync(metinDosya, "utf8")) : [];
  const plan = require("./scene-pacing").planUzun(paragraflar.length ? paragraflar : klasorler, null);
  const kullanilan = new Set();
  const manifest = [];
  for (const [i, a] of adaylar(konu).entries()) {
    // once ayni roldeki, kullanilmamis sahne; yoksa plana gore en yakin
    let s = plan.findIndex((p, j) => p.rol === a.rol && !kullanilan.has(j) && j < klasorler.length);
    if (s < 0) s = plan.findIndex((p, j) => !kullanilan.has(j) && j > 0 && j < klasorler.length);
    if (s < 0) continue;
    kullanilan.add(s);
    const hedef = path.join(VIS, klasorler[s], `eng-${String(i + 1).padStart(2, "0")}-${a.tip}.png`);
    ciz(a.tip, a.veri, hedef, "long");
    manifest.push({ tip: a.tip, sahne: klasorler[s], dosya: path.relative(BASE, hedef) });
  }
  jsonYaz(path.join(VIS, "engineering-visuals.json"), manifest);
  if (manifest.length < 2) console.log("  ⚠ yalnizca " + manifest.length + " teknik gorsel — vaka dosyasina zincir/zaman/yanilgi ekleyin (hedef 4-8)");
  return manifest;
}

// SHORTS: seffaf failure-chain ust katmani (teknik sahnede ~3 sn gosterilir)
function kisaUstKatman(konu, cikti) {
  const a = adaylar(konu).find((x) => x.tip === "failure-chain");
  if (!a) return null;
  return ciz(a.tip, a.veri, cikti, "short");
}

// SHORTS: ADIM ADIM zincir. Her asama bir oncekinin ustune bir kutu ekler; en son
// eklenen kutu kirmizi vurgulanir (cizim "son adim" kuralini zaten uygular), boylece
// izleyici arizanin nasil ilerledigini sirayla gorur. Donus: asama PNG yollari.
function kisaZincirAsamalari(konu, klasor) {
  const a = adaylar(konu).find((x) => x.tip === "failure-chain");
  if (!a) return [];
  const adimlar = a.veri.adimlar.slice(0, 6);
  return adimlar.map((_, i) => ciz("failure-chain", { adimlar: adimlar.slice(0, i + 1) }, path.join(klasor, `zincir-${i + 1}.png`), "short"));
}

// SHORTS: zincirin ekranda kalacagi pencere. Kancadan (ilk ~2.7 sn) sonra, kapanis
// sorusundan (son 2.8 sn) once; teknik sahne varsa onun basinda, yoksa videonun
// ~%35'inde. Adim basina ~0.55 sn acilis + 1.3 sn tam zincir; sigmazsa adimlar
// hizlanir (en az 0.35 sn), pencere 2.4 sn'den kisaysa zincir hic gosterilmez.
function kisaZincirPenceresi({ adimSayisi, vodur, teknikBas = null, kancaSon = 2.7, soruPayi = 2.9 }) {
  const n = Math.max(0, Math.min(6, adimSayisi || 0));
  if (n < 3 || !(vodur > 0)) return null;
  const bas0 = Math.min(kancaSon, vodur * 0.4) + 0.3;
  const son0 = vodur - soruPayi;
  if (son0 - bas0 < 2.4) return null;
  const istenen = Math.min(4.6, n * 0.55 + 1.3);
  const sure = Math.max(2.4, Math.min(istenen, son0 - bas0));
  let a = teknikBas != null && teknikBas >= bas0 ? teknikBas : Math.max(bas0, vodur * 0.35);
  if (a + sure > son0) a = son0 - sure;
  a = Math.max(bas0, a);
  const b = a + sure;
  const acilis = Math.max(n * 0.35, sure - 1.0);
  const adim = acilis / n;
  const asamalar = Array.from({ length: n }, (_, i) => ({ a: +(a + i * adim).toFixed(2), b: +(i === n - 1 ? b : a + (i + 1) * adim).toFixed(2) }));
  return { a: +a.toFixed(2), b: +b.toFixed(2), asamalar };
}

module.exports = { ciz, adaylar, uzunIcinUret, kisaUstKatman, kisaZincirAsamalari, kisaZincirPenceresi, sar, CIZ };

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) { console.error("Kullanim: node engineering-visuals.js <slug> [--onizle]"); process.exit(1); }
  if (process.argv.includes("--onizle")) {
    const konu = K.uretimKonusu(slug);
    const dir = K.paketYolu(slug, "visuals");
    for (const a of adaylar(konu)) {
      for (const f of ["long", "short"]) {
        const o = ciz(a.tip, a.veri, path.join(dir, `${a.tip}-${f}.png`), f);
        console.log("  ✓ " + path.relative(KOK, o));
      }
    }
  } else {
    const m = uzunIcinUret(slug);
    console.log(`✓ ${m.length} teknik gorsel: ` + m.map((x) => x.tip + "→" + x.sahne).join(", "));
  }
}
