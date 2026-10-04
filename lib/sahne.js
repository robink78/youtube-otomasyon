// SAHNE — uzun format senaryosunu gorsel sahnelerine bolme kurali (tek kaynak).
// gorsel-bul.js klasorleri, video-yap.js zamanlamayi, seslendir.js parcalari ve
// engineering-visuals.js yerlesimi AYNI kurala gore yapar; boylece sahne N =
// Visuals/NN-* klasoru ve ses parcasi i = paragraf i.
//
// Senaryoda "## BOLUM ADI" satirlari bolum basligidir: SESLENDIRILMEZ, altyaziya
// girmez; video-yap.js bunlardan YouTube bolum zaman damgalarini (chapters) cikarir.
"use strict";

const SAHNE_MIN_KELIME = 22;   // ~10 sn anlatim; kisa paragraflar bir oncekiyle birlesir
const BASLIK = /^\s*##\s+(.+?)\s*$/;

// -> { paragraflar: [seslendirilecek paragraflar], harita: [{ baslik, paragraf }] }
function bolumAyir(metin) {
  const paragraflar = [], harita = [];
  let bekleyen = null;
  for (const blok of String(metin).replace(/\r\n/g, "\n").split(/\n\s*\n/)) {
    const satir = blok.split("\n");
    const govde = [];
    for (const l of satir) {
      const m = l.match(BASLIK);
      if (m) bekleyen = m[1];
      else if (l.trim()) govde.push(l.trim());
    }
    if (!govde.length) continue;
    if (bekleyen) { harita.push({ baslik: bekleyen, paragraf: paragraflar.length }); bekleyen = null; }
    paragraflar.push(govde.join(" "));
  }
  return { paragraflar, harita };
}

const temizMetin = (metin) => bolumAyir(metin).paragraflar.join("\n\n");

function sahneParagraflari(senaryo) {
  const ham = bolumAyir(senaryo).paragraflar.filter((p) => p.length > 25);
  const out = [];
  for (const p of ham) {
    const son = out[out.length - 1];
    if (son && son.split(/\s+/).length < SAHNE_MIN_KELIME) out[out.length - 1] = son + " " + p;
    else out.push(p);
  }
  return out;
}

module.exports = { sahneParagraflari, bolumAyir, temizMetin, SAHNE_MIN_KELIME };
