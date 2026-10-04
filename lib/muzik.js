// MUZIK PROFILI — Shorts atmosfer yataginin parametreleri.
//
// Eski durum: kok frekans yalnizca 6 degerden biri (slug uzunluguna gore), geri
// kalan her sey her videoda AYNI — kanal genelinde tekrar eden muzik.
// Yeni: kumenin (konu ailesi) ruh haline gore aralik + slug'a gore deterministik
// varyasyon. Ayni video her zaman ayni muzigi alir (tekrar uretilebilir);
// farkli videolar olculebilir sekilde farkli profiller alir (originality-check).
"use strict";
const { hash01 } = require("./ortak");

// Kume ruh hali: aralik (kok*oran), tremolo hizi, gurultu rengi, yanki
const RUH = {
  "bridge-failures": { oranlar: [1.5, 1.335], trem: [0.11, 0.15], renk: "brown", ton: "tense" },
  "structural-failures": { oranlar: [1.5, 1.2], trem: [0.12, 0.17], renk: "pink", ton: "tense" },
  "aviation-failures": { oranlar: [1.335, 1.5], trem: [0.12, 0.2], renk: "pink", ton: "airy" },
  "spaceflight-disasters": { oranlar: [1.5, 2.0], trem: [0.15, 0.25], renk: "white", ton: "vast" },
  "maritime-disasters": { oranlar: [1.2, 1.5], trem: [0.10, 0.12], renk: "brown", ton: "deep" },
  "nuclear-accidents": { oranlar: [1.414, 1.189], trem: [0.10, 0.13], renk: "brown", ton: "ominous" },
  "fire-and-explosions": { oranlar: [1.5, 1.26], trem: [0.14, 0.22], renk: "pink", ton: "urgent" },
  "industrial-disasters": { oranlar: [1.335, 1.189], trem: [0.11, 0.16], renk: "brown", ton: "heavy" },
  "infrastructure-failures": { oranlar: [1.5, 1.335], trem: [0.10, 0.14], renk: "pink", ton: "tense" },
  "materials-failures": { oranlar: [1.26, 1.5], trem: [0.10, 0.12], renk: "pink", ton: "slow" },
  "natural-hazards": { oranlar: [1.5, 1.2], trem: [0.10, 0.18], renk: "brown", ton: "vast" },
  // The Hidden Logic of Things: merak/sicaklik — gerilimli felaket tonlari yerine
  // major ucluler ve daha hizli, hafif tremolo.
  "everyday-curious": { oranlar: [1.26, 1.5], trem: [0.16, 0.24], renk: "pink", ton: "curious" },
  "everyday-warm": { oranlar: [1.335, 1.26], trem: [0.14, 0.2], renk: "pink", ton: "warm" },
};

function profil(slug, kume) {
  const r = RUH[kume] || RUH["structural-failures"];
  const h = (ek) => hash01(slug + ":" + ek);
  const kok = Math.round((46 + h("kok") * 28) * 10) / 10;                   // 46-74 Hz
  const oran = r.oranlar[Math.floor(h("oran") * r.oranlar.length) % r.oranlar.length];
  // ffmpeg tremolo f >= 0.1 Hz ister (altinda render COKER) — aralik ne olursa olsun sinirla
  const trem = Math.max(0.1, Math.round((r.trem[0] + h("trem") * (r.trem[1] - r.trem[0])) * 1000) / 1000);
  const yanki1 = 380 + Math.round(h("y1") * 340), yanki2 = yanki1 + 220 + Math.round(h("y2") * 260);
  const alcak = 700 + Math.round(h("lp") * 450);
  return { kok, oran, trem, renk: r.renk, yanki: [yanki1, yanki2], alcak, ton: r.ton };
}

// Iki profilin benzerligi 0..1 (1 = ayni)
function benzerlik(a, b) {
  if (!a || !b) return 0;
  const f = (x, y, olcek) => 1 - Math.min(1, Math.abs(x - y) / olcek);
  return Math.round(((f(a.kok, b.kok, 20) + (a.oran === b.oran ? 1 : 0) + f(a.trem, b.trem, 0.1) + (a.renk === b.renk ? 1 : 0) +
    f(a.yanki[0], b.yanki[0], 300) + f(a.alcak, b.alcak, 400)) / 6) * 100) / 100;
}

module.exports = { profil, benzerlik, RUH };
