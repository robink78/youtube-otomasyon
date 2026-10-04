// METIN — benzerlik ve metin analizi yardimcilari (originality, baslik, hook).
"use strict";

const DURAK = new Set(("a an the and or but if then than that this these those of in on at to for from by with " +
  "is are was were be been being it its it's as into over under about after before so no not only just " +
  "what why how when who which one all any each more most very can could would should will do does did " +
  "their there they them he she his her we our you your i my me up out down off again").split(" "));

const kucuk = (s) => String(s || "").toLowerCase();
const kelimeler = (s) => kucuk(s).replace(/[’']/g, "").match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || [];
const icerikKelimeleri = (s) => kelimeler(s).filter((w) => !DURAK.has(w) && w.length > 1);

function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 0;
  let k = 0; for (const x of A) if (B.has(x)) k++;
  return k / (A.size + B.size - k);
}

// Karakter trigram benzerligi — kisa metinlerde (baslik, hook) kelimeden daha hassas.
function trigramlar(s) {
  const t = " " + kucuk(s).replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim() + " ";
  const out = [];
  for (let i = 0; i < t.length - 2; i++) out.push(t.slice(i, i + 3));
  return out;
}
const trigramBenzerlik = (a, b) => jaccard(trigramlar(a), trigramlar(b));
const kelimeBenzerlik = (a, b) => jaccard(icerikKelimeleri(a), icerikKelimeleri(b));

// Dizi benzerligi (LCS orani) — sahne rolu / sahne sirasi karsilastirmasi icin.
function diziBenzerlik(a, b) {
  if (!a.length || !b.length) return 0;
  const d = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = a[i - 1] === b[j - 1] ? d[i - 1][j - 1] + 1 : Math.max(d[i - 1][j], d[i][j - 1]);
  return (2 * d[a.length][b.length]) / (a.length + b.length);
}

const cumleler = (s) => String(s || "").replace(/\s+/g, " ").split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/)
  .map((x) => x.trim()).filter(Boolean);

// Baslik bicimi (AP benzeri, kisa baglaclar kucuk).
const KUCUK_KAL = new Set("a an the and but or nor for so yet at by in of on to up as vs via".split(" "));
function baslikBicim(s) {
  return String(s).split(/(\s+)/).map((w, i, arr) => {
    if (/^\s+$/.test(w) || !w) return w;
    if (/[A-Z]{2,}/.test(w) || /\d/.test(w)) return w;          // O-RING, 737, MPH aynen
    const ilk = i === 0 || /[:—.-]\s*$/.test(arr.slice(0, i).join("").trim().slice(-1));
    const lw = w.toLowerCase();
    if (!ilk && KUCUK_KAL.has(lw)) return lw;
    return w.replace(/^([("']?)([a-z])/, (m, p, c) => p + c.toUpperCase());
  }).join("");
}

const buyukHarf = (s) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
const kelimeSay = (s) => String(s || "").split(/\s+/).filter(Boolean).length;

// Altyazi kelimeleri: noktalama silinir, rakamlar arasindaki nokta/virgul korunur
// ("1.4 billion" -> "1.4", "2,500" -> "2,500"; eskiden "14" ve "2500" oluyordu).
const altyaziKelimeleri = (t) => String(t || "").replace(/(?<!\d)[.,;:!?]|[.,;:!?](?!\d)/g, "").split(/\s+/).filter(Boolean);

module.exports = { altyaziKelimeleri, DURAK, kelimeler, icerikKelimeleri, jaccard, trigramBenzerlik, kelimeBenzerlik,
  diziBenzerlik, cumleler, baslikBicim, buyukHarf, kelimeSay };
