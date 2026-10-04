// QUALITY GATE — yayindan once 9 bilesenli puan: PUBLISH | REVIEW | BLOCK.
//
//   TITLE · THUMBNAIL · HOOK · SCRIPT · ORIGINALITY · VISUAL QUALITY ·
//   ENGINEERING DEPTH · SOURCE QUALITY · AUDIO           (her biri /100)
//
// Esikler config/growth.json > qualityGate (varsayilan 85 PUBLISH, 70-84 REVIEW, <70 BLOCK).
// Iki asama: "pre" (render oncesi — metin/kaynak/ozgunluk; ses ve goruntu
// henuz olculemez) ve "final" (render sonrasi — ses yuksekligi, cozunurluk,
// sure, kaynak dosyalari gercekten olculur). Otomasyon yayin sikligini kaliteye
// tercih ETMEZ: BLOCK olan video yuklenmez.
//
// Kullanim: node quality-gate.js <slug> [--final] | --all
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const { KOK, jsonOku, jsonYaz, metinYaz, sinirla } = require("./lib/ortak");
const SELECTED = require("./core/channel-context").selectFromArgv(process.argv.slice(2));
const { ayar } = require("./lib/ayar");
const M = require("./lib/metin");
const K = require("./lib/kutuphane");

const EN = { title: "TITLE", thumbnail: "THUMBNAIL", hook: "HOOK", script: "SCRIPT", originality: "ORIGINALITY",
  visual: "VISUAL QUALITY", engineering: "ENGINEERING DEPTH", source: "SOURCE QUALITY", audio: "AUDIO" };

// Mekanizma senaryoda adiyla geciyor mu? Parantez icindeki yaygin ad da sayilir
// ("internal erosion (piping)" -> "piping" yeterli).
function mekanizmaGeciyor(mekanizma, metin) {
  const t = metin.toLowerCase();
  const parcalar = [mekanizma.replace(/\(.*\)/, ""), ...((mekanizma.match(/\(([^)]+)\)/) || []).slice(1))];
  return parcalar.some((p) => {
    const w = M.icerikKelimeleri(p).filter((x) => x.length > 3);
    return w.length && w.some((x) => t.includes(x.slice(0, 6)));
  });
}

// ---------------- bilesenler ----------------
function senaryo(konu, telaffuz, format) {
  const v = konu.vaka || {};
  const metin = K.anlati(konu);
  const n = M.kelimeSay(metin);
  const not = [];
  let p = 100;
  p -= Math.round((100 - telaffuz.puan) * 0.5);
  if (telaffuz.supheli.length) not.push(`${telaffuz.supheli.length} pronunciation risk(s)`);
  if (telaffuz.kliseler.length) { p -= 25 * telaffuz.kliseler.length; not.push("AI clichés: " + telaffuz.kliseler.join(", ")); }
  if (format === "short") {
    if (n > 165) { p -= 20; not.push(`${n} words — likely over 60 s`); }
    else if (n < 55) { p -= 10; not.push(`${n} words — thin`); }
    // Kanalin izleyici tutma verisinden cikan kurallar (lib/tutunma.js)
    for (const x of require("./lib/tutunma").denetle(konu)) { p -= 12; not.push("retention: " + x.mesaj); }
  }
  if (v.mekanizma) {
    if (!mekanizmaGeciyor(v.mekanizma, metin)) { p -= 12; not.push("the script never names the mechanism (" + v.mekanizma + ")"); }
  } else { p -= 10; not.push("no mechanism in the case file"); }
  if (!/\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|twice|half)\b/i.test(metin)) { p -= 10; not.push("no concrete numbers"); }
  if (Array.isArray(konu.bolumler)) {
    const d = require("./story-structure");
    const plan = d.donguler(konu, d.bolumler(konu).sira);
    const tam = konu.bolumler.map((b) => "## " + (b.baslik || "") + "\n" + (b.paragraflar || []).join("\n")).join("\n");
    const acik = d.donguDenetle(tam, plan).filter((x) => x.durum !== "resolved");
    if (acik.length) { p -= 10 * acik.length; not.push(acik.length + " open loop(s) not resolved in order"); }
  }
  return { puan: sinirla(p), notlar: not };
}

function muhendislik(konu) {
  const v = konu.vaka || {};
  const metin = K.anlati(konu).toLowerCase();
  const not = [];
  let p = 0;
  if (v.mekanizma) p += 25; else not.push("no mechanism");
  if (Array.isArray(v.zincir) && v.zincir.length >= 3) p += 20; else not.push("no failure chain");
  if (v.mekanizma && mekanizmaGeciyor(v.mekanizma, metin)) p += 20; else not.push("mechanism not explained on screen/voice");
  if (/\d|\b(two|three|four|five|six|seven|eight|nine|ten|hundred|thousand|million|billion|forty|thirty|twenty)\b/.test(metin)) p += 15;
  if (v.yanilgi || v.tartisma) p += 10;
  if (Array.isArray(v.kaynakca) && v.kaynakca.length) p += 10; else not.push("no technical references");
  return { puan: sinirla(p), notlar: not };
}

