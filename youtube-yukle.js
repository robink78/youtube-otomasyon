// YOUTUBE YUKLEYICI — bitmis MP4'u YouTube Data API v3 ile yukler.
//
// Guvenlik ilkeleri (bu dosyanin tamami bunlara gore yazildi):
//   1) Kendiliginden CALISMAZ. Sadece acikca cagrildiginda ve ucu birden
//      kimlik bilgisi (.env / ortam) varken yukler.
//   2) Varsayilan gizlilik "private". Video herkese acik olmaz; sen panelden
//      inceleyip elle "public" yaparsin. Otomatik yayin YOK.
//   3) Ek npm bagimliligi yok — reponun ham-HTTPS stili. OAuth2 refresh_token
//      ile access_token alinir, sonra "resumable upload" yapilir.
//
// Kullanim:
//   node youtube-yukle.js <is-adi>            # yukler (kimlik varsa)
//   node youtube-yukle.js <is-adi> --dogrula  # KURU CALISMA: ne yuklenecegini
//                                             # gosterir, hicbir sey gondermez
//   node youtube-yukle.js <is-adi> --herkese-acik   # gizlilik: public (dikkat)
//   node youtube-yukle.js <is-adi> --liste-disi     # gizlilik: unlisted
//
// Kimlik bilgileri (.env ya da ortam degiskeni; GitHub Actions'ta Secrets):
//   YT_CLIENT_ID      Google Cloud OAuth istemci kimligi
//   YT_CLIENT_SECRET  Google Cloud OAuth istemci sirri
//   YT_REFRESH_TOKEN  Bir kez alinan yenileme jetonu (offline erisim)
//   YT_PRIVACY        (istege bagli) private | unlisted | public  (varsayilan private)
//   YT_CATEGORY_ID    (istege bagli) YouTube kategori kimligi (varsayilan 27=Egitim)
//
// Yukleme metni oncelik sirasi:
//   uretim/<is>/YUKLEME.json  ({ "baslik":"", "aciklama":"", "etiketler":[] })
//   -> yoksa paketleme motorlari: baslik = title-engine secimi (icerik/paket/<is>/titles.json,
//      yoksa konu.baslik), aciklama + etiketler = description-engine.js.
//   -> motor calismazsa konu.json (baslik/aciklama/etiketler) — eski davranis.
//
// Yukleme sonrasi: icerik/yayinlananlar.json kaydi (slug <-> videoId), format serisi +
// (yeterli video varsa) kume playlist'i, uzun formatta kapak (thumbnails.set).
// Sentetik/yeniden kurgu goruntu iceren videolarda status.containsSyntheticMedia=true.

const fs = require("fs");
const path = require("path");
const https = require("https");
const Channel = require("./core/channel-context");
const SELECTED = Channel.selectFromArgv(process.argv.slice(2));
const CHANNEL = SELECTED.channel;

const KOK = __dirname;

