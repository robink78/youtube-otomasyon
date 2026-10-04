// HOOK ENGINE — ilk 30 saniyeyi videonun geri kalanindan AYRI ele alir.
//
// Yapi (uzun format):  0-5s olay/sonuc · 5-12s beklenmedik ayrinti ·
//                      12-20s merkezi gizem/sorun · 20-30s izleyiciye vaat
// Shorts'ta ayni mantik sikisir: ilk cumle sonuc, ikinci cumle beklenmedik
// ayrinti, ~12. saniyeye kadar soru/gerilim.
//
// Yasak acilislar: "Welcome to...", "In today's video...", logo/kanal adi,
// biyografi/tarihce ile baslamak, acilista abone CTA'si.
//
// Kullanim: node hook-engine.js <slug> | --all
// Cikti:    icerik/paket/<slug>/hook.json
"use strict";
const { sinirla, jsonYaz } = require("./lib/ortak");
const M = require("./lib/metin");
const K = require("./lib/kutuphane");

const KELIME_SN = 2.75;   // Andrew +%6 ~165 kel/dk (olculen); pencere hesaplari icin
const YASAK = [
  [/\bwelcome (to|back)\b/i, "opens with a channel welcome"],
  [/\bin (today'?s|this) video\b/i, "announces the video instead of starting the story"],
  [/\b(hey|hi|hello) (guys|everyone|there)\b/i, "greeting instead of story"],
  [/\bfailure reconstructed\b/i, "channel name in the opening"],
];
const CTA = /\b(subscribe|like (and|&) subscribe|hit the bell|smash|follow for more)\b/i;
const TARIHCE = /^(in \d{3,4}\b|back in|long ago|throughout history|for centuries|born in|once upon|it all started|to understand)/i;
const SOK = /\b(tore|destroy\w*|collaps\w*|explod\w*|burn\w*|kill\w*|dead|die[ds]?|poison\w*|swallow\w*|flatten\w*|fell|drop\w*|crash\w*|sink|sank|shatter\w*|twist\w*|caught on film|largest|biggest|deadliest|most famous|faster|hotter|million|billion|thousand)\b/i;
const BEKLENMEDIK = /\b(not|wasn'?t|isn'?t|but|only|never|still|real time|no one|nobody|just|single|tiny|even|actually|instead|almost)\b/i;
const GIZEM = /\?|\b(why|how|what|reason|cause|mystery|secret|hidden|quiet|silent|invisible|no warning|nobody knew)\b/i;
const VAAT = /\b(reason|why|how|changed|forever|this is|here is|what (investigators|engineers)|the answer|that is why|lesson)\b/i;

// Metni zaman pencerelerine bol (kelime/saniye tahmini)
function pencereler(metin) {
  const w = String(metin).split(/\s+/).filter(Boolean);
  const kes = (a, b) => w.slice(Math.round(a * KELIME_SN), Math.round(b * KELIME_SN)).join(" ");
  return { "0-5": kes(0, 5), "5-12": kes(5, 12), "12-20": kes(12, 20), "20-30": kes(20, 30) };
}

function puanla(anlati, ekranHook, format = "short") {
  const ilk = M.cumleler(anlati)[0] || "";
  const p = pencereler(anlati);
  const acilis = p["0-5"] + " " + p["5-12"] + " " + p["12-20"] + " " + p["20-30"];
  const bulgular = [];
  let puan = 30;
  for (const [re, neden] of YASAK) if (re.test(p["0-5"] + " " + p["5-12"])) { puan -= 40; bulgular.push("BLOCKER: " + neden); }
  if (CTA.test(acilis)) { puan -= 30; bulgular.push("BLOCKER: subscribe CTA inside the first 30 seconds"); }
  if (TARIHCE.test(ilk.trim())) { puan -= 15; bulgular.push("starts with background/history instead of the event"); }

  if (SOK.test(p["0-5"]) || /\d/.test(p["0-5"])) { puan += 20; bulgular.push("0-5s: lands the event/result immediately"); }
  else bulgular.push("0-5s: no event or result in the first sentence");
  const ilkUzunluk = M.kelimeSay(ilk);
  if (ilkUzunluk <= (format === "short" ? 14 : 20)) puan += 10;
  else bulgular.push(`first sentence is long (${ilkUzunluk} words)`);
  if (BEKLENMEDIK.test(p["5-12"]) || /\d/.test(p["5-12"])) { puan += 15; bulgular.push("5-12s: unexpected detail/contrast present"); }
  else bulgular.push("5-12s: missing an unexpected detail");
  if (GIZEM.test(p["12-20"] + " " + p["5-12"])) { puan += 15; bulgular.push("12-20s: a central question/problem is raised"); }
  else bulgular.push("12-20s: no central mystery or problem is posed");
  if (format === "long") {
    if (VAAT.test(p["20-30"])) { puan += 15; bulgular.push("20-30s: viewer promise present"); }
    else bulgular.push("20-30s: no promise of what the viewer will learn");
  } else if (VAAT.test(anlati)) { puan += 10; bulgular.push("payoff line present (why/how/reason)"); }

  if (ekranHook) {
    const n = M.kelimeSay(ekranHook);
    if (n >= 2 && n <= 5) { puan += 10; bulgular.push(`on-screen hook is ${n} words (readable in <1s)`); }
    else if (n > 6) { puan -= 10; bulgular.push(`on-screen hook too long (${n} words)`); }
  }
  return { puan: sinirla(puan, 0, 100), pencereler: p, bulgular, engelleyici: bulgular.some((b) => b.startsWith("BLOCKER")) };
}

// Vaka verisinden 4 zamanli hook taslagi (uzun format ya da yeniden paketleme icin).
function oner(konu) {
  const v = konu.vaka || {};
  const cumle = M.cumleler(K.anlati(konu));
  if (!v.ad || !v.sonuc) return null;
  const Ad = M.buyukHarf(v.ad);
  const s0 = v.tip === "vaka" ? `${Ad} ${v.sonuc}.` : (cumle[0] || `${Ad} ${v.sonuc}.`);
  const s1 = v.tetik ? `It took only ${v.tetik}.` : (cumle[1] || "");
  const s2 = v.tip === "vaka" ? `So how could ${v.tetik || "something so small"} do this?` : `So what actually happens inside?`;
  const s3 = v.mekanizma ? `The answer is ${v.mekanizma}${v.ders ? " — and it is why " + v.ders : ""}.` : "";
  const segmentler = [{ pencere: "0-5s", rol: "event/result", metin: s0 }, { pencere: "5-12s", rol: "unexpected detail", metin: s1 },
    { pencere: "12-20s", rol: "central problem", metin: s2 }, { pencere: "20-30s", rol: "viewer promise", metin: s3 }];
  return { segmentler, metin: segmentler.map((s) => s.metin).filter(Boolean).join(" ") };
}

function degerlendir(konu) {
  const format = K.formatBul(konu);
  const mevcut = puanla(K.anlati(konu), konu.hook, format);
  const taslak = oner(konu);
  const taslakPuan = taslak ? puanla(taslak.metin + " " + K.anlati(konu), konu.hook, format) : null;
  return { slug: konu.slug, format, olusturuldu: new Date().toISOString(), ekranHook: konu.hook || null,
    mevcut, oneri: taslak ? { ...taslak, puan: taslakPuan.puan } : null,
    not: "Suggestions are drafts built from the case file; narration stays editorial — never auto-replaced." };
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const r = degerlendir(konu);
  jsonYaz(K.paketYolu(slug, "hook.json"), r);
  return r;
}

module.exports = { puanla, oner, degerlendir, calistir, pencereler };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error("Kullanim: node hook-engine.js <slug> | --all"); process.exit(1); }
  for (const s of arg === "--all" ? K.konular().map((k) => k.slug) : [arg]) {
    const r = calistir(s);
    console.log(`${s.padEnd(30)} hook ${String(r.mevcut.puan).padStart(3)}/100` + (r.mevcut.engelleyici ? "  BLOCKER" : "") +
      (arg !== "--all" ? "\n  " + r.mevcut.bulgular.join("\n  ") + (r.oneri ? "\n  oneri: " + r.oneri.metin : "") : ""));
  }
}
