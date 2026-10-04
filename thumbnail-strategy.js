// THUMBNAIL STRATEGY — Shorts icin 3, long-form icin 5 kapak konsepti + render.
//
// Repoda daha once kapak ureteci yoktu; bu modul hem STRATEJIYI (konsept,
// kirpma, odak, hiyerarsi, 2-4 kelime metin, duygu tetigi, kontrast, mobil
// okunabilirlik) hem RENDER'i (videonun kendi karelerinden, ffmpeg) yapar.
//
// Marka tutarliligi: ayni kehribar vurgu + ayni yazi ailesi. Ama duzen konsepte
// gore degisir (sol-metin/sag-ozne, dev-sayi, diyagram-bindirme) — kanal
// genelinde tek kalip yok.
//
// Kullanim:
//   node thumbnail-strategy.js <slug> | --all            konseptler -> icerik/paket/<slug>/thumbnails.json
//   node thumbnail-strategy.js <slug> --render           + uretim/<slug>/thumbnails/*.jpg (render edilmis videodan)
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const { KOK, jsonOku, jsonYaz } = require("./lib/ortak");
const M = require("./lib/metin");
const K = require("./lib/kutuphane");

const VURGU = "0xD9A441";

function mobilKontrol(metin, format) {
  const kel = M.kelimeSay(metin), uz = metin.length;
  const sorunlar = [];
  if (kel > 4) sorunlar.push(`${kel} words — max 4`);
  if (uz > 18) sorunlar.push(`${uz} characters — hard to read at 120px wide`);
  if (/[a-z]/.test(metin) && metin !== metin.toUpperCase()) sorunlar.push("mixed case reads smaller than caps at thumbnail size");
  return { gecti: !sorunlar.length, sorunlar, not: format === "short" ? "Shorts feed mostly shows a frame from the video — the opening frame matters more than a custom cover." : "checked for ~168x94 px mobile suggested-video size" };
}