function env(ad) {
  if (/^YT_/.test(ad)) return CHANNEL.scopedEnv(ad);
  if (process.env[ad]) return String(process.env[ad]).trim();
  try {
    for (const l of fs.readFileSync(path.join(KOK, ".env"), "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === ad) return m[2].trim();
    }
  } catch (e) {}
  return "";
}

// --- Basit HTTPS yardimcisi (JSON / ham govde) ---------------------------
function istek(opt, govde) {
  return new Promise((coz, red) => {
    const r = https.request(opt, (res) => {
      const parcalar = [];
      res.on("data", (d) => parcalar.push(d));
      res.on("end", () => coz({
        durum: res.statusCode,
        basliklar: res.headers,
        govde: Buffer.concat(parcalar).toString("utf8"),
      }));
    });
    r.on("error", red);
    if (govde) r.write(govde);
    r.end();
  });
}

// --- Yukleme metni --------------------------------------------------------
function yuklemeMetni(BASE) {
  const ozelYol = path.join(BASE, "YUKLEME.json");
  if (fs.existsSync(ozelYol)) {
    const j = JSON.parse(fs.readFileSync(ozelYol, "utf8"));
    return {
      baslik: String(j.baslik || "").slice(0, 100),
      aciklama: String(j.aciklama || ""),
      etiketler: Array.isArray(j.etiketler) ? j.etiketler.map(String) : [],
    };
  }
  const slug = path.basename(BASE);
  try {
    const K = require("./lib/kutuphane");
    const konuP = K.uretimKonusu(slug);
    if (konuP && konuP.vaka) {
      const growthFile = K.paketYolu(slug, "growth-plan.json");
      const growth = fs.existsSync(growthFile) ? JSON.parse(fs.readFileSync(growthFile, "utf8")) : null;
      const growthTitle = growth && growth.channel === CHANNEL.slug && growth.readiness && growth.readiness.decision === "PUBLISH"
        && growth.titles && growth.titles.selected && growth.titles.selected.title;
      const t = K.paketYolu(slug, "titles.json");
      const secilen = fs.existsSync(t) ? JSON.parse(fs.readFileSync(t, "utf8")).secilen : null;
      const d = require("./description-engine").olustur(konuP);
      return { baslik: String(growthTitle || secilen || konuP.baslik).slice(0, 100), aciklama: d.metin, etiketler: d.etiketler };
    }
  } catch (e) { console.log("  (paketleme motoru kullanilamadi, konu.json metni: " + e.message + ")"); }
  const konu = JSON.parse(fs.readFileSync(path.join(BASE, "konu.json"), "utf8"));
  const baslik = String(konu.baslik || konu.baslik_en || path.basename(BASE)).slice(0, 100);
  const aciklama = String(konu.aciklama || konu._not || "");
  const etiketler = Array.isArray(konu.etiketler) ? konu.etiketler.map(String) : [];
  return { baslik, aciklama, etiketler };
}

// YouTube baslik/aciklamada '<' ve '>' reddedilir.
const temizle = (s) => String(s).replace(/[<>]/g, "");

// YouTube Data API sinirlari — yuklemeden ONCE dogrulanir (API hatasi yerine acik mesaj).
function metaDogrula(snippet, status) {
  const h = [];
  if (!snippet.title || !snippet.title.trim()) h.push("baslik bos");
  if ([...snippet.title].length > 100) h.push("baslik 100 karakteri asiyor");
  if (/[<>]/.test(snippet.title + snippet.description)) h.push("baslik/aciklamada < veya > var");
  if (Buffer.byteLength(snippet.description || "", "utf8") > 5000) h.push("aciklama 5000 bayti asiyor");
  // Etiketlerin toplam uzunlugu (bosluklu etiket tirnakla sayilir) <= 500
  const etiketUz = (snippet.tags || []).reduce((a, t) => a + t.length + (/\s/.test(t) ? 2 : 0), 0) + Math.max(0, (snippet.tags || []).length - 1);
  if (etiketUz > 500) h.push("etiketler toplam 500 karakteri asiyor (" + etiketUz + ")");
  if ((snippet.tags || []).some((t) => /[<>,]/.test(t))) h.push("etikette gecersiz karakter");
  if (status.publishAt) {
    if (status.privacyStatus !== "private") h.push("publishAt yalnizca private videoda kullanilabilir");
    if (Date.parse(status.publishAt) <= Date.now()) h.push("publishAt gecmiste");
  }
  return h;
}

// Yukleme hatasi kaydi — shorts-sira konuyu harcamaz, bildirim.js issue acar
function hataYaz(BASE, IS, neden) {
  try { fs.writeFileSync(path.join(BASE, "YUKLEME-HATASI.json"), JSON.stringify({ channel: CHANNEL.slug, channelName: CHANNEL.name, slug: IS, neden: String(neden).slice(0, 600),
    yetki: /YETKI_GECERSIZ|INVALID_GRANT|TOKEN_REVOKED|CLIENT_MISMATCH|CHANNEL_MISMATCH|MISSING_SECRET|invalid_grant/.test(neden), tarih: new Date().toISOString() }, null, 2)); } catch (e) {}
}

// --- Resumable upload -----------------------------------------------------
async function yuklemeOturumu(token, snippet, status) {
  const meta = JSON.stringify({ snippet, status });
  const y = await istek({
    hostname: "www.googleapis.com",
    path: "/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    method: "POST",
    headers: {
      "Authorization": "Bearer " + token,
      "Content-Type": "application/json; charset=UTF-8",
      "Content-Length": Buffer.byteLength(meta),
      "X-Upload-Content-Type": "video/*",
    },
  }, meta);
  if (y.durum !== 200 || !y.basliklar.location) {
    throw new Error("Yukleme oturumu acilamadi (HTTP " + y.durum + "): " + y.govde.slice(0, 400));
  }
  return y.basliklar.location; // yukleme URL'si
}

// offset > 0 resumes an interrupted resumable session from the first byte
// YouTube has not received (Content-Range), instead of uploading again.
function govdeyiGonder(yuklemeUrl, dosya, boyut, offset = 0) {
  const u = new URL(yuklemeUrl);
  return new Promise((coz, red) => {
    const headers = { "Content-Length": boyut - offset, "Content-Type": "video/*" };
    if (offset > 0) headers["Content-Range"] = `bytes ${offset}-${boyut - 1}/${boyut}`;
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "PUT", headers }, (res) => {
      const parcalar = [];
      res.on("data", (d) => parcalar.push(d));
      res.on("end", () => coz({ durum: res.statusCode, basliklar: res.headers, govde: Buffer.concat(parcalar).toString("utf8") }));
    });
    r.on("error", red);
    fs.createReadStream(dosya, offset > 0 ? { start: offset } : {}).pipe(r);
  });
}

