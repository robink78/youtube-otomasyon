// SCENE PACING — sahne suresini ANLATININ ANLAMINDAN turetir.
//
// "gorsel -> 8 sn bekle -> gecis -> gorsel -> 8 sn bekle" yerine: her sahnenin
// anlatidaki rolu siniflanir ve cekim uzunlugu, hareket, gecis ve ust katman
// (overlay) ihtiyaci o role gore secilir. Rastgelelik YOK — ayni metin her
// zaman ayni plani verir; cesitlilik anlamdan gelir.
//
//   HIZLI  (olay, geri sayim, kesif, tirmanis, acil durum)  2-3 sn cekimler
//   ORTA   (baglam, kanit)                                  4-6 sn
//   YAVAS  (teknik aciklama, diyagram, ders)                7-10 sn (diyagram 10-15)
//
// Shorts'ta sahne suresi seslendirmeye bagli oldugu icin plan, sahne ICINDEKI
// kesme sayisini (alt cekim), hareketi ve ust katmani belirler.
//
// Kullanim: node scene-pacing.js <slug>   ->  icerik/paket/<slug>/pacing.json
"use strict";
const { jsonYaz } = require("./lib/ortak");
const K = require("./lib/kutuphane");

const ROLLER = [
  // [rol, desen] — sira onemli: ilk eslesen kazanmaz, en cok eslesen kazanir.
  ["event", /\b(collaps\w*|explod\w*|detonat\w*|drops?|lets go|fell|falls?|ignit\w*|burst\w*|snap\w*|swallow\w*|crash\w*|breaks?|rips?|tears?|destroy\w*|blast|shatter\w*|plunge\w*|lifts?|corkscrew\w*|twist\w*|release\w*|flatten\w*|crushes|crush)\b/gi],
  ["countdown", /\b(seconds?|minutes?|in an instant|suddenly|at once|real time|faster than|in seconds|within)\b/gi],
  ["escalation", /\b(spread\w*|cascad\w*|grow\w*|builds?|amplif\w*|piles? up|races?|overload\w*|rises?|rushes|more and more|picks up|jumps)\b/gi],
  ["emergency", /\b(escape\w*|run|flee\w*|surviv\w*|rescue\w*|trapped|die[sd]?|dead|killed|kills|killing|homeless|victims?|gone)\b/gi],
  ["discovery", /\b(investigat\w*|found|discover\w*|the cause was|turned out|revealed|cause)\b/gi],
  ["technical", /\b(pressure|force|load|mechanism|engineers call|physics|flutter|stress|tension|compress\w*|energy|oxid\w*|crystal\w*|grains?|buoyan\w*|resonan\w*|reaction|weight|temperature|volts?|chemical|hemoglobin|layers?|pillars?|current|shockwave|vacuum|feeding|push\w*|seep\w*|erod\w*|carv\w*|soil|slowly|hidden|dissolv\w*|expand\w*|swell\w*|called)\b/gi],
  ["evidence", /\b(film\w*|footage|photograph\w*|record\w*|measured|data|caught on|newsreel|report\w*)\b/gi],
  ["context", /\b(1[6-9]\d\d|20[0-2]\d|nineteen|eighteen|the year is|years? later|once|brand new|built|opened|century|centuries)\b/gi],
  ["lesson", /\b(that is why|that's why|today|modern|learned|lesson|rule|designed|tested|sensors?|inspected|detector|never again|every .* since|is why)\b/gi],
];
const TEMPO = { event: "fast", countdown: "fast", escalation: "fast", emergency: "fast", discovery: "fast",
  technical: "slow", lesson: "slow", evidence: "medium", context: "medium", hook: "fast" };
const ARALIK = {  // [min, max] saniye cekim uzunlugu
  long: { fast: [2, 3], medium: [4, 6], slow: [7, 10], diagram: [10, 15] },
  short: { fast: [1.4, 2.4], medium: [2.4, 3.6], slow: [3.2, 5.5], diagram: [4, 6] },
};

function rolBul(metin, sira, toplam) {
  if (sira === 0) return "hook";
  let en = "context", enSay = 0;
  for (const [rol, re] of ROLLER) {
    const n = (String(metin).match(re) || []).length;
    if (n > enSay) { en = rol; enSay = n; }
  }
  if (sira === toplam - 1 && enSay <= 1) return "lesson";
  return en;
}

function sahnePlani(metin, sira, toplam, sure, format, diyagram = false) {
  const rol = rolBul(metin, sira, toplam);
  const tempo = diyagram ? "diagram" : TEMPO[rol] || "medium";
  const [a, b] = ARALIK[format][tempo];
  const cekimSayisi = sure ? Math.max(1, Math.ceil(sure / b)) : null;
  const cekimler = sure ? Array.from({ length: cekimSayisi }, () => sure / cekimSayisi) : null;
  const hareket = { fast: "punch", medium: "push", slow: "drift", diagram: "hold" }[tempo];
  const gecis = { fast: { tip: "cut", sure: format === "long" ? 0.15 : 0 }, medium: { tip: "dissolve", sure: 0.45 },
    slow: { tip: "dissolve", sure: 0.8 }, diagram: { tip: "dissolve", sure: 0.8 } }[tempo];
  const ust = rol === "technical" ? "failure-chain" : rol === "context" ? "date-location-stamp"
    : rol === "evidence" ? "source-tag" : rol === "discovery" ? "root-cause-marker" : rol === "lesson" ? "what-changed" : null;
  const gorsel = { event: "archival motion / impact footage", countdown: "tight crops, time pressure",
    escalation: "wider shots showing spread", emergency: "human-scale footage", discovery: "evidence / documents",
    technical: "diagram or close-up of the failing component", evidence: "original archival material, labelled",
    context: "establishing shot of place and era", lesson: "modern equivalent / what changed", hook: "most striking frame of the event" }[rol];
  return { sira, rol, tempo, cekimAraligi: [a, b], cekimSayisi, cekimler, hareket, gecis, ustKatman: ust, gorselStil: gorsel };
}

// Shorts: sahneler + seslendirme suresine gore plan
function planKisa(konu, sureler) {
  const s = konu.sahneler || [];
  return s.map((x, i) => sahnePlani(x.metin, i, s.length, sureler ? sureler[i] : null, "short"));
}

// Uzun format: paragraf listesi + sureler (+ hangi sahne diyagram iceriyor)
function planUzun(paragraflar, sureler, diyagramli = []) {
  return paragraflar.map((p, i) => sahnePlani(p, i, paragraflar.length, sureler ? sureler[i] : null, "long", diyagramli.includes(i)));
}

// Sahne metinlerinin seslendirme parcalarina gore zaman araliklari.
// Sahneler, parcalarin (ardisik) birlesimi olabilir (gorsel-bul kisa paragraflari birlestirir).
function sahneZamanlari(sahneMetinleri, parcaMetinleri, parcaSureleri, bosluk = 0) {
  const kel = (t) => String(t).split(/\s+/).filter(Boolean);
  const zaman = []; let t = 0;                       // kelime indeksi -> saniye
  parcaMetinleri.forEach((p, i) => {
    const w = kel(p), d = parcaSureleri[i] || 0;
    w.forEach((_, j) => zaman.push(t + d * j / Math.max(1, w.length)));
    t += d + (i < parcaMetinleri.length - 1 ? bosluk : 0);
  });
  zaman.push(t);
  const tum = parcaMetinleri.flatMap(kel);
  const norm = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "");
  let imlec = 0;
  return sahneMetinleri.map((m) => {
    const w = kel(m);
    const ilk = w.slice(0, 5).map(norm).join(" ");
    let bas = imlec;
    for (let i = imlec; i <= tum.length - Math.min(5, w.length); i++) {
      if (tum.slice(i, i + Math.min(5, w.length)).map(norm).join(" ") === ilk) { bas = i; break; }
    }
    const son = Math.min(tum.length, bas + w.length);
    imlec = son;
    return { bas: zaman[bas], son: zaman[son] };
  });
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  // Sure bilinmiyorsa kelime payindan tahmin (Shorts ~2.75 kel/sn)
  const sureler = (konu.sahneler || []).map((s) => s.metin.split(/\s+/).length / 2.75);
  const plan = planKisa(konu, sureler);
  const r = { slug, olusturuldu: new Date().toISOString(), not: "durations estimated from word count until render", plan };
  jsonYaz(K.paketYolu(slug, "pacing.json"), r);
  return r;
}

module.exports = { rolBul, sahnePlani, planKisa, planUzun, sahneZamanlari, calistir, ARALIK };

if (require.main === module) {
  const slug = process.argv[2];
  if (!slug) { console.error("Kullanim: node scene-pacing.js <slug>"); process.exit(1); }
  const r = calistir(slug);
  for (const p of r.plan) console.log(`  ${String(p.sira).padStart(2)} ${p.rol.padEnd(11)} ${p.tempo.padEnd(7)} ${p.cekimSayisi} cekim  ${p.hareket.padEnd(6)} ${p.gecis.tip.padEnd(8)} ${p.ustKatman || ""}`);
}
