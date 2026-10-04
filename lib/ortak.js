// ORTAK — tum buyume modullerinin paylastigi kucuk yardimcilar.
// Sifir bagimlilik. Sirlar yalnizca ortam degiskeni ya da .env'den okunur.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const KOK = path.resolve(__dirname, "..");

function env(ad) {
  if (process.env[ad]) return String(process.env[ad]).trim();
  // Tests must be hermetic: an operator's real local .env must never leak in.
  if (process.env.NODE_TEST_CONTEXT) return "";
  try {
    for (const l of fs.readFileSync(path.join(KOK, ".env"), "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === ad) return m[2].trim();
    }
  } catch (e) {}
  return "";
}

function jsonOku(p, varsayilan) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return varsayilan; }
}

// Atomik yazim: yarim kalan dosya durumu bozmaz.
function jsonYaz(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

function metinYaz(p, s) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s.endsWith("\n") ? s : s + "\n");
}

// Deterministik 0..1 — ayni slug her zaman ayni secimi yapar (rastgele degil,
// tekrar uretilebilir), farkli slug'lar farkli secer.
function hash01(s) {
  const h = crypto.createHash("sha1").update(String(s)).digest();
  return h.readUInt32BE(0) / 0xffffffff;
}
const sec = (dizi, anahtar) => dizi[Math.floor(hash01(anahtar) * dizi.length) % dizi.length];

const slugGecerli = (s) => /^[a-z0-9][a-z0-9-]{0,79}$/.test(String(s || ""));
const videoIdGecerli = (s) => /^[A-Za-z0-9_-]{11}$/.test(String(s || ""));
const sinirla = (x, a = 0, b = 100) => Math.max(a, Math.min(b, x));
const yuvarla = (x, n = 2) => Math.round(x * 10 ** n) / 10 ** n;
const bugun = () => new Date().toISOString().slice(0, 10);

module.exports = { KOK, env, jsonOku, jsonYaz, metinYaz, hash01, sec, slugGecerli, videoIdGecerli,
  sinirla, yuvarla, bugun };