function konseptler(konu, baslik) {
  const v = konu.vaka || {};
  const kapak = (v.kapak || []).map((x) => x.toUpperCase());
  const format = K.formatBul(konu);
  const baslikK = new Set(M.icerikKelimeleri(baslik || konu.baslik));
  const tekrarOrani = (t) => { const w = M.icerikKelimeleri(t); return w.length ? w.filter((x) => baslikK.has(x)).length / w.length : 0; };
  const l = [];
  // Her konseptin metni FARKLI olmali (3 konsept = 3 farkli bilgi); mobil testi gecenler once.
  const kullanilan = new Set();
  const mekKisa = v.mekanizma ? ((v.mekanizma.match(/\(([^)]+)\)/) || [])[1] || v.mekanizma).toUpperCase() : "";
  // hook yalnizca zaten kisaysa (<=4 kelime) kapak metni olabilir; kesilmis parca anlamsiz kalir
  const hookK = M.kelimeSay(konu.hook || "") <= 4 ? String(konu.hook || "").toUpperCase() : "";
  const benzer = (x) => [...kullanilan].some((u) => u === x || u.includes(x) || x.includes(u) || M.trigramBenzerlik(u, x) > 0.55);
  const sayiMetni = v.sayi && /\d/.test(v.sayi) ? v.sayi.toUpperCase() : "";
  if (sayiMetni) kullanilan.add(sayiMetni);          // sayi konsepti icin ayrilir
  const sec = (...adaylar) => {
    const temiz = adaylar.filter(Boolean).filter((x) => !benzer(x));
    const t = temiz.find((x) => mobilKontrol(x, format).gecti) || temiz[0] || "";
    if (t) kullanilan.add(t);
    return t;
  };
  // 1) OLAY — en dramatik gercek kare
  l.push({ id: "event-frame", duzen: "subject-right-text-left",
    anaGorsel: "the most dramatic real frame of the failure (from the hook/event scene)",
    kirpma: format === "short" ? "9:16 full frame; subject in upper-middle third, clear of captions" : "16:9; subject on right two-thirds, rule-of-thirds",
    odak: v.nesne ? `the ${v.nesne.toLowerCase()} at the moment of failure` : "the failing structure",
    hiyerarsi: ["failure moment", "2-4 word text", "brand accent bar"],
    metin: sec(kapak[0], hookK, kapak[2]),
    duyguTetigi: "shock / awe — the viewer sees the failure happening",
    kontrast: "darken & desaturate background 20%, warm accent on text, subject kept at natural colour",
    kaynakSahne: "hook" });
  // 2) SAYI — tek carpici olcu
  if (sayiMetni) l.push({ id: "key-number", duzen: "giant-number-center",
    anaGorsel: "blurred real frame behind a giant measured value",
    kirpma: "number fills ~45% of the frame height; frame blurred 12px behind",
    odak: "the number " + v.sayi, hiyerarsi: ["number", "one-line context", "brand accent"],
    metin: sayiMetni, duyguTetigi: `curiosity about scale — "only ${sayiMetni.toLowerCase()}?"`,
    kontrast: "amber number with thick dark outline over dark blur", kaynakSahne: "event" });
  // 3) MEKANIZMA — diyagram bindirme (muhendislik kimligi)
  l.push({ id: "mechanism-overlay", duzen: "diagram-overlay",
    anaGorsel: "real frame with an engineering mark-up: red circle/arrow on the component that failed",
    kirpma: "tight crop on the failing component",
    odak: v.mekanizma ? `where ${v.mekanizma} acts` : "the failure point",
    hiyerarsi: ["red mark-up on component", "text", "blueprint grid tint"],
    metin: sec(kapak[1], kapak[2], mekKisa.split(/\s+/).length <= 3 ? mekKisa : ""),
    duyguTetigi: "intrigue — 'what broke here?'",
    kontrast: "cool blueprint tint on image, warm red mark-up, white text",
    kaynakSahne: "technical" });
  // 3. konsept yoksa: METINSIZ kare (NO_THUMBNAIL_TEXT deneyi icin gecerli bir secenek)
  if (l.length < 3) l.push({ ...l[0], id: "no-text-frame", duzen: "full-bleed", metin: "",
    hiyerarsi: ["failure moment only"], duyguTetigi: "pure visual curiosity — the frame carries the story",
    kontrast: "natural colour, slight vignette" });
  if (format === "long") {
    l.push({ id: "failure-chain", duzen: "before-after-split",
      anaGorsel: "two real/source-backed frames: intact system versus the decisive failure state",
      kirpma: "16:9 split composition with one dominant subject and a narrow causal arrow",
      odak: "the visual transition from normal operation to failure",
      hiyerarsi: ["failed subject", "causal arrow", "short mechanism label"],
      metin: sec("WHAT FAILED", "THE FAILURE CHAIN"), duyguTetigi: "causal curiosity — connect the two states",
      kontrast: "cool intact side, warm failure side, one high-contrast arrow", kaynakSahne: "failure-chain" });
    l.push({ id: "evidence-closeup", duzen: "single-evidence-closeup",
      anaGorsel: "one authentic component, measurement, or source-backed technical detail; never a fake document",
      kirpma: "extreme close-up occupying two-thirds of 16:9 with generous negative space",
      odak: v.mekanizma ? `physical evidence of ${v.mekanizma}` : "the first failed component",
      hiyerarsi: ["evidence detail", "one annotation", "minimal text"],
      metin: sec("FIRST FAILURE", mekKisa.split(/\s+/).length <= 3 ? mekKisa : ""), duyguTetigi: "forensic intrigue",
      kontrast: "neutral evidence colour, white annotation, restrained amber highlight", kaynakSahne: "technical" });
  }
  return l.slice(0, format === "long" ? 5 : 3).map((c) => {
    const mk = mobilKontrol(c.metin, format);
    const tekrar = tekrarOrani(c.metin);
    const uyari = [];
    if (tekrar > 0.6) uyari.push("text repeats the title — thumbnail and title should add different information");
    if (!c.metin && c.id !== "no-text-frame") uyari.push("no text — acceptable if the frame is self-explanatory");
    // AI gorsel hattina verilebilecek istem (yalnizca gercek kare yoksa; kullanilirsa RECONSTRUCTION etiketi zorunlu)
    const istem = `Documentary thumbnail, ${c.anaGorsel}, ${c.odak}, ${c.kontrast}, photographic, no text, no logos`;
    return { ...c, mobil: mk, baslikTekrari: Math.round(tekrar * 100) / 100, uyarilar: uyari,
      aiIstem: { istem, not: "use only when no real frame exists; label RECONSTRUCTION on use (config/growth.json disclosure)" } };
  });
}

