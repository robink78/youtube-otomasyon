// TIKTOK — Content Posting API v2 icin kucuk istemci (ek npm bagimliligi yok).
//
// Akis: "Upload to Inbox" (scope video.upload). Video TikTok uygulamasindaki
// gelen kutusuna DUSER; sen bildirime dokunup yayinlarsin. Bu yol denetim
// (audit) gerektirmez ve gonderi HERKESE ACIK olabilir.
// Alternatif "Direct Post" (scope video.publish) tam otomatiktir ama TikTok
// denetiminden gecene kadar gonderiler yalnizca GIZLI olabilir — bu yuzden
// once inbox kullanilir (bkz. docs/TIKTOK.md).
//
// Kimlik (.env / GitHub Secrets):
//   TT_CLIENT_KEY, TT_CLIENT_SECRET, TT_REFRESH_TOKEN
// Refresh token 365 gun gecerli (YouTube'un 7 gunluk test jetonunun aksine).
"use strict";
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const { env } = require("./ortak");

const OAUTH = "open.tiktokapis.com";
const GEREKLI = ["TT_CLIENT_KEY", "TT_CLIENT_SECRET", "TT_REFRESH_TOKEN"];
const kimlikVar = () => GEREKLI.every((k) => env(k));

function istek(opt, govde) {
  return new Promise((coz, red) => {
    const r = https.request(opt, (res) => {
      const p = [];
      res.on("data", (d) => p.push(d));
      res.on("end", () => coz({ durum: res.statusCode, basliklar: res.headers, govde: Buffer.concat(p).toString("utf8") }));
    });
    r.on("error", red);
    r.setTimeout(60000, () => r.destroy(new Error("zaman asimi")));
    if (govde) r.write(govde);
    r.end();
  });
}

function json(govde) { try { return JSON.parse(govde); } catch (e) { return null; } }

// TikTok hatayi HTTP 200 govdesinde de dondurebilir: error.code "ok" degilse hata.
function hataMi(j) {
  const e = j && j.error;
  if (!e) return null;
  const k = e.code || e.error_code;
  if (!k || k === "ok") return null;
  return `${k}${e.message ? ": " + e.message : ""}${e.log_id ? " (log_id " + e.log_id + ")" : ""}`;
}

async function jetonIste(govde) {
  const y = await istek({ hostname: OAUTH, path: "/v2/oauth/token/", method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(govde) } }, govde);
  const j = json(y.govde);
  const h = hataMi(j);
  if (y.durum !== 200 || h || !j || !j.access_token) {
    const gecersiz = /invalid_grant|invalid_request/.test(String(y.govde));
    throw new Error((gecersiz ? "TT_YETKI_GECERSIZ: TikTok yetkisi gecersiz ya da suresi dolmus — node tiktok-yetki.js ile yenile. " : "")
      + "TikTok jetonu alinamadi (HTTP " + y.durum + ")" + (h ? ": " + h : ""));
  }
  return j;
}

// refresh_token -> 24 saatlik access_token
async function token() {
  if (!kimlikVar()) throw new Error("TikTok kimlik bilgileri yok (TT_CLIENT_KEY/TT_CLIENT_SECRET/TT_REFRESH_TOKEN)");
  const j = await jetonIste(new URLSearchParams({ client_key: env("TT_CLIENT_KEY"), client_secret: env("TT_CLIENT_SECRET"),
    grant_type: "refresh_token", refresh_token: env("TT_REFRESH_TOKEN") }).toString());
  return { erisim: j.access_token, kapsam: String(j.scope || ""), yeniRefresh: j.refresh_token || null };
}

// authorization_code -> ilk refresh_token (tiktok-yetki.js kullanir)
const koddanJeton = (kod, redirect) => jetonIste(new URLSearchParams({ client_key: env("TT_CLIENT_KEY"),
  client_secret: env("TT_CLIENT_SECRET"), code: kod, grant_type: "authorization_code", redirect_uri: redirect }).toString());