function kaynak(konu, final) {
  const v = konu.vaka || {};
  const not = [];
  let p = 50;
  const arsiv = (konu.kaynaklar || []).length;
  if (konu.tur === "stok") { p += 20; not.push("licensed stock (Pexels) — lower evidential value than archive"); }
  else if (arsiv) p += 30;
  else { p -= 30; not.push("no footage source declared"); }
  if (Array.isArray(v.kaynakca) && v.kaynakca.length) p += 20; else not.push("no technical references for the description");
  const sentetik = (konu.sahneler || []).some((s) => s.sentetik);
  if (sentetik && !ayar().disclosure.enabled) { p -= 60; not.push("synthetic imagery without disclosure"); }
  if (final) {
    const d = path.join(KOK, "uretim", konu.slug, "GORSEL-KAYNAKLARI.txt");
    if (!fs.existsSync(d)) { p -= 10; not.push("GORSEL-KAYNAKLARI.txt missing — attribution not recorded"); }
    const zayif = (konu.sahneler || []).filter((s) => s.kaynakMeta && s.kaynakMeta.alaka != null && s.kaynakMeta.alaka < 0.34).length;
    if (zayif) { p -= 5 * zayif; not.push(`${zayif} scene(s) with weak search relevance (fallback footage)`); }
  }
  return { puan: sinirla(p), notlar: not };
}

