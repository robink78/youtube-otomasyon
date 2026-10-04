// STORY STRUCTURE — uyarlanabilir belgesel yapisi + acik donguler + baglamsal CTA.
//
// Her konuyu ayni bolum sirasina zorlamaz. Vaka dosyasinda HANGI kanit varsa
// o bolum acilir (uyari isaretleri yoksa "WARNING SIGNS" bolumu yazilmaz) ve
// hikaye tipine gore siralama degisir:
//   chronological  olay -> beklenen -> uyarilar -> ariza -> sorusturma -> neden
//   investigation  soguk acilis sonuc -> sorusturma -> geriye donus -> neden
//   explainer      (mekanizma konulari) gunluk risk -> normal isleyis -> ariza -> gercek ornek
//
// Acik donguler: gercek bir soruyu erken acar ve MUTLAKA sonra kapatir (sahte gerilim yok).
// CTA (ctaStrategy: none | mid | end | adaptive): yalnizca deger verildikten sonra.
//
// Kullanim: node story-structure.js <slug> [--sure <saniye>]  ->  icerik/paket/<slug>/story.json
"use strict";
const path = require("path");
const { KOK, jsonOku, jsonYaz, sec } = require("./lib/ortak");
const { ayar } = require("./lib/ayar");
const K = require("./lib/kutuphane");

const BOLUM = {
  COLD_OPEN: "COLD OPEN", EVENT: "THE EVENT", EXPECTED: "WHAT ENGINEERS EXPECTED", WARNINGS: "THE WARNING SIGNS",
  FAILURE: "THE FAILURE", INVESTIGATION: "THE INVESTIGATION", CAUSE: "THE TECHNICAL CAUSE", HUMAN: "THE HUMAN/ORGANIZATIONAL FACTOR",
  CHANGED: "WHAT CHANGED AFTERWARD", LESSON: "FINAL LESSON",
  STAKES: "WHY IT MATTERS TO YOU", NORMAL: "HOW IT NORMALLY WORKS", REAL: "A REAL CASE",
};

const CTA_METIN = [
  "If you like engineering failures reconstructed from the evidence, subscribe to Failure Reconstructed.",
  "Failure Reconstructed rebuilds disasters like this one from the record. If that's the kind of documentary you want more of, subscribe.",
  "Every episode here takes one failure apart, piece by piece. Subscribe if you want the next reconstruction.",
];

function tipBul(v) {
  if (v.tip !== "vaka") return "explainer";
  if (v.sorusturma || (v.yanilgi && /investigat|evidence|report/i.test(v.yanilgi))) return "investigation";
  return "chronological";
}

function bolumler(konu) {
  const v = konu.vaka || {};
  const tip = tipBul(v);
  const var_ = {
    EXPECTED: !!(v.beklenen || v.tip === "vaka"),
    WARNINGS: !!((v.uyarilar && v.uyarilar.length) || (v.zaman || []).length >= 3),
    INVESTIGATION: !!(v.sorusturma || (v.kaynakca || []).length),
    HUMAN: !!(v.karar || v.insan),
    CHANGED: !!v.ders,
  };
  let sira;
  if (tip === "explainer") sira = ["COLD_OPEN", "STAKES", "NORMAL", "FAILURE", "CAUSE", "REAL", "CHANGED", "LESSON"];
  else if (tip === "investigation") sira = ["COLD_OPEN", "INVESTIGATION", "EVENT", "EXPECTED", "WARNINGS", "FAILURE", "CAUSE", "HUMAN", "CHANGED", "LESSON"];
  else sira = ["COLD_OPEN", "EVENT", "EXPECTED", "WARNINGS", "FAILURE", "INVESTIGATION", "CAUSE", "HUMAN", "CHANGED", "LESSON"];
  sira = sira.filter((b) => !(b in var_) || var_[b]);
  if (tip === "explainer" && !v.ornekVaka) sira = sira.filter((b) => b !== "REAL");
  return { tip, sira: sira.map((id) => ({ id, ad: BOLUM[id] })) };
}

// Acik donguler — vaka verisinden, her biri acildigi bolumden SONRA kapanir.
function donguler(konu, sira) {
  const v = konu.vaka || {};
  const idx = (id) => sira.findIndex((b) => b.id === id);
  const l = [];
  const ekle = (acBolum, kapatBolum, ac, kapat) => {
    const a = idx(acBolum), k = idx(kapatBolum);
    if (a >= 0 && k > a) l.push({ acBolum, kapatBolum, ac, kapat });
  };
  if (v.yanilgi) ekle(sira.some((b) => b.id === "EVENT") ? "EVENT" : "COLD_OPEN", "CAUSE",
    "The explanation most people know is not quite what the evidence shows.", v.yanilgi);
  if (v.tetik && v.mekanizma) ekle(sira.some((b) => b.id === "FAILURE") ? "FAILURE" : "COLD_OPEN", "CAUSE",
    `${v.tetik.charAt(0).toUpperCase() + v.tetik.slice(1)} should not have been enough. So what turned it into a failure?`, `The answer was ${v.mekanizma}.`);
  if (v.karar && v.karar.metin) ekle("WARNINGS", "HUMAN", "And there was a moment when this could still have been stopped.", v.karar.metin);
  return l;
}

