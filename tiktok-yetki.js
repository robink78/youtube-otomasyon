// TIKTOK YETKI — bir kez calistir, TT_REFRESH_TOKEN uret.
//
// TikTok (Google'in aksine) http://localhost yonlendirmesini kabul etmez; bu
// yuzden tarayici otomatik yakalama yok: onay sonrasi adres cubugundaki adresi
// buraya yapistirirsin. Jeton 365 GUN gecerli, yani yilda bir tekrar edilir.
//
// Once TikTok for Developers'ta uygulamayi olustur (docs/TIKTOK.md) ve .env'e koy:
//   TT_CLIENT_KEY=...
//   TT_CLIENT_SECRET=...
//   TT_REDIRECT=https://...      (uygulamada kayitli yonlendirme adresi)
//
// Kullanim: node tiktok-yetki.js
"use strict";
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { KOK, env } = require("./lib/ortak");
const TT = require("./lib/tiktok");

// video.upload = gelen kutusuna yukleme (denetim gerektirmez).
// video.publish EKLENMEZ: denetimden once gonderiler yalnizca gizli olabilirdi.
const SCOPE = "video.upload";

const sor = (soru) => new Promise((coz) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(soru, (c) => { rl.close(); coz(c.trim()); });
});

function envYaz(ad, deger) {
  const yol = path.join(KOK, ".env");
  let icerik = "";
  try { icerik = fs.readFileSync(yol, "utf8"); } catch (e) {}
  const re = new RegExp("^" + ad + "=.*$", "m");
  icerik = re.test(icerik) ? icerik.replace(re, ad + "=" + deger)
    : icerik + (icerik && !icerik.endsWith("\n") ? "\n" : "") + ad + "=" + deger + "\n";
  fs.writeFileSync(yol, icerik);
}

(async () => {
  const key = env("TT_CLIENT_KEY"), redirect = env("TT_REDIRECT");
  if (!key || !env("TT_CLIENT_SECRET")) { console.error("Once .env'e TT_CLIENT_KEY ve TT_CLIENT_SECRET koy (bkz. docs/TIKTOK.md)."); process.exit(1); }
  if (!redirect) { console.error("Once .env'e TT_REDIRECT koy — TikTok uygulamasinda kayitli yonlendirme adresi."); process.exit(1); }

  const durumKodu = Math.random().toString(36).slice(2);
  const url = "https://www.tiktok.com/v2/auth/authorize/?" + new URLSearchParams({
    client_key: key, scope: SCOPE, response_type: "code", redirect_uri: redirect, state: durumKodu }).toString();

  console.log("\n1) Bu adresi tarayicida ac ve KANAL HESABIYLA izin ver:\n\n" + url + "\n");
  console.log("2) Izin verince adres cubugunda '" + redirect + "?code=...' benzeri bir adrese donersin.");
  console.log("   (Sayfa bos ya da 404 gorunebilir — onemli degil, adres cubugu yeterli.)\n");
  const cevap = await sor("3) O adresin TAMAMINI buraya yapistir: ");

  let kod = cevap;
  try {
    const u = new URL(cevap);
    kod = u.searchParams.get("code") || cevap;
    const s = u.searchParams.get("state");
    if (s && s !== durumKodu) { console.error("\nGuvenlik: state degeri eslesmedi — bu adres bu istekten gelmiyor. Bastan basla."); process.exit(1); }
  } catch (e) { /* duz kod yapistirilmis olabilir */ }
  kod = decodeURIComponent(String(kod).split("*")[0] || kod);   // TikTok kodu bazen "...*!1234" ekiyle gelir
  if (!kod) { console.error("Kod okunamadi."); process.exit(1); }

  const j = await TT.koddanJeton(kod, redirect);
  // The error response can still contain a short-lived access token. Report
  // only safe metadata; never serialize the provider response to the terminal.
  if (!j.refresh_token) { console.error("Yanitta refresh_token yok; hata kodu: " + String(j.error || j.error_code || "TOKEN_RESPONSE_INCOMPLETE")); process.exit(1); }

  envYaz("TT_REFRESH_TOKEN", j.refresh_token);
  try {
    const yp = path.join(KOK, "config", "yetki.json");
    const eski = fs.existsSync(yp) ? JSON.parse(fs.readFileSync(yp, "utf8")) : {};
    fs.writeFileSync(yp, JSON.stringify({ ...eski, tiktokYetkiTarihi: new Date().toISOString() }, null, 2) + "\n");
  } catch (e) {}

  const gun = Math.round((j.refresh_expires_in || 365 * 86400) / 86400);
  console.log("\n✓ Basarili. TT_REFRESH_TOKEN .env dosyasina yazildi.");
  console.log("  Kapsam: " + (j.scope || SCOPE) + "  ·  Gecerlilik: ~" + gun + " gun");
  console.log("\nSimdi GitHub > Settings > Secrets and variables > Actions altina ekle:");
  console.log("  TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REFRESH_TOKEN");
  console.log("ve config/yetki.json degisikligini commit et (saglik kontrolu tarihi okur).");
})().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
