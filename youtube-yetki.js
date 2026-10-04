// YOUTUBE YETKI — bir kez calistir, YT_REFRESH_TOKEN uret.
//
// Bu, yuklemenin gerektirdigi "yenileme jetonunu" (refresh token) almanin
// tek seferlik yoludur. Tarayicida Google onayindan gecersin; jeton ekrana
// yazdirilmadan .env'e ve istege bagli olarak GitHub Secrets'a kaydedilir. Yukleme betikleri
// bundan sonra jetonu kendisi tazeler — bir daha giris gerekmez.
//
// Once .env'e kanal on ekli degerleri koy (ornegin FR_YT_CLIENT_ID ve
// FR_YT_CLIENT_SECRET; ImpossibleBrief icin IB_...).
// Adim adim kurulum: MALIYET-VE-YETKILER.md
//
// Kullanim:
//   node youtube-yetki.js

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const cp = require("child_process");
const { URL } = require("url");
const SELECTED = require("./core/channel-context").selectFromArgv(process.argv.slice(2));
const CHANNEL = SELECTED.channel;

const KOK = __dirname;
const PORT = 53682;
const REDIRECT = "http://localhost:" + PORT;
// force-ssl = yukleme + metadata guncelleme (youtube-guncelle.js icin gerekli).
// yt-analytics.readonly = izlenme suresi, tutma egrisi, trafik kaynaklari
// (existing-video-optimizer.js / post-publish-analyzer.js). Salt-okunur.
// Not: yeni scope'un etkili olmasi icin bir kez yeniden yetkilendirme gerekir;
// Google Cloud > OAuth consent > Data access'e "yt-analytics.readonly" eklenmeli.
const SCOPE = require("./lib/yt").REQUIRED_SCOPES.join(" ");
const STATE = crypto.randomBytes(32).toString("hex");
const SAVE_TO_GITHUB = SELECTED.argv.includes("--github");
const REPO_ARG = SELECTED.argv.find((arg) => arg.startsWith("--repo="));
const GITHUB_REPO = REPO_ARG ? REPO_ARG.slice("--repo=".length) : process.env.GITHUB_REPOSITORY || "eyazan/youtube-otomasyon";
const MODE_ARG = SELECTED.argv.find((arg) => arg.startsWith("--oauth-mode="));
const OAUTH_MODE = MODE_ARG ? MODE_ARG.slice("--oauth-mode=".length).toLowerCase() : null;
if (OAUTH_MODE && !["testing", "production"].includes(OAUTH_MODE)) {
  console.error("--oauth-mode testing veya --oauth-mode production olmali.");
  process.exit(1);
}

function env(ad) {
  if (process.env[ad]) return String(process.env[ad]).trim();
  try {
    for (const l of fs.readFileSync(path.join(KOK, ".env"), "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === ad) return m[2].trim();
    }
  } catch (e) {}
  return "";
}

function jetonDegistir(clientId, clientSecret, code) {
  const govde = new URLSearchParams({
    code, client_id: clientId, client_secret: clientSecret,
    redirect_uri: REDIRECT, grant_type: "authorization_code",
  }).toString();
  return new Promise((coz, red) => {
    const r = https.request({
      hostname: "oauth2.googleapis.com", path: "/token", method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded",
                 "Content-Length": Buffer.byteLength(govde) },
    }, (res) => {
      const p = [];
      res.on("data", (d) => p.push(d));
      res.on("end", () => coz({ durum: res.statusCode, govde: Buffer.concat(p).toString("utf8") }));
    });
    r.on("error", red);
    r.write(govde);
    r.end();
  });
}

