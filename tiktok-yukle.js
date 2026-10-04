// TIKTOK YUKLEYICI — bitmis MP4'u TikTok gelen kutusuna gonderir.
//
// Guvenlik ilkeleri (youtube-yukle.js ile ayni):
//   1) Kendiliginden CALISMAZ: yalnizca acikca cagrildiginda ve uc kimlik
//      bilgisi de varken calisir.
//   2) Hicbir sey HERKESE ACIK yapilmaz. Video TikTok uygulamasindaki gelen
//      kutusuna duser; yayinlama karari ve son duzenleme SENDE kalir.
//   3) Ek npm bagimliligi yok.
//
// Ayni video iki kez gonderilmez: icerik/tiktok.json kaydi tutulur.
//
// Kullanim:
//   node tiktok-yukle.js <slug>              # gelen kutusuna gonder
//   node tiktok-yukle.js <slug> --dogrula    # KURU CALISMA: hicbir sey gonderilmez
//   node tiktok-yukle.js --gecmis            # YouTube'da olup TikTok'ta olmayan EN ESKI
//                                            # videoyu uretip gonderir (arayi kapatma)
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { KOK, jsonOku, jsonYaz, slugGecerli } = require("./lib/ortak");
const TT = require("./lib/tiktok");

const KAYIT = path.join(KOK, "icerik", "tiktok.json");
const kayitlar = () => jsonOku(KAYIT, []);
const kayitBul = (slug) => kayitlar().find((x) => x.slug === slug) || null;
const dahaOnceGonderildi = (record) => !!(record && (record.publishId || record.durum === "SEND_TO_USER_INBOX" || record.gonderildi));

function kaydet(k) {
  const l = kayitlar().filter((x) => x.slug !== k.slug);
  l.push(k);
  jsonYaz(KAYIT, l);
}

function videoYolu(slug) {
  const vd = path.join(KOK, "uretim", slug, "Videos");
  const tam = path.join(vd, slug + ".mp4");
  if (fs.existsSync(tam)) return tam;
  const l = fs.existsSync(vd) ? fs.readdirSync(vd).filter((f) => f.toLowerCase().endsWith(".mp4")).sort() : [];
  return l.length ? path.join(vd, l.pop()) : null;
}

function sha256(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function argValue(argv, name) {
  const inline = argv.find((item) => item.startsWith(name + "="));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith("--") ? argv[index + 1] : null;
}

function positionalArgs(argv) {
  const valued = new Set(["--source-result", "--result-file", "--expected-sha256"]);
  const result = [];
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (valued.has(item)) { index += 1; continue; }
    if (!item.startsWith("--")) result.push(item);
  }
  return result;
}