async function api(tok, yol, obj) {
  const b = JSON.stringify(obj || {});
  const y = await istek({ hostname: OAUTH, path: yol, method: "POST",
    headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json; charset=UTF-8", "Content-Length": Buffer.byteLength(b) } }, b);
  const j = json(y.govde);
  const h = hataMi(j);
  if (y.durum < 200 || y.durum >= 300 || h) throw new Error(`TikTok ${yol} basarisiz (HTTP ${y.durum})${h ? ": " + h : ": " + y.govde.slice(0, 300)}`);
  return (j && j.data) || {};
}

async function get(tok, yol) {
  const y = await istek({ hostname: OAUTH, path: yol, method: "GET",
    headers: { Authorization: "Bearer " + tok } });
  const j = json(y.govde);
  const h = hataMi(j);
  if (y.durum < 200 || y.durum >= 300 || h) throw new Error(`TikTok ${yol} basarisiz (HTTP ${y.durum})${h ? ": " + h : ""}`);
  return (j && j.data) || {};
}

async function userInfo(tok) {
  const data = await get(tok, "/v2/user/info/?fields=open_id,display_name");
  const user = data.user || {};
  if (!user.open_id) throw new Error("TT_ACCOUNT_ID_UNAVAILABLE: authorized TikTok account could not be read");
  return { openId: user.open_id, displayName: user.display_name || null };
}

function accountFingerprint(openId) {
  return crypto.createHash("sha256").update(String(openId || "")).digest("hex");
}

function accountIdentity(actual, expectedFingerprint = "") {
  const fingerprint = accountFingerprint(actual && actual.openId);
  if (expectedFingerprint && fingerprint !== expectedFingerprint) {
    throw new Error(`TT_ACCOUNT_MISMATCH: authorized account ${(actual && actual.displayName) || "(unnamed)"} does not match TT_EXPECTED_OPEN_ID_SHA256; upload blocked`);
  }
  return {
    displayName: actual && actual.displayName || null,
    openIdSha256: fingerprint,
    pinned: !!expectedFingerprint,
    matched: expectedFingerprint ? true : null,
  };
}

async function verifyAccountIdentity(tok, expectedFingerprint = env("TT_EXPECTED_OPEN_ID_SHA256")) {
  const actual = await userInfo(tok);
  return accountIdentity(actual, expectedFingerprint);
}

// Videoyu tek parca gonderir. TikTok kurali: her parca >=5 MB ve <=64 MB;
// SON parca chunk_size'i asabilir (<=128 MB). Tek parca = son parca, yani
// 128 MB'a kadar boyle gonderilebilir; 5 MB altindaki dosyalar da butun halinde.
const TEK_PARCA_SINIR = 128 * 1024 * 1024;

async function gonder(uploadUrl, dosya, boyut) {
  const u = new URL(uploadUrl);
  const y = await new Promise((coz, red) => {
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "PUT", headers: {
      "Content-Type": "video/mp4", "Content-Length": boyut, "Content-Range": `bytes 0-${boyut - 1}/${boyut}` } }, (res) => {
      const p = []; res.on("data", (d) => p.push(d));
      res.on("end", () => coz({ durum: res.statusCode, govde: Buffer.concat(p).toString("utf8") }));
    });
    r.on("error", red);
    r.setTimeout(600000, () => r.destroy(new Error("yukleme zaman asimi")));
    fs.createReadStream(dosya).pipe(r);
  });
  if (y.durum < 200 || y.durum >= 300) throw new Error(`TikTok dosya gonderimi basarisiz (HTTP ${y.durum}): ${y.govde.slice(0, 300)}`);
}

// Gelen kutusuna yukle: init -> PUT -> publish_id
async function inboxYukle(tok, dosya) {
  const boyut = fs.statSync(dosya).size;
  if (boyut > TEK_PARCA_SINIR) throw new Error(`Video cok buyuk (${(boyut / 1e6).toFixed(1)} MB) — tek parca siniri 128 MB`);
  const d = await api(tok, "/v2/post/publish/inbox/video/init/", {
    source_info: { source: "FILE_UPLOAD", video_size: boyut, chunk_size: boyut, total_chunk_count: 1 } });
  if (!d.upload_url || !d.publish_id) throw new Error("TikTok init yaniti eksik (upload_url/publish_id yok)");
  await gonder(d.upload_url, dosya, boyut);
  return { publishId: d.publish_id, boyut };
}

// Isleme durumu: PROCESSING_UPLOAD | SEND_TO_USER_INBOX | FAILED
const durum = (tok, publishId) => api(tok, "/v2/post/publish/status/fetch/", { publish_id: publishId });

async function durumGuvenli(tok, publishId, attempts = 3) {
  let error;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await durum(tok, publishId); }
    catch (caught) {
      error = caught;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw error;
}

async function durumBekle(tok, publishId, ops = {}) {
  const bitis = Date.now() + (ops.saniye || 180) * 1000;
  let son = null;
  while (Date.now() < bitis) {
    son = await durumGuvenli(tok, publishId);
    if (son.status && son.status !== "PROCESSING_UPLOAD" && son.status !== "PROCESSING_DOWNLOAD") return son;
    await new Promise((r) => setTimeout(r, ops.aralik || 10000));
  }
  return son || { status: "PROCESSING_UPLOAD" };
}

module.exports = { GEREKLI, kimlikVar, token, koddanJeton, api, get, userInfo, accountFingerprint,
  accountIdentity, verifyAccountIdentity, inboxYukle, durum, durumGuvenli, durumBekle, hataMi, TEK_PARCA_SINIR };