// The expected channel ID must be known before consent. Locally it is often
// absent (.env rarely holds it), so with --github it is read from the
// repository variable. Without it a personal account could be saved in place
// of the channel's Brand Account and the variable silently overwritten.
function githubVariable(name) {
  const result = cp.spawnSync("gh", ["variable", "get", name, "-R", GITHUB_REPO], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return result.status === 0 ? String(result.stdout || "").trim() : "";
}
const LOCAL_EXPECTED = CHANNEL.expectedChannelId();
const GITHUB_EXPECTED = SAVE_TO_GITHUB ? githubVariable(CHANNEL.credentialNames.channelId[0]) : "";
if (LOCAL_EXPECTED && GITHUB_EXPECTED && LOCAL_EXPECTED !== GITHUB_EXPECTED) {
  console.error(`${CHANNEL.credentialNames.channelId[0]} yerelde ${LOCAL_EXPECTED}, GitHub'da ${GITHUB_EXPECTED}. Hangisi dogru netlesmeden devam edilmez.`);
  process.exit(1);
}
const EXPECTED_CHANNEL_ID = LOCAL_EXPECTED || GITHUB_EXPECTED;
if (!EXPECTED_CHANNEL_ID && !SELECTED.argv.includes("--new-channel")) {
  console.error(`Beklenen kanal kimligi (${CHANNEL.credentialNames.channelId[0]}) bulunamadi; yanlis kanala jeton kaydetmemek icin durduruldu.`);
  console.error("Kimligi .env'e ekle ya da --github ile calistir. Ilk kez kurulan bir kanal icin bilerek --new-channel ekle.");
  process.exit(1);
}
if (EXPECTED_CHANNEL_ID) console.log(`[${CHANNEL.name}] Beklenen YouTube kanali: ${EXPECTED_CHANNEL_ID} — onay ekraninda bu kanali sec.`);

// A first-time (--new-channel) authorization records whichever channel the
// owner picks. It must never be a channel that already belongs to another
// configured channel, or this channel's uploads would land on that one.
const Registry = require("./core/channel-context");
const OTHER_CHANNEL_IDS = new Map();
for (const other of Registry.allChannels().filter((item) => item.slug !== CHANNEL.slug)) {
  const id = other.expectedChannelId() || (SAVE_TO_GITHUB ? githubVariable(other.credentialNames.channelId[0]) : "");
  if (id) OTHER_CHANNEL_IDS.set(id, other.name);
}
if (!EXPECTED_CHANNEL_ID && !SAVE_TO_GITHUB && !OTHER_CHANNEL_IDS.size) {
  console.log("⚠ Diger kanallarin kimlikleri okunamadi; yanlis kanal korumasi icin --github ile calistirman onerilir.");
}

const credentials = CHANNEL.credentials();
const clientId = credentials.clientId;
const clientSecret = credentials.clientSecret;

if (!clientId || !clientSecret) {
  console.error(`Once .env dosyasina ${CHANNEL.credentialNames.clientId[0]} ve ${CHANNEL.credentialNames.clientSecret[0]} yaz.`);
  console.error("Nasil alinir: docs/OAUTH-THREE-CHANNELS.md");
  process.exit(1);
}

const yetkiUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: clientId,
  redirect_uri: REDIRECT,
  response_type: "code",
  scope: SCOPE,
  access_type: "offline",   // refresh_token almak icin sart
  // Always show Google's account chooser. This prevents an existing browser
  // session from silently authorizing the wrong channel owner account, while
  // consent still guarantees a fresh refresh token for the selected account.
  prompt: "select_account consent",
  include_granted_scopes: "true",
  state: STATE,
}).toString();

