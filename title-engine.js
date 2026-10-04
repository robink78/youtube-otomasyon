// TITLE ENGINE — belgesel paketleme motoru (SEO-yalniz baslik yerine).
//
// Her video icin >=20 anlamli aday uretir: editoryal adaylar (konu.vaka.basliklar),
// mevcut baslik ve vaka verisinden kurulan sablonlar. Her aday 11 olcutle
// puanlanir ve TUM puanlama ayrintisi saklanir (icerik/paket/<slug>/titles.json).
//
// Ilke: baslik belgeselin DESTEKLEDIGI bir iddia olmali. Baslikta gecen icerik
// kelimeleri senaryoda/vaka dosyasinda yoksa "clickbait riski" artar ve baslik
// geriye duser. Anahtar kelimeyi tekrar eden kuru basliklar ("X Explained")
// cezalandirilir. Puanlar sezgiseldir (heuristic) — analitik biriktikce
// experiments.js ile hangi baslik kalibinin kazandigi olculur.
//
// Kullanim: node title-engine.js <slug> | --all   [--quiet]
"use strict";
const { sinirla, yuvarla } = require("./lib/ortak");
const M = require("./lib/metin");
const K = require("./lib/kutuphane");

const GERILIM = /\b(tore|tear|torn|destroy\w*|collaps\w*|explod\w*|explosion|burn\w*|kill\w*|deadly|poison\w*|sank|sink|fell|fall|fail\w*|warning|seconds?|minutes?|ignored|knew|anyway|trap|doom\w*|apart|rip\w*|crush\w*|flatten\w*|swallow\w*|wreck\w*|gone|disaster|blast|shatter\w*|capsiz\w*|twist\w*)\b/gi;
const SONUCLU = /\b(destroy\w*|kill\w*|flatten\w*|sank|ended|changed|forever|never|gone|poison\w*|wreck\w*|apart|down|collaps\w*|dead|lost)\b/gi;
const MERAK = /\b(why|how|what|real reason|the moment|nobody|didn't|don't|never|only|one|hidden|inside)\b/gi;
const MUHENDISLIK = /\b(engineer\w*|design\w*|bridge|dam|structure\w*|force|load|wind|pressure|steel|concrete|fail\w*|collaps\w*|flaw|crack\w*|physics|stabil\w*|metal|glass|tank|valve|sensor|wall|roof|pillar|hydrogen|shockwave|grid|flutter|fatigue)\b/gi;
const ABARTI = /\b(shocking|insane|unbelievable|you won'?t believe|secret|exposed|gone wrong|epic|terrifying truth|must see)\b/i;
const SABLON_KELIME = new Set("real reason moment really actually engineering behind inside what why how that then just didn't one".split(" "));

const say = (s, re) => (String(s).match(re) || []).length;

// ---------------- aday uretimi ----------------
function sablonlar(konu) {
  const v = konu.vaka || {};
  const B = M.baslikBicim;
  const out = [];
  const ekle = (b, kaynak) => { if (b && !/undefined|null/.test(b)) out.push({ baslik: B(b.replace(/\s+/g, " ").trim()), kaynak }); };
  // Mekanizma etiketi: parantez icindeki yaygin ad daha okunur ("Rebar Corrosion (Concrete Cancer)" -> "Concrete Cancer")
  const mekEtiket = v.mekanizma ? ((v.mekanizma.match(/\(([^)]+)\)/) || [])[1] || v.mekanizma) : "";
  if (v.tip === "vaka" && v.ad && v.sonuc) {
    const Ad = M.buyukHarf(v.ad), nesne = v.nesne || "System";
    // Olay isimleri (test, sehir, volkan) "bozulan sistem" degildir: "didn't just fail",
    // "what destroyed" gibi kaliplar onlar icin yanlis bir iddia kurar.
    const sistem = !/^(test|city|harbor|volcano|explosion|earthquake|eruption|storm)$/i.test(nesne);
    ekle(`The ${nesne} That ${v.sonuc}`, "template:object-that-result");
    if (sistem) ekle(`${Ad} Didn't Just Fail — It ${v.sonuc}`, "template:didnt-just-fail");
    ekle(`The Real Reason ${v.ad} ${v.sonuc}`, "template:real-reason");
    if (v.yil) ekle(`${v.yil}: ${Ad} ${v.sonuc}`, "template:year-result");
    if (v.sayi && /\d/.test(v.sayi)) ekle(`${v.sayi}. That's All It Took`, "template:number-all-it-took");
    if (sistem) ekle(`What Really Destroyed ${v.ad}`, "template:what-really");
    if (sistem && mekEtiket && mekEtiket.split(" ").length <= 3) ekle(`${M.buyukHarf(mekEtiket)}: The Force That Destroyed ${v.ad}`, "template:mechanism-force");
    if (sistem && v.tetik) ekle(`How ${v.tetik} Brought Down ${v.ad}`, "template:how-trigger");
    if (sistem) ekle(`Why ${v.ad} Failed`, "template:plain-why");
    ekle(`Inside ${Ad}: The Failure Chain`, "template:inside-chain");
    ekle(`${Ad}: What Failed First`, "template:failed-first");
    ekle(`How ${Ad} Became ${v.sonuc}`, "template:how-became");
    ekle(`${Ad}: The Engineering Behind the Failure`, "template:engineering-behind");
    ekle(`The Chain Reaction Behind ${v.ad}`, "template:chain-reaction");
    ekle(`What Engineers Learned From ${v.ad}`, "template:lesson");
    if ((v.zincir || []).length >= 3) ekle(`${Ad}: ${(v.zincir || []).length} Failures in Sequence`, "template:failure-count");
    if (mekEtiket) ekle(`${Ad}: How ${M.buyukHarf(mekEtiket)} Took Over`, "template:mechanism-took-over");
    if (v.tetik) ekle(`The Trigger That Started ${v.ad}`, "template:trigger-started");
    if (v.sayi) ekle(`${v.sayi}: The Scale of ${v.ad}`, "template:number-scale");
    ekle(`${Ad}: Cause, Chain, Consequence`, "template:cause-chain-consequence");
    ekle(`The First Failure Inside ${v.ad}`, "template:first-failure");
    ekle(`${v.kisa || Ad} Explained`, "baseline:seo-keyword");
  } else if (v.ad && v.sonuc) {
    const np = v.ad;
    const olumsuz = /\b(never|don't|doesn't|almost|rarely)\b/i.test(v.sonuc);
    ekle(`Why ${np} ${v.sonuc}`, "template:why-plural");
    if (mekEtiket && mekEtiket.split(" ").length <= 3) ekle(`${M.buyukHarf(mekEtiket)}: Why ${np} ${v.sonuc}`, "template:mechanism-why");
    if (!olumsuz) ekle(`What Actually Happens When ${np} ${v.sonuc}`, "template:what-happens");
    if (!olumsuz) ekle(`What Breaks First When ${np} ${v.sonuc}`, "template:breaks-first");
    if (!olumsuz && mekEtiket && mekEtiket.split(" ").length <= 3) ekle(`${np} ${v.sonuc}. Engineers Call It ${M.buyukHarf(mekEtiket)}.`, "template:engineers-call-it");
    ekle(`The Physics of How ${np} ${v.sonuc}`, "template:physics-of");
    ekle(`Inside the Physics of ${np}`, "template:inside-physics");
    ekle(`${np}: The Failure Sequence`, "template:failure-sequence");
    ekle(`The Force That Makes ${np} ${v.sonuc}`, "template:force-result");
    if (mekEtiket) ekle(`Why ${M.buyukHarf(mekEtiket)} Matters for ${np}`, "template:mechanism-matters");
    ekle(`The First Sign That ${np} ${v.sonuc}`, "template:first-sign");
    ekle(`${np}: What Engineers Watch For`, "template:engineers-watch");
    ekle(`How Engineers Explain Why ${np} ${v.sonuc}`, "template:engineers-explain");
    ekle(`${np}: Cause, Chain, Consequence`, "template:cause-chain-consequence");
    ekle(`One Mechanism Explains Why ${np} ${v.sonuc}`, "template:one-mechanism");
    ekle(`The Engineering Reason ${np} ${v.sonuc}`, "template:engineering-reason");
    ekle(`What Happens First as ${np} ${v.sonuc}`, "template:happens-first");
    ekle(`The Hidden Physics Behind ${np}`, "template:hidden-physics");
    ekle(`${np}: Mechanism vs. Consequence`, "template:mechanism-consequence");
    ekle(`The Sequence Behind ${np}`, "template:sequence-behind");
    ekle(`Engineering ${np}: What Happens Next`, "template:engineering-next");
    ekle(`When ${np} ${v.sonuc}: The Physics`, "template:when-physics");
    ekle(`${np}: From First Sign to Final Failure`, "template:first-to-final");
    ekle(`${np} Explained`, "baseline:seo-keyword");
  }
  return out;
}

