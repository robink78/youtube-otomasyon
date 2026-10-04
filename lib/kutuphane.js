// KUTUPHANE — konu spec'leri, yayin kaydi, kumeler (topic clusters), kaynak defteri.
//
// Kalici durum (Actions geri commit eder):
//   icerik/yayinlananlar.json  slug -> YouTube video kimligi (yukleyici yazar)
//   icerik/kaynak-defteri.json slug -> kullanilan goruntu kaynak kimlikleri + muzik profili
//   icerik/kalite-kayitlari.json kalite kapisi sonuclari (yayin sikligi bunu okur)
"use strict";
const fs = require("fs");
const path = require("path");
const { KOK, jsonOku, jsonYaz } = require("./ortak");
const CHANNEL = require("../core/channel-context").getChannel();

const YOL = {
  konular: CHANNEL.paths.topics,
  yayinlananlar: path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "yayinlananlar.json" : "published.json"),
  defter: path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "kaynak-defteri.json" : "source-ledger.json"),
  kalite: path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "kalite-kayitlari.json" : "quality-records.json"),
  paket: CHANNEL.paths.packages,
  uretim: CHANNEL.paths.production,
  uretildi: path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "uretilenler.json" : "generated.json"),
  basarisiz: path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "basarisiz.json" : "failed.json"),
};

// Kumeler: ayni kumedeki videolar birbirini bilerek onerir (oturum suresi).
const FAILURE_KUMELER = {
  "bridge-failures": { ad: "Bridge Failures", anahtar: /\bbridges?\b/i,
    aciklama: "Bridges that twisted, cracked and fell — reconstructed from the evidence." },
  "structural-failures": { ad: "Structural Engineering Failures", anahtar: /\b(building|elevator|walkway|collapse|roof|house)s?\b/i,
    aciklama: "Why buildings and structures fail, and what engineers changed afterwards." },
  "aviation-failures": { ad: "Aviation Failures", anahtar: /\b(plane|aircraft|airship|flight|jet|zeppelin|airliner)s?\b/i,
    aciklama: "Air disasters traced link by link through the failure chain." },
  "spaceflight-disasters": { ad: "Spaceflight Disasters", anahtar: /\b(rocket|shuttle|orbiter|launch|spacecraft|challenger|columbia)s?\b/i,
    aciklama: "Launch and spaceflight failures — the engineering behind the fireball." },
  "maritime-disasters": { ad: "Maritime Disasters", anahtar: /\b(ship|ferry|titanic|hull|capsiz)\w*/i,
    aciklama: "How ships lose stability, flood and sink." },
  "nuclear-accidents": { ad: "Nuclear Accidents", anahtar: /\b(nuclear|reactor|radiation|radioactive|atomic)\b/i,
    aciklama: "Nuclear tests and accidents, reconstructed from the record." },
  "fire-and-explosions": { ad: "Fires & Explosions", anahtar: /\b(explosion|explode|blast|fire|gas|flashover|carbon monoxide)\b/i,
    aciklama: "Blasts, fires and invisible gases — the physics of how they kill." },
  "industrial-disasters": { ad: "Industrial Disasters", anahtar: /\b(mine|mining|factory|plant|chemical|refinery)s?\b/i,
    aciklama: "Industrial accidents and the organisational failures behind them." },
  "infrastructure-failures": { ad: "Infrastructure Failures", anahtar: /\b(dam|grid|blackout|levee|pipeline|power)s?\b/i,
    aciklama: "Dams, grids and the systems we only notice when they fail." },
  "materials-failures": { ad: "Materials & Fatigue", anahtar: /\b(rust|corrosion|concrete|glass|fatigue|steel)\b/i,
    aciklama: "When the material itself gives up: corrosion, fatigue and hidden flaws." },
  "rail-disasters": { ad: "Rail Disasters", anahtar: /\b(train|rail|railway|locomotive|derail\w*|tram|metro)s?\b/i,
    aciklama: "Derailments, collisions and signalling failures — how railways fail." },
  "software-and-control-failures": { ad: "Software & Control Failures", anahtar: /\b(software|code|computer|sensor|autopilot|control system|bug|units)\b/i,
    aciklama: "When code, sensors and control logic become the point of failure." },
  "natural-hazards": { ad: "Natural Hazards vs. Engineering", anahtar: /\b(earthquake|volcano|tsunami|flood|hurricane|avalanche|lightning|sinkhole|liquefaction|eruption)s?\b/i,
    aciklama: "What earthquakes, floods and eruptions do to the things we build." },
};