// Diger videolarin birincil kapak duzenleri (kanal genelinde sablon tekrari olcumu)
function kanalDuzenleri(haricSlug) {
  const say = {};
  if (!fs.existsSync(K.YOL.paket)) return say;
  for (const s of fs.readdirSync(K.YOL.paket)) {
    if (s === haricSlug) continue;
    const t = jsonOku(K.paketYolu(s, "thumbnails.json"), null);
    const c = t && t.konseptler && t.konseptler.find((x) => x.id === t.birincil);
    if (c) say[c.duzen] = (say[c.duzen] || 0) + 1;
  }
  return say;
}

function degerlendir(konu) {
  const titles = jsonOku(K.paketYolu(konu.slug, "titles.json"), null);
  const baslik = (titles && titles.secilen) || konu.baslik;
  const l = konseptler(konu, baslik);
  const farkli = new Set(l.map((c) => c.metin)).size === l.length;
  const puan = Math.round(l.reduce((a, c) => a + (c.mobil.gecti ? 34 : 18) - c.uyarilar.length * 6, 0) * (l.length >= 3 ? 1 : 0.8)) - (farkli ? 0 : 15);
  // Olay karesinde metin tarafi (sol/sag) slug'a gore degisir.
  const olay = l.find((c) => c.id === "event-frame");
  if (olay && require("./lib/ortak").hash01(konu.slug + ":yan") > 0.5) olay.duzen = "subject-left-text-right";
  // Birincil konsept: metni olan ve mobil testi gecen konseptler icinden, kanalda
  // EN AZ kullanilmis duzen (tek sablon olmasin); esitlikte icerik onceligi
  // (kisa carpici sayi > mekanizma > olay).
  const kullanim = kanalDuzenleri(konu.slug);
  const oncelik = { "key-number": 0, "mechanism-overlay": 1, "event-frame": 2, "no-text-frame": 3 };
  const aday = l.filter((c) => c.metin && c.mobil.gecti && !(c.id === "key-number" && c.metin.length > 9));
  const birincil = (aday.length ? aday : l).slice().sort((a, b) =>
    (kullanim[a.duzen] || 0) - (kullanim[b.duzen] || 0) || oncelik[a.id] - oncelik[b.id])[0];
  return { slug: konu.slug, format: K.formatBul(konu), baslik, olusturuldu: new Date().toISOString(), puan: Math.max(0, Math.min(100, puan)),
    birincil: birincil.id, konseptler: l };
}

// ---------------- render ----------------
function kareAl(video, sn, cikti) {
  const FF = require("./ff-yol").ffmpeg;
  cp.execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(sn), "-i", video, "-frames:v", "1", "-q:v", "2", cikti]);
}

function renderKonsept(c, kare, cikti, format) {
  const FF = require("./ff-yol").ffmpeg;
  const font = require("./font-yol")(true);
  const W = format === "short" ? 1080 : 1280, H = format === "short" ? 1920 : 720;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-"));
  const tf = path.join(tmp, "t.txt");
  const satirlar = !c.metin ? [] : c.metin.length > 11 ? ikiSatir(c.metin) : [c.metin];
  fs.writeFileSync(tf, satirlar.join("\n"));
  const fsz = c.duzen === "giant-number-center" ? Math.round(H * 0.30) : Math.round(H * (satirlar.length > 1 ? 0.15 : 0.18));
  let vf;
  const yazi = (x, y) => `drawtext=fontfile='${font}':textfile='${tf}':fontsize=${fsz}:fontcolor=white:borderw=${Math.round(fsz / 14)}:bordercolor=black@0.85:line_spacing=${Math.round(fsz * 0.12)}:x=${x}:y=${y}`;
  const taban = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;
  if (c.duzen === "giant-number-center") {
    vf = `${taban},boxblur=12:2,eq=brightness=-0.25:saturation=0.7,` + yazi("(w-text_w)/2", "(h-text_h)/2").replace("fontcolor=white", `fontcolor=${VURGU}`);
  } else if (c.duzen === "diagram-overlay") {
    const g = Math.round(W / 16);
    vf = `${taban},eq=saturation=0.55:brightness=-0.12,colorbalance=bs=0.18:bm=0.08,drawgrid=w=${g}:h=${g}:t=1:c=0x6FA8DC@0.18,` +
      `drawbox=x=iw*0.52:y=ih*0.26:w=iw*0.30:h=ih*0.40:color=0xD9534F@0.95:t=${Math.round(W / 160)},` + yazi(Math.round(W * 0.05), `h-text_h-${Math.round(H * 0.08)}`);
  } else if (c.duzen === "full-bleed" || !c.metin) {
    vf = `${taban},eq=contrast=1.06,vignette=angle=PI/5`;
  } else if (c.duzen === "subject-left-text-right") {
    vf = `${taban},eq=brightness=-0.08:contrast=1.08,drawbox=x=iw*0.48:y=0:w=iw*0.52:h=ih:color=black@0.45:t=fill,` +
      `drawbox=x=${Math.round(W * 0.52)}:y=${Math.round(H * 0.18)}:w=${Math.round(W * 0.012)}:h=${Math.round(H * 0.5)}:color=${VURGU}:t=fill,` +
      yazi(Math.round(W * 0.55), Math.round(H * 0.2));
  } else {
    vf = `${taban},eq=brightness=-0.08:contrast=1.08,drawbox=x=0:y=0:w=iw*0.52:h=ih:color=black@0.45:t=fill,` +
      `drawbox=x=${Math.round(W * 0.05)}:y=${Math.round(H * 0.18)}:w=${Math.round(W * 0.012)}:h=${Math.round(H * 0.5)}:color=${VURGU}:t=fill,` +
      yazi(Math.round(W * 0.08), Math.round(H * 0.2));
  }
  fs.mkdirSync(path.dirname(cikti), { recursive: true });
  cp.execFileSync(FF, ["-y", "-hide_banner", "-loglevel", "error", "-i", kare, "-vf", vf, "-frames:v", "1", "-q:v", "2", cikti]);
  fs.rmSync(tmp, { recursive: true, force: true });
  return cikti;
}
function ikiSatir(t) {
  const w = t.split(/\s+/);
  if (w.length < 2) return [t];
  const orta = Math.ceil(w.length / 2);
  return [w.slice(0, orta).join(" "), w.slice(orta).join(" ")];
}