function adaylar(konu) {
  const v = konu.vaka || {};
  const l = [];
  if (konu.baslik) l.push({ baslik: konu.baslik, kaynak: "current" });
  for (const b of v.basliklar || []) l.push({ baslik: b, kaynak: "editorial" });
  l.push(...sablonlar(konu));
  const gor = new Set();
  return l.filter((a) => { const k = a.baslik.toLowerCase(); if (gor.has(k)) return false; gor.add(k); return true; });
}

// Baslik kalibi — kanal genelinde ayni kalip tekrar edince ceza (mekanik aynilik).
function kalip(b) {
  const s = String(b).toLowerCase();
  if (/explained$/.test(s)) return "explained";
  if (/engineers call it/.test(s)) return "engineers-call-it";
  if (/^the physics of/.test(s)) return "physics-of";
  if (/^what (really|actually)/.test(s)) return "what-really";
  if (/^the real reason/.test(s)) return "real-reason";
  if (/^the \w+(\s[\w-]+)? that\b/.test(s)) return "the-x-that";
  if (/^why\b/.test(s)) return "why";
  if (/^how\b/.test(s)) return "how";
  if (/^what\b/.test(s)) return "what";
  if (/^\d|^[^:]+:\s/.test(s)) return "label-colon";
  if (/[.—]\s*\S/.test(s.slice(0, -1))) return "two-beat";
  return "statement";
}