const IMPOSSIBLE_KUMELER = {
  space: { ad: "Space & Astronomy", anahtar: /\b(space|planet|moon|sun|star|galaxy|asteroid|comet|orbit|mars|jupiter|saturn)\w*/i, aciklama: "Space scenarios anchored in orbital mechanics and astronomy." },
  earth: { ad: "Earth", anahtar: /\b(earth|ocean|atmosphere|climate|continent|volcano|magnetic|ice|antarctica)\w*/i, aciklama: "Planetary systems and changes to the world beneath us." },
  physics: { ad: "Physics", anahtar: /\b(gravity|time|energy|light|quantum|mass|force|speed|vacuum|entropy)\w*/i, aciklama: "Counterfactuals constrained by physical law." },
  human: { ad: "Human Biology", anahtar: /\b(human|body|brain|sleep|blood|bone|oxygen|aging|memory)\w*/i, aciklama: "Human limits and biological trade-offs." },
  "future-technology": { ad: "Future Technology", anahtar: /\b(fusion|robot|computer|technology|solar|battery|ai|space elevator)\w*/i, aciklama: "Plausible future systems and their constraints." },
  "extreme-science": { ad: "Extreme Science", anahtar: /\b(black hole|neutron|radiation|pressure|temperature|antimatter|supernova)\w*/i, aciklama: "Matter and energy at the edge of known conditions." },
  other: { ad: "Other Science", anahtar: /./, aciklama: "Cross-disciplinary scientific questions." },
};

const KUMELER = CHANNEL.slug === "impossible-brief" ? IMPOSSIBLE_KUMELER : FAILURE_KUMELER;

function impossibleKonu(topic) {
  if (!topic) return null;
  const kume = String(topic.category || "other").toLowerCase().replace(/\s+/g, "-");
  return {
    slug: topic.slug,
    topicId: topic.id,
    baslik: topic.topic,
    hook: topic.openingLine || topic.hook,
    format: "short",
    aspect: "9:16",
    etiketler: [topic.category, "science", "what if"].filter(Boolean),
    sahneler: (topic.visualPotential?.scenes || []).map((metin) => ({ metin, sentetik: true })),
    vaka: {
      kume: KUMELER[kume] ? kume : "other",
      ad: topic.topic,
      kisa: topic.coreQuestion,
      mekanizma: topic.scientificMechanism,
      kaynakca: topic.sources || [],
    },
    _topic: topic,
  };
}

let impossibleCache = null;
function impossibleUniverse() {
  if (CHANNEL.slug !== "impossible-brief") return [];
  if (!impossibleCache) impossibleCache = (jsonOku(CHANNEL.paths.topicUniverse, {}).topics || []).map(impossibleKonu).filter(Boolean);
  return impossibleCache;
}

function kumeBul(konu) {
  const v = (konu && konu.vaka) || {};
  if (v.kume && KUMELER[v.kume]) return v.kume;
  const metin = [konu.baslik, (konu.etiketler || []).join(" "), (konu.sahneler || []).map((s) => s.metin).join(" ")].join(" ");
  let en = null, enSay = 0;
  for (const [id, k] of Object.entries(KUMELER)) {
    const say = (metin.match(new RegExp(k.anahtar.source, "gi")) || []).length;
    if (say > enSay) { en = id; enSay = say; }
  }
  return en || "structural-failures";
}

function konuOku(slug) {
  const p = path.join(YOL.konular, slug + ".json");
  const k = jsonOku(p, null);
  if (k) k.slug = k.slug || slug;
  if (k) return k;
  return impossibleUniverse().find((topic) => topic.slug === slug) || null;
}

function konular() {
  if (!fs.existsSync(YOL.konular)) return impossibleUniverse();
  const files = fs.readdirSync(YOL.konular).filter((f) => f.endsWith(".json")).sort();
  return files.length ? files.map((f) => konuOku(f.replace(/\.json$/, ""))).filter(Boolean) : impossibleUniverse();
}