function render(slug) {
  const r = calistir(slug);
  const BASE = path.join(KOK, "uretim", slug);
  const vid = path.join(BASE, "Videos", slug + ".mp4");
  if (!fs.existsSync(vid)) throw new Error("render edilmis video yok: " + path.relative(KOK, vid));
  const zam = jsonOku(path.join(BASE, "Videos", "sahne-zamanlari.json"), null);
  const pacing = require("./scene-pacing");
  const konu = K.uretimKonusu(slug);
  const plan = pacing.planKisa(konu, null);
  const saniye = (rol) => {
    if (!zam) return rol === "hook" ? 1.2 : 6;
    const i = rol === "hook" ? 0 : Math.max(0, plan.findIndex((p) => p.rol === rol || (rol === "event" && p.tempo === "fast" && p.sira > 0)));
    const z = zam[i] || zam[0];
    return (z.bas + z.son) / 2;
  };
  const out = [];
  for (const [i, c] of r.konseptler.entries()) {
    const kare = path.join(os.tmpdir(), `kare-${slug}-${i}.jpg`);
    kareAl(vid, saniye(c.kaynakSahne), kare);
    const o = renderKonsept(c, kare, path.join(BASE, "thumbnails", `concept-${i + 1}-${c.id}.jpg`), r.format);
    out.push(path.relative(KOK, o));
    try { fs.unlinkSync(kare); } catch (e) {}
  }
  // Versioned variant ledger (hash, concept, layout, text length) per channel.
  try {
    const Channel = require("./core/channel-context");
    require("./core/growth/thumbnails").recordVariants(Channel.getChannel(), slug, r.konseptler.map((c, i) => ({
      file: out[i], concept: c.id, layoutType: c.duzen || c.layout || null, text: c.metin || c.yazi || null, templateVersion: "fr-thumbnail-strategy-v1", human: false, selected: i === 0 })));
  } catch (e) {}
  return out;
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const r = degerlendir(konu);
  jsonYaz(K.paketYolu(slug, "thumbnails.json"), r);
  return r;
}

module.exports = { konseptler, degerlendir, calistir, render, mobilKontrol };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error("Kullanim: node thumbnail-strategy.js <slug> | --all  [--render]"); process.exit(1); }
  for (const s of arg === "--all" ? K.konular().map((k) => k.slug) : [arg]) {
    const r = calistir(s);
    console.log(`${s.padEnd(30)} ${String(r.puan).padStart(3)}/100  ` + r.konseptler.map((c) => `[${c.id}: "${c.metin}"${c.mobil.gecti ? "" : " ⚠"}]`).join(" "));
    if (process.argv.includes("--render")) for (const f of render(s)) console.log("  ✓ " + f);
  }
}