function sourceResult(argv, slug) {
  const resultPath = argValue(argv, "--source-result");
  if (!resultPath) return null;
  const result = jsonOku(path.resolve(resultPath), null);
  if (!result || result.slug !== slug || !result.uploaded || !result.videoId || !result.publishAt || !result.mp4Path || !result.mp4Sha256) {
    throw new Error("TODAY_RESULT_INVALID: successful YouTube production result is required");
  }
  const file = path.resolve(KOK, result.mp4Path);
  const relative = path.relative(KOK, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("TODAY_RESULT_INVALID: MP4 path is outside repository");
  if (!fs.existsSync(file)) throw new Error("TODAY_RESULT_INVALID: exact rendered MP4 is missing");
  const actual = sha256(file);
  if (actual !== result.mp4Sha256) throw new Error("TODAY_MP4_MISMATCH: rendered MP4 changed after YouTube production");
  return { result, file, sha256: actual };
}

function resultYaz(argv, value) {
  const target = argValue(argv, "--result-file");
  if (target) jsonYaz(path.resolve(target), value);
}

// TikTok aciklamasi — YouTube'unkinden AYRI. Akista yalnizca ilk satir gorunur, gerisi
// "more" arkasinda kalir; o yuzden sira: kanca -> sebep -> yorum sorusu -> etiketler.
// Etiketler her videoda ayni iskelette: #FailureReconstructed (marka, birikimi bulunur
// kilar) + #engineering, sonra kumeye ozel iki tane. #fyp / #foryou gibi doldurma
// etiketi KULLANILMAZ: erisim getirmiyor ve spam sinyali veriyor.
const KUME_ETIKET = {
  "spaceflight-disasters": ["#space", "#nasa"], "aviation-failures": ["#aviation", "#planecrash"],
  "maritime-disasters": ["#ships", "#maritime"], "bridge-failures": ["#bridges", "#civilengineering"],
  "structural-failures": ["#architecture", "#civilengineering"], "nuclear-accidents": ["#nuclear", "#coldwar"],
  "fire-and-explosions": ["#fire", "#safety"], "industrial-disasters": ["#industrial", "#safety"],
  "infrastructure-failures": ["#infrastructure", "#civilengineering"], "materials-failures": ["#materials", "#science"],
  "natural-hazards": ["#nature", "#science"],
};

// Ilk cumleyi al ve TikTok'a uygun kisaliga indir.
function kisaCumle(t, sinir = 120) {
  const c = String(t || "").trim().replace(/\s+/g, " ");
  if (!c) return "";
  const ilk = (c.match(/^[^.!?]*[.!?]/) || [c])[0].trim();
  return ilk.length <= sinir ? ilk : ilk.slice(0, sinir - 1).replace(/\s+\S*$/, "") + "…";
}

// Tartisma metninden SORUYU cikar (yorum getiren kisim odur; genelde son cumle).
// Soru yoksa ilk cumleye duser.
function soruCumlesi(t, sinir = 150) {
  const c = String(t || "").trim().replace(/\s+/g, " ");
  if (!c) return "";
  const sorular = c.match(/[^.!?]*\?/g);
  const sec = sorular && sorular.length ? sorular[sorular.length - 1].trim() : null;
  if (!sec) return kisaCumle(c, sinir);
  return sec.length <= sinir ? sec : sec.slice(0, sinir - 1).replace(/\s+\S*$/, "") + "…";
}

function aciklama(slug) {
  const K = require("./lib/kutuphane");
  const konu = K.uretimKonusu(slug) || {};
  const v = konu.vaka || {};
  const t = jsonOku(K.paketYolu(slug, "titles.json"), null);
  const baslik = String((t && t.secilen) || konu.baslik || slug).trim();
  const kume = v.kume || K.kumeBul(konu);
  const sebep = v.mekanizma ? "The cause: " + kisaCumle(v.mekanizma, 110).replace(/[.…]$/, "") + "."
    : kisaCumle(konu.aciklama, 110);
  // Tartisma sorusu yorum getirir; yoksa videodaki ekran sorusu kullanilir.
  const soru = v.tartisma ? soruCumlesi(v.tartisma, 150) : String(konu.soru || "").trim();
  return [baslik, sebep, soru,
    "Synthetic narration. Footage is real archival film or licensed stock.",
    [...new Set(["#FailureReconstructed", "#engineering", ...(KUME_ETIKET[kume] || ["#history", "#science"])])].join(" "),
  ].filter(Boolean).join("\n\n").slice(0, 2100);
}

async function main() {
  const argv = process.argv.slice(2);
  const kuru = argv.includes("--dogrula");
  if (argv.includes("--yetki-kontrol") || argv.includes("--durum-kontrol")) {
    const present = Object.fromEntries(TT.GEREKLI.map((key) => [key, !!process.env[key]]));
    if (!TT.kimlikVar()) throw new Error("TikTok kimlik bilgileri eksik");
    const token = await TT.token();
    const scopeOk = /(^|[\s,])video\.upload($|[\s,])/.test(token.kapsam) || !token.kapsam;
    const identity = await TT.verifyAccountIdentity(token.erisim);
    const result = { credentials: present, tokenRefresh: "ok", scope: token.kapsam || "unreported", videoUploadScope: scopeOk, identity };
    if (argv.includes("--durum-kontrol")) {
      result.records = [];
      for (const record of kayitlar().filter((item) => item.publishId)) {
        try {
          const remote = await TT.durumGuvenli(token.erisim, record.publishId);
          result.records.push({ slug: record.slug, publishId: record.publishId, recordedStatus: record.durum || null,
            remoteStatus: remote.status || null, failReason: remote.fail_reason || null, uploadedBytes: remote.uploaded_bytes ?? null });
        } catch (error) {
          result.records.push({ slug: record.slug, publishId: record.publishId, recordedStatus: record.durum || null,
            remoteStatus: "STATUS_CHECK_FAILED", error: String(error.message || error).slice(0, 240) });
        }
      }
    }
    console.log(JSON.stringify(result));
    resultYaz(argv, result);
    if (!scopeOk) process.exitCode = 3;
    return;
  }
  let slug = positionalArgs(argv)[0];
  if (!slug && argv.includes("--gecmis")) {
    const kuyruk = gecmisKuyrugu();
    if (!kuyruk.length) { console.log("TikTok arasi kapali — gonderilecek eski video yok."); return; }
    slug = kuyruk[0].slug;
    console.log(`Gecmis: ${kuyruk.length} video eksik, sirada "${slug}" (${kuyruk.slice(1, 4).map((x) => x.slug).join(", ") || "son"})`);
    // Video yerelde yoksa uret (Actions'ta uretim klasoru her calismada bostur)
    if (!videoYolu(slug)) {
      console.log("  yerelde video yok — uretiliyor (YouTube'a YUKLEME YOK)...");
      // PUBLISH=0 SART: bu video YouTube'da ZATEN yayinda; shorts-sira PUBLISH=1 ile
      // calisirsa ayni videoyu YouTube'a ikinci kez yuklemeye kalkar. Burada yalnizca
      // TikTok icin dosya uretiyoruz.
      const r = require("child_process").spawnSync("node", ["shorts-sira.js", slug],
        { cwd: KOK, stdio: "inherit", env: { ...process.env, PUBLISH: "0" } });
      if (r.status !== 0 || !videoYolu(slug)) { console.error("  uretilemedi — bu calismada atlandi"); return; }
    }
  }
  if (!slug) { console.error("Kullanim: node tiktok-yukle.js <slug> | --gecmis [--dogrula]"); process.exit(1); }
  if (!slugGecerli(slug)) { console.error("Gecersiz slug: " + slug); process.exit(1); }

  // Duplicate guard comes before file lookup, OAuth refresh, upload init, or any
  // other remote mutation. A publishId means TikTok accepted an init request;
  // even PROCESSING/FAILED records are not automatically sent a second time.
  const varOlan = kayitBul(slug);
  if (dahaOnceGonderildi(varOlan)) {
    const result = { slug, publishId: varOlan.publishId || null, status: varOlan.durum || "RECORDED", duplicatePrevented: true };
    console.log("✓ Bu video TikTok'a daha once gonderilmis — tekrar GONDERILMEDI.");
    console.log(JSON.stringify(result));
    resultYaz(argv, result);
    return;
  }

  const exact = sourceResult(argv, slug);
  const dosya = exact ? exact.file : videoYolu(slug);
  if (!dosya) { console.error("Yuklenecek MP4 yok: uretim/" + slug + "/Videos/"); process.exit(1); }
  const boyut = fs.statSync(dosya).size;
  const sourceSha256 = exact ? exact.sha256 : sha256(dosya);
  const expectedSha = argValue(argv, "--expected-sha256");
  if (expectedSha && sourceSha256 !== expectedSha) throw new Error(`MP4_SHA256_MISMATCH: ${slug} source does not match the expected YouTube artifact`);
  const source = exact ? "today-youtube-production-result" : expectedSha ? "today-youtube-artifact" : "historical-backlog";

  console.log("Dosya    : " + path.relative(KOK, dosya) + "  (" + (boyut / 1e6).toFixed(1) + " MB)");
  console.log("SHA-256  : " + sourceSha256);
  console.log("Aciklama : " + aciklama(slug).split("\n")[0]);
  if (boyut > TT.TEK_PARCA_SINIR) { console.error("Video 128 MB sinirini asiyor."); process.exit(1); }

  if (kuru) {
    console.log("\n[--dogrula] KURU CALISMA. Hicbir sey gonderilmedi.");
    console.log("Kimlik bilgileri: " + (TT.kimlikVar() ? "hazir" : "EKSIK (TT_CLIENT_KEY/TT_CLIENT_SECRET/TT_REFRESH_TOKEN)"));
    return;
  }
  if (!TT.kimlikVar()) { console.log("TikTok kimligi yok — gonderim atlandi (bkz. docs/TIKTOK.md)."); return; }

  const tok = await TT.token();
  if (!/video\.upload/.test(tok.kapsam) && tok.kapsam) throw new Error("TikTok yetkisinde video.upload kapsami yok — node tiktok-yetki.js");
  const identity = await TT.verifyAccountIdentity(tok.erisim);
  console.log(`TikTok hesap: ${identity.displayName || "(adsiz)"} (${identity.openIdSha256.slice(0, 12)}…, ${identity.pinned ? "pinned" : "UNPINNED"})`);
  console.log("Gonderiliyor (" + (boyut / 1e6).toFixed(1) + " MB)...");
  const { publishId } = await TT.inboxYukle(tok.erisim, dosya);
  // Persist the publishId before polling. If the runner dies after upload, a
  // later run sees this durable id and cannot create a duplicate inbox item.
  kaydet({ slug, publishId, durum: "PROCESSING_UPLOAD", tarih: new Date().toISOString(), boyut,
    sourceSha256, source,
    aciklama: aciklama(slug), hata: null });
  const d = await TT.durumBekle(tok.erisim, publishId);
  const basarili = d.status === "SEND_TO_USER_INBOX";
  console.log(basarili ? "\n✓ TikTok gelen kutusuna dustu. Uygulamadaki bildirime dokunup yayinla."
    : "\n⚠ TikTok durumu: " + (d.status || "?") + (d.fail_reason ? " (" + d.fail_reason + ")" : ""));

  const result = { slug, publishId, status: d.status || "?", duplicatePrevented: false,
    sourceSha256, source };
  kaydet({ slug, publishId, durum: result.status, tarih: new Date().toISOString(), boyut,
    sourceSha256, source: result.source, aciklama: aciklama(slug), hata: d.fail_reason || null });
  console.log(JSON.stringify(result));
  resultYaz(argv, result);
  if (!basarili && d.status === "FAILED") process.exit(1);
}

// YouTube'da yayinda olup TikTok'a hic gonderilmemis videolar, eskiden yeniye.
// TikTok sonradan baslatildigi icin arada fark olusur; gunluk is bunu birer birer kapatir.
function gecmisKuyrugu() {
  const K = require("./lib/kutuphane");
  const gonderilmis = new Set(kayitlar().map((x) => x.slug));
  return K.yayinlananlar()
    .filter((y) => y.slug && !gonderilmis.has(y.slug) && K.konuOku(y.slug))
    .sort((a, b) => String(a.publishAt || a.tarih).localeCompare(String(b.publishAt || b.tarih)));
}

module.exports = { aciklama, kayitBul, dahaOnceGonderildi, videoYolu, sha256, sourceResult, gecmisKuyrugu, main };

if (require.main === module) main().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