// Bodyless PUT to a resumable session URL (status query).
function oturumPut(yuklemeUrl, headers) {
  const u = new URL(yuklemeUrl);
  return istek({ hostname: u.hostname, path: u.pathname + u.search, method: "PUT", headers });
}

// --- Ana akis -------------------------------------------------------------
async function main() {
  const argv = SELECTED.argv;
  const IS = argv.find((a) => !a.startsWith("--"));
  const kuru = argv.includes("--dogrula");
  let gizlilik = (env("YT_PRIVACY") || "private").toLowerCase();
  if (argv.includes("--herkese-acik")) gizlilik = "public";
  if (argv.includes("--liste-disi")) gizlilik = "unlisted";
  if (!["private", "unlisted", "public"].includes(gizlilik)) gizlilik = "private";

  if (!IS) {
    console.error("Kullanim: node youtube-yukle.js --channel <slug> <is-adi> [--dogrula] [--herkese-acik|--liste-disi]");
    process.exit(1);
  }

  const BASE = path.join(CHANNEL.paths.production, IS);
  if (!fs.existsSync(path.join(BASE, "konu.json"))) {
    console.error("Is bulunamadi: " + BASE);
    process.exit(1);
  }

  // Bitmis videoyu bul.
  const VID = path.join(BASE, "Videos");
  let dosya = path.join(VID, IS + ".mp4");
  if (!fs.existsSync(dosya)) {
    const mp4ler = fs.existsSync(VID)
      ? fs.readdirSync(VID).filter((f) => f.toLowerCase().endsWith(".mp4"))
      : [];
    if (!mp4ler.length) {
      console.error("Yuklenecek MP4 yok. Once render: node video-yap.js " + IS);
      process.exit(1);
    }
    dosya = path.join(VID, mp4ler.sort().pop());
  }
  const boyut = fs.statSync(dosya).size;

  const metin = yuklemeMetni(BASE);
  const snippet = {
    title: temizle(metin.baslik) || IS,
    description: temizle(metin.aciklama),
    tags: metin.etiketler.slice(0, 30),
    categoryId: env("YT_CATEGORY_ID") || "27",
  };
  // Gercekci sentetik/yeniden kurgu goruntu varsa YouTube'a beyan edilir (gizlenmez).
  let sentetik = false;
  let konuVerisi = {};
  try { konuVerisi = JSON.parse(fs.readFileSync(path.join(BASE, "konu.json"), "utf8")); sentetik = (konuVerisi.sahneler || []).some((x) => x.sentetik); } catch (e) {}
  const videoFormat = konuVerisi.format === "long" ? "long" : "short";
  const status = { privacyStatus: gizlilik, selfDeclaredMadeForKids: false, ...(sentetik ? { containsSyntheticMedia: true } : {}) };

  // Zamanlanmis yayin: kalite kapisi karari listedeyse video private yuklenir ve
  // belirlenen saatte YouTube tarafindan otomatik Public yapilir (publishAt).
  // BLOCK zaten yuklenmez; listede olmayan karar private kalir (elle inceleme).
  let publishAt = null, kapiKarari = null;
  try {
    const plan = require("./lib/ayar").ayar().publishing.schedule || {};
    const kapi = require("./lib/ortak").jsonOku(require("./lib/kutuphane").paketYolu(IS, "quality-gate.json"), null);
    kapiKarari = kapi ? (kapi.karar || kapi.decision) : null;
    if (plan.enabled && gizlilik === "private" && !argv.includes("--zamanlama-yok") && kapiKarari && (plan.gates || []).includes(kapiKarari)) {
      // Bugunun yerel yayin saati (Europe/Istanbul 21:00), gun bossa ve hala
      // gelecekteyse; yoksa sonraki bos gun. Uretim penceresi (calendar.js)
      // uretimin bu saatten en az minLeadMinutes once baslamasini zaten saglar.
      publishAt = require("./core/scheduling/calendar").publishSlot(CHANNEL, require("./lib/kutuphane").yayinlananlar(), new Date()).toISOString();
      status.publishAt = publishAt;
    }
  } catch (e) { console.log("  (zamanlama atlandi: " + e.message + ")"); }

  console.log("Dosya      : " + path.relative(KOK, dosya) + "  (" + (boyut / 1e6).toFixed(1) + " MB)");
  console.log("Kanal      : " + CHANNEL.name + " (" + CHANNEL.slug + ")");
  console.log("Baslik     : " + snippet.title);
  console.log("Gizlilik   : " + gizlilik + (gizlilik === "public" ? "  ⚠ HERKESE ACIK" : "") +
    (publishAt ? "  → otomatik Public: " + require("./lib/zamanlama").trSaat(new Date(publishAt)) : ""));
  console.log("Etiket     : " + (snippet.tags.join(", ") || "(yok)"));

  const credentials = CHANNEL.credentials();
  const kimlikVar = credentials.clientId && credentials.clientSecret && credentials.refreshToken;

  const metaHata = metaDogrula(snippet, status);
  if (kuru) {
    console.log("\n[--dogrula] KURU CALISMA. Hicbir sey yuklenmedi.");
    console.log("Meta dogrulama: " + (metaHata.length ? "HATA — " + metaHata.join("; ") : "gecti (baslik, aciklama, etiket, publishAt)"));
    if (metaHata.length) process.exitCode = 6;
    console.log("Kimlik bilgileri: " + (kimlikVar ? "hazir (yukleme yapilabilir)" : "EKSIK"));
    console.log("Kanal kimligi: " + (CHANNEL.expectedChannelId() ? "configured; authenticated ID is checked before upload" : `EKSIK — ${CHANNEL.credentialNames.channelId[0]} gerekli, upload bloklanir`));
    if (!kimlikVar) {
      console.log("  Gereken: " + [CHANNEL.credentialNames.clientId[0], CHANNEL.credentialNames.clientSecret[0], CHANNEL.credentialNames.refreshToken[0]].join(", "));
      console.log("  Kurulum: docs/OAUTH-THREE-CHANNELS.md");
    }
    return;
  }

  // Defense in depth: orchestration already diverts REVIEW/BLOCK, but a direct
  // uploader invocation must not bypass the quality decision either.
  if (kapiKarari && kapiKarari !== "PUBLISH") {
    hataYaz(BASE, IS, `QUALITY_NOT_PUBLISHABLE: ${kapiKarari}`);
    console.error(`Kalite karari ${kapiKarari} — YouTube yuklemesi BLOKE EDILDI.`);
    process.exit(8);
  }

  if (!kimlikVar) {
    console.error("\nKimlik bilgileri eksik — yukleme YAPILMADI.");
    console.error("Gereken: " + [CHANNEL.credentialNames.clientId[0], CHANNEL.credentialNames.clientSecret[0], CHANNEL.credentialNames.refreshToken[0]].join(", "));
    console.error("Kurulum adimlari: docs/OAUTH-THREE-CHANNELS.md");
    console.error("Ne yuklenecegini gormek icin: node youtube-yukle.js " + IS + " --dogrula");
    process.exit(2);
  }

  if (metaHata.length) { hataYaz(BASE, IS, "meta dogrulama: " + metaHata.join("; ")); console.error("Meta dogrulama hatasi: " + metaHata.join("; ")); process.exit(6); }

  // --- Publish job / channel identity (fail closed) ---
  const Safety = require("./lib/publish-safety");
  const Ops = require("./lib/ops-log");
  const Quota = require("./lib/quota");
  const kanalKontrol = Safety.jobChannelCheck(konuVerisi, CHANNEL);
  if (!kanalKontrol.ok) {
    hataYaz(BASE, IS, `${kanalKontrol.code}: ${kanalKontrol.detail}`);
    Ops.event(CHANNEL, "publish.blocked", { slug: IS, code: kanalKontrol.code });
    console.error(`⛔ ${kanalKontrol.code}: ${kanalKontrol.detail} — yukleme YAPILMADI.`);
    process.exit(11);
  }
  const mod = Safety.publishMode(process.env, argv);

  console.log("\nOAuth jetonu aliniyor...");
  let token, api, kimlik;
  try {
    // The shared auth layer refreshes the short-lived access token, retries
    // transient failures and verifies channel identity before any mutation.
    const auth = await require("./lib/yt").getYouTubeClient(CHANNEL);
    token = auth.accessToken;
    api = auth.api;
    kimlik = auth.identity;
    console.log(`✓ Kanal kimligi dogrulandi: ${auth.identity.title || auth.identity.actual} (${auth.identity.actual})`);
  } catch (error) {
    hataYaz(BASE, IS, error.message);
    Ops.event(CHANNEL, "oauth.failure", { slug: IS, code: error.code || "AUTH_FAILED" });
    console.error("⛔ " + error.message);
    process.exit(7);
  }

  // --- Idempotency: key, journal, remote reconciliation (fail closed) ---
  const medyaSha = Safety.sha256File(dosya);
  const replacement = Safety.replacementCheck(konuVerisi, medyaSha);
  if (!replacement.ok) {
    hataYaz(BASE, IS, `${replacement.code}: ${replacement.detail}`);
    Ops.event(CHANNEL, "publish.blocked", { slug: IS, code: replacement.code });
    console.error(`⛔ ${replacement.code}: ${replacement.detail} — yukleme YAPILMADI.`);
    process.exit(13);
  }
  const anahtar = Safety.idempotencyKey({ channelId: kimlik.actual, mediaSha256: medyaSha, title: snippet.title, publishAt,
    replacementForVideoId: konuVerisi.replacementForVideoId, replacementVersion: konuVerisi.replacementVersion });
  const kayitTamamla = (videoId, kaynak) => {
    Safety.upsertIntent(CHANNEL, anahtar, { state: "COMPLETED", videoId, completedBy: kaynak });
    const library = require("./lib/kutuphane");
    const previous = library.yayinBul(IS) || {};
    library.yayinKaydet({ ...previous, channel: CHANNEL.slug, slug: IS, videoId, baslik: snippet.title,
      tarih: previous.tarih || new Date().toISOString(), format: videoFormat,
      gizlilik, publishAt: previous.publishAt || publishAt, kalite: previous.kalite || kapiKarari, kaynak, idempotencyKey: anahtar, mediaSha256: medyaSha,
      ...(replacement.replacement || {}) });
  };
  const onceki = Safety.findIntent(CHANNEL, anahtar);
  if (onceki && onceki.state === "COMPLETED" && onceki.videoId) {
    // YouTube already has it; the previous run died before the local commit.
    kayitTamamla(onceki.videoId, "journal-reconcile");
    Ops.event(CHANNEL, "publish.duplicate_prevented", { slug: IS, videoId: onceki.videoId, matchedBy: "journal" });
    console.log("✓ Bu video daha once yuklenmis (" + onceki.videoId + ") — tekrar YUKLENMEDI, yerel kayit tamamlandi.");
    return;
  }
  let devamOffset = 0, devamUrl = null;
  if (onceki && onceki.sessionUrl) {
    try {
      const durum = await Safety.sessionStatus(oturumPut, onceki.sessionUrl, boyut);
      if (durum.state === "COMPLETE" && durum.videoId) {
        kayitTamamla(durum.videoId, "session-reconcile");
        Ops.event(CHANNEL, "publish.duplicate_prevented", { slug: IS, videoId: durum.videoId, matchedBy: "resumable-session" });
        console.log("✓ Onceki yukleme oturumu tamamlanmis (" + durum.videoId + ") — tekrar YUKLENMEDI.");
        return;
      }
      if (durum.state === "INCOMPLETE") { devamUrl = onceki.sessionUrl; devamOffset = durum.received; }
    } catch (e) { console.log("  (onceki oturum sorgulanamadi; uzak kontrol yapilacak)"); }
  }
  let uzak;
  try {
    uzak = Safety.matchRemote(await Safety.recentUploads(api), { title: snippet.title, publishAt });
  } catch (e) {
    // Fail closed: without proof the video is absent, no upload happens.
    hataYaz(BASE, IS, "RECONCILE_UNAVAILABLE: " + (e.code || e.message));
    Ops.event(CHANNEL, "publish.blocked", { slug: IS, code: "RECONCILE_UNAVAILABLE" });
    console.error("⛔ Kanalin son yuklemeleri okunamadi — cift yukleme riski nedeniyle yukleme YAPILMADI (sonraki calisma tekrar dener).");
    process.exit(9);
  }
  if (uzak) {
    kayitTamamla(uzak.videoId, "duplicate-guard");
    Ops.event(CHANNEL, "publish.duplicate_prevented", { slug: IS, videoId: uzak.videoId, matchedBy: uzak.matchedBy });
    console.log("✓ Bu video kanalda zaten var (" + uzak.videoId + ", eslesme: " + uzak.matchedBy + ") — tekrar YUKLENMEDI, kayit tamamlandi.");
    return;
  }

  // --- Pre-flight report ---
  // Licensing gate (opt-in: PROVENANCE_REQUIRED=1): every external asset must
  // carry a licence, be cleared for this channel and be credited when required.
  const Provenance = require("./lib/provenance");
  const kaynakSorunlari = Provenance.check(Provenance.read(path.dirname(require("./lib/kutuphane").paketYolu(IS, "provenance.json"))), { channel: CHANNEL.slug, description: snippet.description });
  const butce = Quota.canAfford(CHANNEL, "videos.insert", require("./core/channel-context").allChannels());
  const onKontrol = {
    mode: mod, channel: CHANNEL.slug, authenticatedChannelId: kimlik.actual, mediaSha256: medyaSha, bytes: boyut,
    title: snippet.title, publishAt, privacy: gizlilik, qualityGate: kapiKarari, idempotencyKey: anahtar,
    replacement: replacement.replacement,
    remoteDuplicate: false, quota: { used: butce.used, needed: butce.needed, budget: butce.budget, ok: butce.ok },
    provenance: { required: process.env.PROVENANCE_REQUIRED === "1", problems: kaynakSorunlari },
    checkedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(BASE, "PUBLISH-PREFLIGHT.json"), JSON.stringify(onKontrol, null, 2) + "\n");
  if (mod === "shadow") {
    Ops.event(CHANNEL, "publish.shadow", { slug: IS, title: snippet.title, publishAt });
    console.log("✓ SHADOW: tum on kontroller gecti; yukleme oturumu ACILMADI (PUBLISH_MODE=shadow).");
    return;
  }
  if (process.env.PROVENANCE_REQUIRED === "1" && kaynakSorunlari.length) {
    hataYaz(BASE, IS, "PROVENANCE_INCOMPLETE: " + kaynakSorunlari.slice(0, 3).join("; "));
    Ops.event(CHANNEL, "publish.blocked", { slug: IS, code: "PROVENANCE_INCOMPLETE", problems: kaynakSorunlari.length });
    console.error("⛔ Kaynak/lisans kaydi eksik — yukleme YAPILMADI: " + kaynakSorunlari[0]);
    process.exit(12);
  }
  if (!butce.ok) {
    hataYaz(BASE, IS, `QUOTA_EXHAUSTED: ${butce.used}+${butce.needed} > ${butce.budget}`);
    Ops.event(CHANNEL, "quota.exhausted", { slug: IS, used: butce.used, needed: butce.needed, budget: butce.budget });
    console.error("⛔ Gunluk API kotasi yetmiyor — yukleme ertelendi.");
    process.exit(10);
  }

  // --- Upload (journaled, resumable, classified retries) ---
  Safety.upsertIntent(CHANNEL, anahtar, { state: "IN_FLIGHT", slug: IS, title: snippet.title, publishAt, mediaSha256: medyaSha, bytes: boyut });
  const sonuc = await Safety.runUpload({
    channel: CHANNEL, key: anahtar,
    resumeFrom: devamUrl ? { url: devamUrl, offset: devamOffset } : null,
    openSession: () => { console.log("Yukleme oturumu aciliyor..."); return yuklemeOturumu(token, snippet, status); },
    sendBody: (url, offset) => { console.log(`Video gonderiliyor (${(boyut / 1e6).toFixed(1)} MB${offset ? `, ${(offset / 1e6).toFixed(1)} MB'tan devam` : ""})...`); return govdeyiGonder(url, dosya, boyut, offset); },
    statusOf: (url) => Safety.sessionStatus(oturumPut, url, boyut),
    onRetry: (info) => { Ops.event(CHANNEL, "publish.retry", { slug: IS, ...info }); console.log(`  gecici hata (${info.kind}${info.status ? " HTTP " + info.status : ""}) — tekrar denenecek`); },
  });
  const sinif = sonuc.failure || null;
  const son = sonuc.ok ? { durum: 200, govde: JSON.stringify({ id: sonuc.videoId }) } : { durum: sinif && sinif.status || 0, govde: "" };
  if (sonuc.ok) {
    const j = JSON.parse(son.govde);
    // Journal first: if the local commit below fails, the next run reconciles
    // from the journal instead of uploading again.
    Safety.upsertIntent(CHANNEL, anahtar, { state: "COMPLETED", videoId: j.id, completedBy: "upload" });
    try { Quota.record(CHANNEL, "videos.insert"); } catch (e) {}
    Ops.event(CHANNEL, "publish.success", { slug: IS, videoId: j.id, publishAt, privacy: gizlilik });
    console.log("\n✓ Yuklendi. Video kimligi: " + j.id);
    console.log("  https://youtu.be/" + j.id + "  (gizlilik: " + gizlilik + ")");
    if (gizlilik !== "public") {
      console.log("  Herkese acmak icin YouTube Studio'dan inceleyip yayinla.");
    }
    // Kayit: slug <-> videoId (analiz, ic baglanti ve takvim bunu kullanir)
    try {
      require("./lib/kutuphane").yayinKaydet({ channel: CHANNEL.slug, slug: IS, videoId: j.id, baslik: snippet.title, tarih: new Date().toISOString(),
        format: videoFormat,
        gizlilik, publishAt, kalite: kapiKarari, kaynak: "upload", idempotencyKey: anahtar, mediaSha256: medyaSha,
        ...(replacement.replacement || {}) });
      // Bildirim (GitHub issue) icin ozet — bildirim.js okur
      fs.writeFileSync(path.join(BASE, "BILDIRIM.json"), JSON.stringify({ channel: CHANNEL.slug, channelName: CHANNEL.name, slug: IS, videoId: j.id, baslik: snippet.title,
        kalite: kapiKarari, publishAt, tarih: new Date().toISOString(), ...(replacement.replacement || {}) }, null, 2));
    } catch (e) { console.log("  (yayin kaydi yazilamadi: " + e.message + ")"); }
    try { const kol = require("./experiments").otomatikAta(j.id, snippet.title); if (kol) console.log("  deney: title-style / " + kol); } catch (e) {}
    // Seriye (playlist) ekle — binge/oturum suresi icin. Hata yuklemeyi bozmaz.
    try {
      const pl = require("./youtube-playlist");
      const konu = require("./lib/kutuphane").uretimKonusu(IS) || JSON.parse(fs.readFileSync(path.join(BASE, "konu.json"), "utf8"));
      await pl.ekle(token, j.id, pl.seriAdi(konu));
      await pl.kumeyeEkle(token, j.id, konu);
    } catch (e) {
      console.log("  (seriye eklenemedi: " + e.message + ")");
    }
    // Uzun formatta ozel kapak (Shorts akisi video karesini kullanir)
    try {
      const td = path.join(BASE, "thumbnails");
      const jpg = fs.existsSync(td) ? fs.readdirSync(td).filter((f) => /^concept-1.*\.jpg$/.test(f))[0] : null;
      if (jpg && (JSON.parse(fs.readFileSync(path.join(BASE, "konu.json"), "utf8")).format === "long")) {
        const veri = fs.readFileSync(path.join(td, jpg));
        const r = await istek({ hostname: "www.googleapis.com", path: "/upload/youtube/v3/thumbnails/set?videoId=" + j.id, method: "POST",
          headers: { Authorization: "Bearer " + token, "Content-Type": "image/jpeg", "Content-Length": veri.length } }, veri);
        console.log(r.durum === 200 ? "  ✓ kapak yuklendi: " + jpg : "  (kapak yuklenemedi HTTP " + r.durum + " — kanal dogrulamasi gerekebilir)");
        if (r.durum === 200) {
          try { require("./lib/quota").record(CHANNEL, "thumbnails.set"); } catch (e) {}
          try { require("./core/growth/thumbnails").markSelected(CHANNEL, IS, path.relative(KOK, path.join(td, jpg)), j.id); } catch (e) {}
        }
      }
    } catch (e) { console.log("  (kapak: " + e.message + ")"); }
  } else {
    const kod = sinif ? sinif.kind : "UNKNOWN";
    Safety.upsertIntent(CHANNEL, anahtar, { state: "FAILED", failure: kod, failureStatus: son && son.durum || null });
    Ops.event(CHANNEL, "publish.failure", { slug: IS, kind: kod, status: son && son.durum || null });
    console.error("\nYukleme basarisiz (" + kod + (son && son.durum ? ", HTTP " + son.durum : "") + ").");
    hataYaz(BASE, IS, kod + (son && son.durum ? " HTTP " + son.durum : ""));
    process.exit(kod === "QUOTA" ? 10 : 1);
  }
}

module.exports = { metaDogrula, yuklemeMetni };

if (require.main === module) main().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
