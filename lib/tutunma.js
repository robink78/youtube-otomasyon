// TUTUNMA — Shorts senaryosu icin kanalin KENDI izleyici verisinden cikan kurallar.
//
// Olcum (2026-09-25, YouTube Analytics izleyici tutma egrisi, ilk 4 video):
//   - Uc videoda da en sert dusus videonun %11-21'inde (~4-7. sn): tam ikinci
//     cumlede. O cumle her seferinde tarih/ortam kurulumuydu ("May sixth, 1937...",
//     "Nineteen forty...", "April eighteenth...", "The year is 1946...").
//   - En uzun video (38 sn, 106 kelime) en dusuk ortalama izlenme oranini aldi (%47);
//     en yuksek oran (%75.6) Shorts akisinda tek buyuk dagitimi alan videoydu.
//
// Kurallar (yalnizca Shorts):
//   1) IKINCI VURUS: 2. sahne kurulum degil — olay, tirmanis, geri sayim ya da can
//      kaybi olmali; tarih/yil ile baslamaz. Baglam (tarih, yer) sonra gelir; tarih
//      zaten ekrandaki damgada gorunur.
//   2) UZUNLUK: <= 80 kelime (~28-30 sn, Andrew +%6 ~2.8 kel/sn).
//   3) ARSIV ACILISI: arsiv filminde ilk sahnenin "baslangic"i acikca verilir —
//      filmin en carpici anindan acilir (otomatik dagitim filmin basini, cogu zaman
//      jenerik/sakin plani gosteriyordu).
"use strict";
const pacing = require("../scene-pacing");

const MAKS_KELIME = 80;
const HIZLI = ["event", "countdown", "escalation", "emergency", "discovery"];
const TARIH_BASI = /^(in |on |by )?((1[6-9]|20)\d\d\b|(january|february|march|april|may|june|july|august|september|october|november|december)\b|nineteen|eighteen|the year is|back in)/i;

const kelimeSay = (t) => String(t || "").split(/\s+/).filter(Boolean).length;

// Bulgular: [{ kural, mesaj }] — bos dizi = kurallara uygun
function denetle(konu) {
  const s = konu.sahneler || [];
  if (!s.length || Array.isArray(konu.bolumler)) return [];   // uzun format bu kurallarin disinda
  const b = [];
  const n = s.reduce((a, x) => a + kelimeSay(x.metin), 0);
  if (n > MAKS_KELIME) b.push({ kural: "uzunluk", mesaj: `${n} words (~${Math.round(n / 2.8)} s) — keep Shorts at ≤${MAKS_KELIME} words (~28-30 s)` });
  if (s.length > 1) {
    const ikinci = String(s[1].metin || "").trim();
    const rol = pacing.rolBul(ikinci, 1, Math.max(3, s.length));   // "son sahne = ders" kurali burada gecmez
    if (TARIH_BASI.test(ikinci)) b.push({ kural: "ikinci-vurus", mesaj: `second beat opens with a date/setup ("${ikinci.slice(0, 40)}…") — audience drop measured here; move context later` });
    else if (!HIZLI.includes(rol)) b.push({ kural: "ikinci-vurus", mesaj: `second beat is "${rol}", not an event/escalation — audience drop measured at 4-7 s` });
  }
  // Arsiv FILMI icin acilis ani secilmeli. FOTOGRAF kaynaginda zaman damgasi yoktur:
  // hareket (yavas zoom/kaydirma) shorts-yap tarafindan uygulanir, kural gecersizdir.
  const foto = (x) => /\.(jpe?g|png|webp)$/i.test(String((x && x.kaynak) || ""));
  if (konu.tur !== "stok" && s[0] && s[0].kaynak && !foto(s[0]) && typeof s[0].baslangic !== "number")
    b.push({ kural: "arsiv-acilis", mesaj: "archive opening has no explicit start time — open on the most striking moment of the film" });
  return b;
}

module.exports = { denetle, MAKS_KELIME, HIZLI, TARIH_BASI, kelimeSay };