// Diger videolarin SECILMIS basliklarinin kaliplari (yayinlanan + paketlenen)
function kanalKaliplari(haricSlug) {
  const fs = require("fs");
  const say = {};
  const ekle = (b) => { const k = kalip(b); say[k] = (say[k] || 0) + 1; };
  for (const y of K.yayinlananlar()) if (y.slug !== haricSlug && y.baslik) ekle(y.baslik);
  if (fs.existsSync(K.YOL.paket)) for (const s of fs.readdirSync(K.YOL.paket)) {
    if (s === haricSlug || K.yayinlananlar().some((y) => y.slug === s)) continue;
    const t = require("./lib/ortak").jsonOku(K.paketYolu(s, "titles.json"), null);
    if (t && t.secilen) ekle(t.secilen);
  }
  return say;
}

// ---------------- puanlama ----------------
function destekOrani(baslik, konu) {
  const kaynak = [K.anlati(konu), konu.hook, konu.aciklama, JSON.stringify(konu.vaka || {})].join(" ").toLowerCase();
  const ic = M.icerikKelimeleri(baslik).filter((w) => !SABLON_KELIME.has(w));
  if (!ic.length) return 1;
  const kok = (w) => w.replace(/(ing|ed|es|s)$/, "").slice(0, 6);
  const var_ = ic.filter((w) => kaynak.includes(w) || kaynak.includes(kok(w)));
  return var_.length / ic.length;
}