// Editoryal alanlar (vaka, baslik, hook...) her zaman GUNCEL spec'ten gelir;
// uretim kopyasindan yalnizca indirilen kaynak bilgisi (kaynak/baslangic/kaynakMeta)
// ayni metinli sahnelere tasinir. Spec yoksa (eski/deneme isi) uretim kopyasi kullanilir.
function uretimKonusu(slug) {
  const spec = konuOku(slug);
  const ur = jsonOku(path.join(YOL.uretim, slug, "konu.json"), null);
  if (!spec) return ur ? { ...ur, slug } : null;
  const growth = jsonOku(paketYolu(slug, "growth-plan.json"), null);
  const usableGrowth = growth && growth.channel === CHANNEL.slug && growth.topic && growth.topic.slug === slug && growth.readiness && growth.readiness.decision !== "BLOCK";
  const plannedLines = usableGrowth && growth.script && Array.isArray(growth.script.lines) ? growth.script.lines : null;
  const selectedTitle = usableGrowth && growth.titles && growth.titles.selected && growth.titles.selected.title;
  const editorial = usableGrowth ? require("../core/growth").applyLegacyOverlay({ ...spec, slug }, growth) : { ...spec, slug };
  if (!ur) return editorial;
  const sahneler = (editorial.sahneler || []).map((s, i) => {
    const metin = plannedLines && plannedLines[i] || s.metin;
    const originalText = spec.sahneler && spec.sahneler[i] && spec.sahneler[i].metin;
    const u = (ur.sahneler || []).find((x) => x.metin === metin) || (ur.sahneler || []).find((x) => x.metin === originalText) || (ur.sahneler || [])[i];
    if (!u) return { ...s, metin };
    const { kaynak, baslangic, kaynakMeta } = u;
    return { ...s, metin, ...(kaynak ? { kaynak } : {}), ...(baslangic != null ? { baslangic } : {}), ...(kaynakMeta ? { kaynakMeta } : {}) };
  });
  return { ...editorial, ...(selectedTitle ? { baslik: selectedTitle } : {}), sahneler, slug };
}

const yayinlananlar = () => jsonOku(YOL.yayinlananlar, []).filter((item) => !item.channel || item.channel === CHANNEL.slug);

// Uretim sirasi (tek kaynak — shorts-sira ve bildirimler ayni sirayi kullanir):
// uretilmemis/basarisiz olmamis/yuklenmemis konular; once gercek arsiv filmi olanlar
// (kanalin en guclu videolari arsiv goruntulu), sonra stok aciklayicilar; grup icinde alfabetik.
function kuyruk(ops = {}) {
  const ids = (rows) => rows.map((item) => typeof item === "string" ? item : item.topicId || item.slug).filter(Boolean);
  const atla = new Set([...ids(jsonOku(YOL.uretildi, [])), ...ids(jsonOku(YOL.basarisiz, [])),
    ...yayinlananlar().map((y) => y.slug), ...(ops.atla || [])]);
  // "oncelik" (spec, istege bagli, buyuk = once): editoryal olarak en guclu vakalar one alinir.
  const arsiv = (k) => (k.tur !== "stok" ? 1 : 0);
  return konular().filter((k) => !atla.has(k.slug) && formatBul(k) === "short")
    .sort((a, b) => arsiv(b) - arsiv(a) || (b.oncelik || 0) - (a.oncelik || 0) || a.slug.localeCompare(b.slug));
}
function yayinKaydet(kayit) {
  if (kayit.channel && kayit.channel !== CHANNEL.slug) throw new Error(`Channel state violation: ${kayit.channel} cannot be written to ${CHANNEL.slug}`);
  const l = yayinlananlar().filter((x) => x.videoId !== kayit.videoId);
  l.push({ ...kayit, channel: CHANNEL.slug });
  l.sort((a, b) => String(a.tarih).localeCompare(String(b.tarih)));
  jsonYaz(YOL.yayinlananlar, l);
}
const yayinBul = (slug) => yayinlananlar().filter((x) => x.slug === slug).pop() || null;

const defter = () => jsonOku(YOL.defter, {});
function defterYaz(slug, kayit) {
  const d = defter();
  d[slug] = { ...(d[slug] || {}), ...kayit };
  jsonYaz(YOL.defter, d);
}

const kaliteKayitlari = () => jsonOku(YOL.kalite, []);
function kaliteKaydet(k) {
  const l = kaliteKayitlari().filter((x) => !(x.slug === k.slug && x.asama === k.asama));
  l.push(k);
  jsonYaz(YOL.kalite, l.slice(-500));
}

// Tum senaryo metni (sahneler ya da uzun format bolumler)
function anlati(konu) {
  if (Array.isArray(konu.bolumler) && konu.bolumler.length)
    return konu.bolumler.map((b) => (b.paragraflar || [b.metin || ""]).join("\n\n")).join("\n\n");
  return (konu.sahneler || []).map((s) => s.metin).join(" ");
}

const paketYolu = (slug, ...p) => path.join(YOL.paket, slug, ...p);
const formatBul = (konu) => (konu.format === "long" || konu.aspect === "16:9" ? "long" : "short");

module.exports = { CHANNEL, YOL, KUMELER, FAILURE_KUMELER, IMPOSSIBLE_KUMELER, kumeBul, konuOku, konular, kuyruk, uretimKonusu, yayinlananlar, yayinKaydet, yayinBul,
  defter, defterYaz, kaliteKayitlari, kaliteKaydet, anlati, paketYolu, formatBul };