function probe(dosya) {
  const FP = require("./ff-yol").ffprobe;
  const j = JSON.parse(cp.execFileSync(FP, ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", dosya]).toString());
  const vs = (j.streams || []).find((s) => s.codec_type === "video") || {};
  return { w: vs.width, h: vs.height, sure: +(j.format || {}).duration, ses: (j.streams || []).some((s) => s.codec_type === "audio") };
}

function gorsel(konu, final, format) {
  const not = [];
  if (!final) {
    const eksik = (konu.sahneler || []).filter((s) => !s.kaynak && !s.arama).length;
    return { puan: eksik ? 60 : 80, notlar: ["not rendered yet — source plan only", ...(eksik ? [`${eksik} scene(s) without a source or search term`] : [])], olculmedi: true };
  }
  const vid = path.join(KOK, "uretim", konu.slug, "Videos", konu.slug + ".mp4");
  if (!fs.existsSync(vid)) return { puan: 0, notlar: ["rendered video missing"] };
  let p = 100, kritik = null;
  const pr = probe(vid);
  const hedef = format === "short" ? [1080, 1920] : [1920, 1080];
  if (pr.w !== hedef[0] || pr.h !== hedef[1]) { p -= 30; not.push(`resolution ${pr.w}x${pr.h}, expected ${hedef.join("x")}`); }
  if (format === "short" && pr.sure > 60) { p -= 40; not.push(`${pr.sure.toFixed(1)} s — over the Shorts limit`); }
  if (format === "short" && pr.sure > 58 && pr.sure <= 60) { p -= 5; not.push("very close to 60 s"); }
  if (!pr.ses) { p -= 100; kritik = "MISSING NARRATION/AUDIO STREAM"; not.push(kritik); }
  const tekrar = {};
  for (const s of konu.sahneler || []) if (s.kaynak) tekrar[s.kaynak] = (tekrar[s.kaynak] || 0) + 1;
  const stokTekrar = konu.tur === "stok" ? Object.values(tekrar).filter((n) => n > 1).length : 0;
  if (stokTekrar) { p -= 10 * stokTekrar; not.push(`${stokTekrar} stock clip(s) reused within the video`); }
  const eng = fs.existsSync(path.join(KOK, "uretim", konu.slug, "Videos", "muhendislik-katmani.json"));
  if (!eng) { p -= 5; not.push("no engineering overlay rendered"); }
  // Yayin oncesi gorsel denetim (shorts-yap.js olcer): yazi tasmasi, siyah kare, donmus goruntu
  const d = jsonOku(path.join(KOK, "uretim", konu.slug, "Videos", "denetim.json"), null);
  if (!d) { p -= 100; kritik = kritik || "PRE-PUBLISH VISUAL/CAPTION CHECK MISSING"; not.push(kritik); }
  else {
    if (d.captionBurned !== true || !d.captionEvents) { p -= 100; kritik = kritik || "MISSING BURNED CAPTIONS"; not.push("burned caption evidence missing"); }
    if ((d.captionMaxWords || 0) > 3 || (d.captionMaxLines || 0) > 2) { p -= 60; kritik = kritik || "CAPTIONS EXCEED MOBILE DENSITY LIMIT"; not.push(`${d.captionMaxWords} words / ${d.captionMaxLines} lines`); }
    if (d.yaziTasmasi === "olculemedi") { p -= 60; kritik = kritik || "CAPTION SAFE ZONE COULD NOT BE MEASURED"; not.push("text overflow could not be measured"); }
    else if (d.yaziTasmasi > 0) { p -= 60; kritik = `TEXT OVERFLOW in ${d.yaziTasmasi} frame(s) even after shrinking`; not.push(kritik); }
    if (d.sureFarki == null) { p -= 10; not.push("audio/video duration not measured"); }
    else if (d.sureFarki > 0.5) { p -= 60; kritik = kritik || `AUDIO/VIDEO LENGTH MISMATCH ${d.videoSure}s vs ${d.sesSure}s`; not.push(`audio/video mismatch ${d.sureFarki}s`); }
    if (d.siyahToplam > 1.5) { p -= 40; kritik = kritik || `BLACK FRAMES ${d.siyahToplam}s`; not.push(`black frames ${d.siyahToplam}s`); }
    else if (d.siyahToplam > 0.4) { p -= 15; not.push(`black frames ${d.siyahToplam}s`); }
    if (d.donukEnUzun > 4) { p -= 15; not.push(`frozen picture ${d.donukEnUzun}s`); }
    if (d.yaziOlcegi && d.yaziOlcegi < 1) not.push(`text auto-shrunk to ${Math.round(d.yaziOlcegi * 100)}% to fit`);
  }
  const unrelated = (konu.sahneler || []).filter((s) => s.kaynakMeta && s.kaynakMeta.alaka != null && s.kaynakMeta.alaka < 0.15).length;
  if (unrelated) { p -= 100; kritik = kritik || `OBVIOUSLY UNRELATED VISUALS: ${unrelated} scene(s)`; not.push(kritik); }
  return { puan: sinirla(p), notlar: not, olcum: pr, kritik };
}

function ses(konu, final) {
  if (!final) return { puan: 75, notlar: ["not rendered yet — measured at the final gate"], olculmedi: true };
  const vid = path.join(KOK, "uretim", konu.slug, "Videos", konu.slug + ".mp4");
  if (!fs.existsSync(vid)) return { puan: 0, notlar: ["rendered video missing"] };
  const FF = require("./ff-yol").ffmpeg;
  const r = cp.spawnSync(FF, ["-hide_banner", "-nostats", "-i", vid, "-af", "loudnorm=I=-16:TP=-1.5:print_format=json,silencedetect=noise=-45dB:d=1.2", "-f", "null", "-"], { encoding: "utf8" });
  const err = r.stderr || "";
  const js = err.slice(err.lastIndexOf("{"), err.lastIndexOf("}") + 1);
  let olcum = null; try { olcum = JSON.parse(js); } catch (e) {}
  const not = [];
  let p = 100;
  if (!olcum) return { puan: 50, notlar: ["loudness could not be measured"] };
  const I = +olcum.input_i, TP = +olcum.input_tp;
  if (Math.abs(I + 15) > 3) { p -= Math.min(40, Math.round((Math.abs(I + 15) - 3) * 8)); not.push(`integrated loudness ${I} LUFS (target −14…−16)`); }
  if (TP > -1) { p -= 15; not.push(`true peak ${TP} dBTP (> −1)`); }
  const sessiz = (err.match(/silence_duration: ([\d.]+)/g) || []).length;
  if (sessiz) { p -= 10 * sessiz; not.push(`${sessiz} silent gap(s) over 1.2 s`); }
  return { puan: sinirla(p), notlar: not, olcum: { I, TP, sessiz } };
}

// ---------------- ana degerlendirme ----------------
function degerlendir(slug, ops = {}) {
  const final = !!ops.final;
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const format = K.formatBul(konu);
  const g = ayar().qualityGate;
  // Alt motorlar paketleme dosyalarini da yazar (izlenebilirlik)
  const titles = require("./title-engine").calistir(slug);
  const thumbs = require("./thumbnail-strategy").calistir(slug);
  const hook = require("./hook-engine").calistir(slug);
  const tel = require("./pronunciation-check").calistir(slug);
  const org = require("./originality-check").calistir(slug);
  const b = {
    title: { puan: Math.round(sinirla((titles.secilenPuan - 20) / 50 * 100)), notlar: [`"${titles.secilen}" (engine ${titles.secilenPuan})`] },
    thumbnail: { puan: thumbs.puan, notlar: thumbs.konseptler.filter((c) => !c.mobil.gecti).map((c) => `${c.id}: ${c.mobil.sorunlar.join(", ")}`) },
    hook: { puan: hook.mevcut.puan, notlar: hook.mevcut.bulgular.filter((x) => /missing|no |long|BLOCKER|too/.test(x)) },
    script: senaryo(konu, tel, format),
    originality: { puan: org.originality, notlar: org.bayraklar.map((x) => `${x.metrik} ${x.deger} ≥ ${x.esik}${x.kim ? " (vs " + x.kim + ")" : ""}`) },
    visual: gorsel(konu, final, format),
    engineering: muhendislik(konu),
    source: kaynak(konu, final),
    audio: ses(konu, final),
  };
  const w = { ...g.weights };
  if (format === "short") w.thumbnail = (w.thumbnail || 1) * 0.5;   // Shorts akisi video karesini gosterir
  const tw = Object.values(w).reduce((a, x) => a + x, 0);
  const toplam = Math.round(Object.entries(w).reduce((a, [k, x]) => a + b[k].puan * x, 0) / tw);
  const engel = [];
  if (titles.adaySayisi < 20) engel.push(`TITLE: only ${titles.adaySayisi} candidates; minimum 20`);
  if (format === "long" && thumbs.konseptler.length < 5) engel.push(`THUMBNAIL: only ${thumbs.konseptler.length} concepts; minimum 5`);
  if (/\b(?:TODO|TBD|PLACEHOLDER|LOREM IPSUM)\b/i.test(K.anlati(konu))) engel.push("SCRIPT: placeholder content");
  if (hook.mevcut.engelleyici) engel.push("HOOK: forbidden opening");
  if (org.aksiyon === "BLOCK") engel.push("ORIGINALITY: near-duplicate of " + org.engelleyen.join(", "));
  for (const [k, esik] of Object.entries(g.hardBlocks || {})) if (b[k] && !b[k].olculmedi && b[k].puan < esik) engel.push(`${EN[k]} ${b[k].puan} < ${esik}`);
  // Gorsel denetimde kritik hata (tasan yazi, uzun siyah kare) = yayinlanmaz
  if (b.visual.kritik) engel.push("VISUAL CHECK: " + b.visual.kritik);
  let karar = engel.length ? "BLOCK" : toplam >= g.publish ? "PUBLISH" : toplam >= g.review ? "REVIEW" : "BLOCK";
  if (karar === "PUBLISH" && org.aksiyon === "REVIEW") karar = "REVIEW";      // tekrar isareti varsa insan baksin
  const r = { slug, asama: final ? "final" : "pre", format, karar, toplam, esikler: { publish: g.publish, review: g.review },
    engelleyen: engel, bilesenler: b, tarih: new Date().toISOString() };
  jsonYaz(K.paketYolu(slug, "quality-gate.json"), r);
  metinYaz(K.paketYolu(slug, "quality-gate.md"), rapor(r));
  K.kaliteKaydet({ slug, asama: r.asama, karar, toplam, tarih: r.tarih });
  return r;
}

function rapor(r) {
  const s = [`# Quality gate — ${r.slug} (${r.asama})`, "", `**${r.karar}** — ${r.toplam}/100 (PUBLISH ≥ ${r.esikler.publish}, REVIEW ≥ ${r.esikler.review})`, ""];
  if (r.engelleyen.length) s.push("Blocked by: " + r.engelleyen.join("; "), "");
  s.push("| Component | Score | Notes |", "|---|---:|---|");
  for (const [k, v] of Object.entries(r.bilesenler)) s.push(`| ${EN[k]} | ${v.puan}${v.olculmedi ? " (est.)" : ""} | ${(v.notlar || []).join("; ")} |`);
  s.push("", "_Scores are editorial heuristics plus real measurements (loudness, resolution, duration) at the final stage. They guide review; they do not predict views._");
  return s.join("\n");
}

module.exports = { degerlendir, EN };

if (require.main === module) {
  const arg = SELECTED.argv[0];
  if (!arg) { console.error("Kullanim: node quality-gate.js <slug> [--final] | --all"); process.exit(1); }
  const final = SELECTED.argv.includes("--final");
  let engel = false;
  for (const s of arg === "--all" ? K.konular().map((k) => k.slug) : [arg]) {
    const r = degerlendir(s, { final });
    if (r.karar === "BLOCK") engel = true;
    const kisa = Object.entries(r.bilesenler).map(([k, v]) => `${k.slice(0, 4)}:${v.puan}`).join(" ");
    console.log(`${s.padEnd(28)} ${r.karar.padEnd(7)} ${String(r.toplam).padStart(3)}  ${kisa}${r.engelleyen.length ? "  ✗ " + r.engelleyen.join("; ") : ""}`);
  }
  // Tek video modunda BLOCK = cikis kodu 4 (production.py publish yuklemeyi durdurur)
  if (arg !== "--all" && engel) process.exitCode = 4;
}