function puanla(baslik, konu, digerBasliklar = [], format = "short", kaliplar = {}) {
  const v = konu.vaka || {};
  const b = String(baslik);
  const uz = b.length, kel = M.kelimeSay(b);
  const notlar = [];
  const somut = [v.nesne, v.ad, v.kisa, ...(konu.etiketler || []).slice(0, 2)].filter(Boolean)
    .some((x) => M.icerikKelimeleri(x).some((w) => b.toLowerCase().includes(w)));

  let merak = 3 + Math.min(4, say(b, MERAK) * 2) + (/—|\.\s+[A-Z0-9]|\bthen\b|\bbut\b/.test(b) ? 2 : 0) + (/^the \w+(\s\w+)? that /i.test(b) ? 2 : 0);
  if (/explain(ed|ation)?$/i.test(b)) { merak -= 4; notlar.push("ends with 'Explained' — describes the video instead of creating a question"); }

  const idealUst = format === "short" ? 60 : 70;
  let netlik = 10;
  if (uz > idealUst) { netlik -= uz > idealUst + 20 ? 6 : 2; notlar.push(`long for ${format === "short" ? "Shorts feed" : "search/browse"} (${uz} chars)`); }
  if (uz < 22) netlik -= 2;
  if (!somut) { netlik -= 3; notlar.push("no concrete subject — viewer can't tell what failed"); }
  if (kel > 12) netlik -= 2;
  if ((b.match(/[:—.]/g) || []).length > 2) netlik -= 1;

  const gerilim = 3 + Math.min(7, say(b, GERILIM) * 2.5);
  const sonuc = 2 + Math.min(8, say(b, SONUCLU) * 3 + (v.sonuc && M.kelimeBenzerlik(b, v.sonuc) > 0.3 ? 3 : 0));
  let ozgul = 1 + (/\d/.test(b) ? 3 : 0) + (v.yil && b.includes(String(v.yil)) ? 1 : 0);
  if (v.kisa && M.icerikKelimeleri(v.kisa).every((w) => b.toLowerCase().includes(w))) ozgul += 3;
  if (v.mekanizma && M.kelimeBenzerlik(b, v.mekanizma) > 0.3) ozgul += 2;
  ozgul = Math.min(10, ozgul + (M.icerikKelimeleri(b).length >= 4 ? 1 : 0));

  let hitap = 8;
  const jargon = M.kelimeler(b).filter((w) => w.length >= 12 && !/engineering/.test(w));
  if (jargon.length) { hitap -= 3; notlar.push("jargon in title: " + jargon.join(", ")); }
  if (/\b[A-Z]{3,}\b/.test(b.replace(/\b(MPH|WWII|NASA|USA|UK)\b/g, ""))) hitap -= 1;
  if (/\b(you|your|home|city|people|everyone)\b/i.test(b)) hitap += 1;

  const muh = 2 + Math.min(8, say(b, MUHENDISLIK) * 2.5);
  const aramaHedef = [v.kisa, v.ad, (konu.etiketler || [])[0]].filter(Boolean).map((x) => x.toLowerCase().replace(/^the /, ""));
  const arama = aramaHedef.some((x) => b.toLowerCase().includes(x)) ? 10
    : aramaHedef.some((x) => M.kelimeBenzerlik(b, x) >= 0.5) ? 7 : (somut ? 5 : 2);
  const onerilen = yuvarla(0.4 * sinirla(merak, 0, 10) + 0.3 * gerilim + 0.3 * sinirla(hitap, 0, 10), 1);

  let benzerlik = 0, enYakin = null;
  for (const d of digerBasliklar) {
    const s = Math.max(M.trigramBenzerlik(b, d), M.kelimeBenzerlik(b, d));
    if (s > benzerlik) { benzerlik = s; enYakin = d; }
  }

  const destek = destekOrani(b, konu);
  let clickbait = 0;
  if (destek < 0.6) { clickbait += 4; notlar.push(`only ${Math.round(destek * 100)}% of title words are supported by the script`); }
  if (ABARTI.test(b)) { clickbait += 3; notlar.push("hype wording"); }
  if (/!!|\?!/.test(b)) clickbait += 2;
  const buyukKelime = (b.match(/\b[A-Z]{4,}\b/g) || []).filter((w) => !/^(WWII|NASA|MPH)$/.test(w));
  if (buyukKelime.length) clickbait += 2;
  if (/\b(always|everyone|every time)\b/i.test(b) && destek < 0.8) clickbait += 2;

  const k = { curiosity: sinirla(merak, 0, 10), clarity: sinirla(netlik, 0, 10), tension: sinirla(gerilim, 0, 10),
    consequence: sinirla(sonuc, 0, 10), specificity: sinirla(ozgul, 0, 10), appeal: sinirla(hitap, 0, 10),
    engineering: sinirla(muh, 0, 10), search: arama, suggested: onerilen };
  const A = { curiosity: 1.2, clarity: 1.2, tension: 1, consequence: 0.8, specificity: 0.8, appeal: 1, engineering: 1, search: 0.8, suggested: 0.8 };
  const agirlik = Object.values(A).reduce((a, x) => a + x, 0);
  let toplam = Object.entries(A).reduce((a, [ad, w]) => a + k[ad] * w, 0) / agirlik * 10;
  if (benzerlik > 0.5) { toplam -= (benzerlik - 0.5) * 60; notlar.push(`similar to existing title "${enYakin}" (${yuvarla(benzerlik)})`); }
  toplam -= clickbait * 4;
  const kalipSay = kaliplar[kalip(b)] || 0;
  if (kalipSay >= 2) { toplam -= Math.min(20, 3 + (kalipSay - 2) * 5); notlar.push(`title pattern "${kalip(b)}" already used by ${kalipSay} other videos`); }
  const kelimeTekrari = aramaHedef.some((x) => b.toLowerCase().replace(/\b(the|explained|disaster|collapse|failure)\b/g, "").trim() === x);
  if (kelimeTekrari || /explained$/i.test(b)) { toplam -= 10; notlar.push("repeats the keyword instead of packaging the story"); }

  return { baslik: b, kalip: kalip(b), toplam: yuvarla(sinirla(toplam, 0, 100), 1), kriterler: k,
    similarity: { max: yuvarla(benzerlik), closest: enYakin }, clickbaitRisk: sinirla(clickbait, 0, 10),
    supportRatio: yuvarla(destek), notes: notlar };
}