function saveGitHub(name, value, type = "secret") {
  const result = cp.spawnSync("gh", [type, "set", name, "-R", GITHUB_REPO], {
    input: String(value), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(`GitHub ${type} kaydedilemedi: ${name}. gh auth durumunu kontrol et.`);
}

const sunucu = http.createServer(async (req, res) => {
  const u = new URL(req.url, REDIRECT);
  if (!u.searchParams.get("code") && !u.searchParams.get("error")) {
    res.writeHead(404); res.end(); return;
  }
  const hata = u.searchParams.get("error");
  if (hata) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Iptal edildi: " + hata + "</h2>");
    console.error("Yetki iptal edildi: " + hata);
    sunucu.close(); process.exit(1);
  }
  if (!u.searchParams.get("state") || u.searchParams.get("state") !== STATE) {
    res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Guvenlik dogrulamasi basarisiz. Yetkilendirmeyi yeniden baslatin.</h2>");
    console.error("OAuth state dogrulamasi basarisiz; kod ve token kabul edilmedi.");
    sunucu.close(); process.exit(1);
  }
  const code = u.searchParams.get("code");
  const y = await jetonDegistir(clientId, clientSecret, code);
  const j = JSON.parse(y.govde || "{}");
  if (y.durum === 200 && j.refresh_token) {
    let actual;
    try {
      const yt = require("./lib/yt");
      actual = await yt.authenticatedChannel(yt.istemci({ erisim: j.access_token, kapsam: String(j.scope || "") }));
      const expected = EXPECTED_CHANNEL_ID;
      if (expected && actual.id !== expected) throw new Error(`CHANNEL_ID_MISMATCH: authenticated ${actual.id} (${actual.title || "unknown"}), expected ${expected}`);
      if (OTHER_CHANNEL_IDS.has(actual.id)) throw new Error(`CHANNEL_ALREADY_ASSIGNED: ${actual.title || actual.id} (${actual.id}) belongs to ${OTHER_CHANNEL_IDS.get(actual.id)}; choose the ${CHANNEL.name} channel on the consent screen`);
    } catch (error) {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<h2>Yanlış YouTube kanalı. Jeton kaydedilmedi.</h2>");
      console.error("⛔ " + error.message + " — refresh token kaydedilmedi.");
      sunucu.close(); process.exit(1);
    }
    // Yetki ani kaydedilir: saglik.js Test modunda 5. gunde uyarir (config/yetki.json)
    try {
      const yp = CHANNEL.config.pathMode === "legacy-adapter" ? path.join(KOK, "config", "yetki.json") : path.join(CHANNEL.paths.state, "auth-state.json");
      fs.mkdirSync(path.dirname(yp), { recursive: true });
      const eski = fs.existsSync(yp) ? JSON.parse(fs.readFileSync(yp, "utf8")) : {};
      const now = new Date();
      const mode = OAUTH_MODE || eski.oauthMode || eski.mod || "unknown";
      const reauthDeadline = mode === "testing" ? new Date(now.getTime() + 7 * 86400000).toISOString() : null;
      fs.writeFileSync(yp, JSON.stringify({ ...eski, channel: CHANNEL.slug, authorizedAt: now.toISOString(), oauthMode: mode,
        reauthDeadline, yetkiTarihi: now.toISOString(), mod: mode }, null, 2) + "\n");
      console.log("  Kanal OAuth yetkilendirme tarihi yerel state'e kaydedildi.");
    } catch (e) {}
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Tamam. Token guvenli depoya kaydedildi; bu pencereyi kapatabilirsiniz.</h2>");
    // Token terminale yazdirilmaz. Yerel .env git tarafindan yok sayilir.
    try {
      const envYol = path.join(KOK, ".env");
      let icerik = "";
      try { icerik = fs.readFileSync(envYol, "utf8"); } catch (e) {}
      const tokenName = CHANNEL.credentialNames.refreshToken[0];
      const tokenPattern = new RegExp("^" + tokenName + "=.*$", "m");
      if (tokenPattern.test(icerik)) {
        icerik = icerik.replace(tokenPattern, tokenName + "=" + j.refresh_token);
      } else {
        icerik += (icerik && !icerik.endsWith("\n") ? "\n" : "") + tokenName + "=" + j.refresh_token + "\n";
      }
      fs.writeFileSync(envYol, icerik, { mode: 0o600 });
      try { fs.chmodSync(envYol, 0o600); } catch (error) {}
      console.log(`\n✓ Basarili. ${tokenName} .env dosyasina yazildi.`);
      if (SAVE_TO_GITHUB) {
        // Store the client pair that minted this token under the same
        // preferred channel-scoped names. Otherwise a token saved as
        // FR_YT_REFRESH_TOKEN next to legacy YT_CLIENT_* secrets is an
        // incomplete bundle, which the health check correctly blocks.
        for (const [key, value] of [["clientId", clientId], ["clientSecret", clientSecret]]) {
          saveGitHub(CHANNEL.credentialNames[key][0], value, "secret");
          console.log(`✓ ${CHANNEL.credentialNames[key][0]} GitHub Actions secret olarak kaydedildi (deger yazdirilmadi).`);
        }
        saveGitHub(tokenName, j.refresh_token, "secret");
        console.log(`✓ ${tokenName} GitHub Actions secret olarak kaydedildi (deger yazdirilmadi).`);
        // Never overwrite an existing expected ID; the match was verified above.
        if (!GITHUB_EXPECTED) {
          saveGitHub(CHANNEL.credentialNames.channelId[0], actual.id, "variable");
          console.log(`✓ ${CHANNEL.credentialNames.channelId[0]} GitHub Actions variable olarak kaydedildi.`);
        } else {
          console.log(`✓ ${CHANNEL.credentialNames.channelId[0]} zaten ${GITHUB_EXPECTED}; kanal eslesmesi dogrulandi, degistirilmedi.`);
        }
      }
    } catch (e) {
      // Refresh token must never be printed to a terminal or Actions log. If
      // local persistence fails, discard it and repeat authorization after the
      // filesystem problem has been fixed.
      console.error(`\n⚠ ${CHANNEL.credentialNames.refreshToken[0]} kaydedilemedi. Jeton guvenlik nedeniyle yazdirilmadi; sorunu duzeltip yetkilendirmeyi yeniden calistir.`);
    }
    console.log(`✓ Yetkilendirilen kanal: ${actual.title || "(adsiz)"} (${actual.id})`);
    if (!EXPECTED_CHANNEL_ID && !SAVE_TO_GITHUB) console.log(`Yuklemeyi acmadan once ${CHANNEL.credentialNames.channelId[0]}=${actual.id} ekle.`);
    if (!OAUTH_MODE) console.log("⚠ OAuth Audience modu kaydedilemedi. Sonraki calistirmada --oauth-mode=testing veya --oauth-mode=production belirt.");
    console.log("Not: External OAuth Audience durumu In production olmali; Testing modunda refresh token 7 gunde sona erer.");
  } else {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end("<h2>Jeton alinamadi. Terminale bak.</h2>");
    const classified = require("./lib/yt").classifyOAuthFailure(y.durum, y.govde);
    console.error(`Jeton alinamadi: ${classified.code} (HTTP ${y.durum}).`);
    if (!j.refresh_token && j.access_token) {
      console.error("access_token geldi ama refresh_token gelmedi — Google onayini");
      console.error("iptal edip tekrar dene (prompt=consent zorunlu).");
    }
  }
  sunucu.close(); process.exit(0);
});

sunucu.listen(PORT, () => {
  console.log(`[${CHANNEL.name}] Tarayicida su adresi ac ve DOGRU kanal hesabi ile onayla:\n`);
  console.log(yetkiUrl + "\n");
  console.log("Onaydan sonra bu pencere " + REDIRECT + " adresine doner ve");
  console.log("refresh token terminale yazdirilmadan .env'e" + (SAVE_TO_GITHUB ? " ve GitHub Actions'a" : "") + " kaydedilir. (Dinleniyor: " + PORT + ")");
});