// CTA yerlesimi. adaptive: kisa formatta konusulan CTA yok; uzun formatta
// analitik varsa ortalama izlenme yuzdesine gore, yoksa sureye gore.
function cta(konu, sureSn, sira, analitik = null) {
  const format = K.formatBul(konu);
  let strateji = ayar().ctaStrategy || "adaptive";
  let neden = "config";
  if (strateji === "adaptive") {
    if (format === "short") { strateji = "none"; neden = "Shorts: a spoken CTA costs retention; the on-screen question + pinned comment convert instead"; }
    else if (analitik && analitik.averageViewPercentage != null) {
      strateji = analitik.averageViewPercentage < 35 ? "mid" : analitik.averageViewPercentage > 55 ? "end" : "mid+end";
      neden = `channel average viewed ${analitik.averageViewPercentage}% — ` + (strateji === "mid" ? "most viewers never reach the end" : "viewers reach the end");
    } else { strateji = (sureSn || 0) >= 480 ? "mid+end" : "end"; neden = "no analytics yet — by length"; }
  }
  const nokta = [];
  const causeIdx = sira.findIndex((b) => b.id === "CAUSE");
  if (/mid/.test(strateji)) nokta.push({ konum: "after " + (causeIdx >= 0 ? sira[causeIdx].ad : "the first payoff"), hedefYuzde: [30, 60], bolum: causeIdx >= 0 ? sira[causeIdx].id : null });
  if (/end/.test(strateji)) nokta.push({ konum: "before " + BOLUM.LESSON + " closes (after the payoff)", hedefYuzde: [85, 95], bolum: "LESSON" });
  // Onceki bolumle ayni cumleyi tekrarlama: slug'a gore deterministik secim
  return { strateji, neden, noktalar: nokta, metin: nokta.length ? sec(CTA_METIN, konu.slug) : null,
    yasak: "never in the first 30 seconds; never 'like and subscribe' without context" };
}

// Kanal genelinde tekrar eden kapanis kalibi ("That is why ...") sayisi
function kapanisTekrari() {
  return K.konular().filter((k) => /\b(that is why|that's why)\b/i.test((k.sahneler || []).slice(-2).map((x) => x.metin).join(" "))).length;
}

// Senaryo yazari (insan ya da senaryo-claude.js) icin brif
function brif(konu, sureSn) {
  const b = bolumler(konu);
  const d = donguler(konu, b.sira);
  const c = cta(konu, sureSn, b.sira);
  const h = require("./hook-engine").oner(konu);
  const kliseler = (jsonOku(path.join(KOK, "config", "pronunciation.json"), {}).cliches || []);
  return [
    `STRUCTURE (${b.tip}; adapt, don't pad — skip a section if the evidence for it doesn't exist):`,
    ...b.sira.map((x, i) => `${i + 1}. ${x.ad}`),
    "", "FIRST 30 SECONDS (write it separately from the rest):",
    "0-5s the event/result · 5-12s an unexpected detail · 12-20s the central problem · 20-30s what the viewer will understand by the end.",
    h ? "Draft from the case file: " + h.metin : "",
    "Never open with a welcome, the channel name, 'in today's video', a biography or background history.",
    "", "OPEN LOOPS (open early, resolve exactly where stated; no fake suspense):",
    ...(d.length ? d.map((x) => `- in ${BOLUM[x.acBolum]}: "${x.ac}" → resolve in ${BOLUM[x.kapatBolum]}: ${x.kapat}`) : ["- none required"]),
    "", `CTA: ${c.strateji} (${c.neden})` + (c.metin ? ` — say once, ${c.noktalar.map((n) => n.konum).join(" and ")}: "${c.metin}"` : ""),
    "", "STYLE: documentary narration — concrete nouns, numbers with units, named mechanisms. No AI clichés: " + kliseler.slice(0, 14).map((k) => `"${k}"`).join(", ") + ".",
    `Vary the closing line: ${kapanisTekrari()} channel episodes already end on "That is why…" — find a different final beat.`,
  ].filter((x) => x !== undefined).join("\n");
}

// Bolum isaretli bir senaryoda (## BOLUM ADI satirlari) acik dongulerin kapandigini denetle
function donguDenetle(senaryo, plan) {
  const bolumSira = [...String(senaryo).matchAll(/^##\s*(.+)$/gm)].map((m) => m[1].trim().toUpperCase());
  return plan.map((d) => {
    const a = bolumSira.indexOf(BOLUM[d.acBolum]), k = bolumSira.indexOf(BOLUM[d.kapatBolum]);
    return { ...d, durum: a < 0 || k < 0 ? "section missing" : k > a ? "resolved" : "resolved before opened" };
  });
}

function calistir(slug, sureSn) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const b = bolumler(konu);
  const r = { slug, tip: b.tip, bolumler: b.sira, acikDonguler: donguler(konu, b.sira), cta: cta(konu, sureSn, b.sira), brif: brif(konu, sureSn) };
  jsonYaz(K.paketYolu(slug, "story.json"), r);
  return r;
}

module.exports = { bolumler, donguler, cta, brif, donguDenetle, calistir, BOLUM, CTA_METIN };

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) { console.error("Kullanim: node story-structure.js <slug> [--sure <sn>]"); process.exit(1); }
  const i = process.argv.indexOf("--sure");
  const r = calistir(slug, i > 0 ? +process.argv[i + 1] : null);
  console.log(r.brif);
}