// Diger videolarin basliklari (bu slug haric): konu basliklari + yayinlanmislar
function kanalBasliklari(haricSlug) {
  const l = K.konular().filter((k) => k.slug !== haricSlug).map((k) => k.baslik).filter(Boolean);
  for (const y of K.yayinlananlar()) if (y.slug !== haricSlug && y.baslik) l.push(y.baslik);
  return [...new Set(l)];
}

function degerlendir(konu, opts = {}) {
  const format = opts.format || K.formatBul(konu);
  const diger = opts.digerBasliklar || kanalBasliklari(konu.slug);
  const kaliplar = opts.kaliplar || kanalKaliplari(konu.slug);
  const sonuclar = adaylar(konu).map((a) => ({ ...puanla(a.baslik, konu, diger, format, kaliplar), kaynak: a.kaynak }))
    .sort((a, b) => b.toplam - a.toplam);
  // Secim: yalnizca insan-yazimi adaylar (mevcut + editoryal) otomatik secilir;
  // sablonlar oneri olarak listelenir (dilbilgisi/ton riski). Clickbait riski >=4 asla secilmez.
  const guvenli = sonuclar.filter((s) => s.clickbaitRisk < 4);
  const secilen = guvenli.find((s) => s.kaynak === "current" || s.kaynak === "editorial") || guvenli[0] || sonuclar[0];
  const sablonOnerisi = guvenli.find((s) => s.kaynak.startsWith("template:") && s.toplam >= secilen.toplam + 10) || null;
  const mevcut = sonuclar.find((s) => s.kaynak === "current") || null;
  return { slug: konu.slug, format, olusturuldu: new Date().toISOString(), secilen: secilen.baslik, secilenPuan: secilen.toplam,
    mevcutPuan: mevcut ? mevcut.toplam : null,
    sablonOnerisi: sablonOnerisi ? { baslik: sablonOnerisi.baslik, puan: sablonOnerisi.toplam, not: "template scored 10+ higher — review wording, then add it to vaka.basliklar to allow auto-selection" } : null,
    adaySayisi: sonuclar.length, adaylar: sonuclar,
    yontem: "At least 20 structurally distinct editorial/template candidates; heuristic scoring 0-10 per criterion weighted to /100, minus similarity and clickbait penalties. Not a prediction of CTR." };
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const r = degerlendir(konu);
  require("./lib/ortak").jsonYaz(K.paketYolu(slug, "titles.json"), r);
  return r;
}

module.exports = { adaylar, puanla, degerlendir, calistir, kanalBasliklari, kalip };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error("Kullanim: node title-engine.js <slug> | --all"); process.exit(1); }
  const sluglar = arg === "--all" ? K.konular().map((k) => k.slug) : [arg];
  for (const s of sluglar) {
    const r = calistir(s);
    if (process.argv.includes("--quiet")) { console.log(`${s.padEnd(30)} ${String(r.secilenPuan).padStart(5)}  ${r.secilen}`); continue; }
    console.log(`\n${s}  (${r.adaySayisi} aday)  mevcut=${r.mevcutPuan}`);
    for (const a of r.adaylar) console.log(`  ${String(a.toplam).padStart(5)}  cb:${a.clickbaitRisk}  ${a.baslik}  [${a.kaynak}]`);
    console.log("  → " + r.secilen);
  }
}
