// BILDIRIM — otomasyonun HER ADIMI icin GitHub bildirimi (issue + yorum).
//
// Ek servis yok: GitHub Actions'in kendi GITHUB_TOKEN'i ile depoya issue/yorum yazilir
// ve depo sahibi @etiketlenir -> GitHub e-postasi + GitHub mobil uygulamasi bildirimi.
//
// Bir videonun yasam dongusu TEK issue'da toplanir (bildirim kalabaligi olmasin):
//   🎬 uretildi + zamanlandi (issue acilir: onizleme, denetim, kalite)
//   ✅ yayina girdi (yorum: saat + ilk izlenme)          — --yayin-kontrol / gunluk is
//   📈 24 sa / 3 gun / 7 gun / 14 gun / 30 gun sonuclari   (yorum: izlenme, izlenme orani,
//      izleyicinin ayrildigi saniye, teshis)
// Ayrica:
//   ❌ yukleme hatasi (issue; yetki bittiyse adim adim cozum)
//   ⛔ kalite kapisi engeli (issue)
//   🩺 sistem sagligi (tek issue: yetki bitmek uzere / Pexels / kutuphane azaldi; duzelince kapanir)
//   🚨 otomasyon hatasi (--is-hatasi <url>: is akisi coktu)
//   🚨 gun bos gecti (--gun-kontrol: GitHub gunun TUM zamanlanmis denemelerini atladi)
//   📊 haftalik ozet (Pazartesi: abone/izlenme degisimi, haftanin videolari, siradaki konular)
//
// Tekrar gonderim yok: icerik/bildirim-durum.json neyin bildirildigini tutar.
// Kullanim: node bildirim.js [--yayin-kontrol] [--gun-kontrol] [--is-hatasi <url>] [--kuru]
//   --kuru: GitHub'a hicbir sey yazmaz, mesajlari konsola basar (uctan uca test).
"use strict";
const fs = require("fs");
const path = require("path");
const https = require("https");
const { KOK, jsonOku, jsonYaz, bugun } = require("./lib/ortak");
const SELECTED = require("./core/channel-context").selectFromArgv(process.argv.slice(2));
const CHANNEL = SELECTED.channel;
const { trSaat } = require("./lib/zamanlama");

const KURU = process.argv.includes("--kuru");
const TOKEN = KURU ? "" : process.env.GITHUB_TOKEN || "";
const REPO = process.env.GITHUB_REPOSITORY || "eyazan/youtube-otomasyon";
const SAHIP = process.env.GITHUB_REPOSITORY_OWNER || REPO.split("/")[0];
const DURUM = path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "bildirim-durum.json" : "notification-state.json");
const kanalBaslik = (title) => `[${CHANNEL.name}] ${title}`;
const paketRepoYolu = path.relative(KOK, CHANNEL.paths.packages).split(path.sep).join("/");
const kaliteRaporu = CHANNEL.config.pathMode === "legacy-adapter" ? "quality-gate.md" : "quality-gate.json";

function gh(yontem, yol, govde) {
  return new Promise((coz) => {
    const b = govde ? JSON.stringify(govde) : null;
    const r = https.request({ hostname: "api.github.com", path: yol, method: yontem, headers: {
      Authorization: "Bearer " + TOKEN, "User-Agent": "failure-reconstructed-bot", Accept: "application/vnd.github+json",
      ...(b ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(b) } : {}) } }, (res) => {
      const p = []; res.on("data", (d) => p.push(d));
      res.on("end", () => { let j = null; try { j = JSON.parse(Buffer.concat(p).toString("utf8")); } catch (e) {} coz({ durum: res.statusCode, j }); });
    });
    r.on("error", () => coz({ durum: 0, j: null }));
    if (b) r.write(b);
    r.end();
  });
}

// ---------------- mesaj metinleri (saf fonksiyonlar, test edilir) ----------------
const TESHIS_TR = {
  INSUFFICIENT_DATA: "Henüz yeterli veri yok — bekleniyor.",
  LOW_IMPRESSIONS_GOOD_RETENTION: "İzleyenler videoyu tutuyor ama YouTube henüz az kişiye gösterdi.",
  HIGH_IMPRESSIONS_LOW_CTR: "Çok gösterildi, az tıklandı.",
  GOOD_CTR_LOW_RETENTION: "İzleyici erken ayrılıyor — sonraki senaryolarda açılış güçlendirilir.",
  GOOD_HOOK_WEAK_MIDDLE: "Açılış iyi, orta kısım zayıf.",
  HIGH_VIEWS_LOW_SUB_CONVERSION: "Çok izlendi ama az abone getirdi.",
  SEARCH_DEPENDENT: "İzlenmelerin çoğu aramadan geliyor.",
  NO_SUGGESTED_TRAFFIC: "Önerilen videolardan trafik yok.",
  HIGH_SUGGESTED: "Önerilenlerden güçlü trafik geliyor.",
  SHORTS_FEED_NOT_PICKED_UP: "Shorts akışına henüz girmedi.",
  WEAK_TOPIC_PACKAGING: "Başlık/konu paketi zayıf olabilir.",
  OUTPERFORMER: "Kanal ortalamasının üstünde 🎉",
  HEALTHY: "Sağlıklı.",
};

// Izleyici tutma egrisinde en sert dusus (hangi saniyede ve ne kadar)
function dususNoktasi(tutma, sureSn) {
  if (!Array.isArray(tutma) || tutma.length < 5 || !sureSn) return null;
  let en = null;
  for (let i = 1; i < tutma.length; i++) {
    const a = tutma[Math.max(0, i - 3)], b = tutma[i];
    const kayip = a.izleme - b.izleme;
    if (!en || kayip > en.kayip) en = { sn: Math.round(b.oran * sureSn), kayip };
  }
  return en && en.kayip > 0.05 ? en : null;
}

function denetimOzeti(slug) {
  const d = jsonOku(path.join(CHANNEL.paths.packages, slug, "denetim.json"), null);
  if (!d) return ["- ⚠️ Görsel denetim verisi yok"];
  const t = d.yaziTasmasi;
  return [
    t === 0 ? "- ✅ Yazı taşması yok" + (d.yaziOlcegi < 1 ? ` (yazılar %${Math.round(d.yaziOlcegi * 100)}'e küçültülerek sığdırıldı)` : "")
      : t === "olculemedi" ? "- ⚠️ Yazı taşması ölçülemedi" : `- ❌ Yazı taşması: ${t} karede`,
    d.sureFarki != null && d.sureFarki <= 0.5 ? `- ✅ Ses ve görüntü uyumlu (${d.videoSure?.toFixed(1)} sn)` : `- ❌ Ses/görüntü süresi uyumsuz (${d.videoSure} / ${d.sesSure} sn)`,
    (d.siyahToplam || 0) <= 0.4 ? "- ✅ Siyah kare yok" : `- ⚠️ Siyah kare: ${d.siyahToplam} sn`,
    (d.donukEnUzun || 0) <= 4 ? "- ✅ Donmuş görüntü yok" : `- ⚠️ Donmuş görüntü: ${d.donukEnUzun} sn`,
    d.ton === "stok-belgesel" ? "- 🎨 Kanal tonu uygulandı (stok görüntü)" : "- 🎞️ Arşiv görüntüsü (orijinal ton)",
  ];
}

function videoMesaji(b) {
  const zaman = b.publishAt ? trSaat(new Date(b.publishAt)) : null;
  const inceleme = b.kalite === "REVIEW";
  const baslik = kanalBaslik(zaman ? `🎬 ${b.baslik} — ${zaman} yayında` : `🎬 ${b.baslik} — private (elle yayınla)`);
  const govde = [
    `<!-- video:${b.videoId} -->`,
    `@${SAHIP} yeni Short hazır ve YouTube'a yüklendi.`, "",
    `**${b.baslik}**`, "",
    zaman ? `⏰ **${zaman}** otomatik olarak Public olacak (${new Date(b.publishAt).toISOString().slice(11, 16)} UTC). Senin bir şey yapmana gerek yok.`
      : "🔒 Private yüklendi — otomatik yayın planlanmadı. Studio'dan Public yap.",
    `🧪 Kalite kapısı: **${b.kalite || "?"}**` + (inceleme ? " (yayınlanır; rapor aşağıda)" : ""), "",
    "**Yayın öncesi otomatik kontrol:**", ...denetimOzeti(b.slug), "",
    `![önizleme](https://raw.githubusercontent.com/${REPO}/main/${paketRepoYolu}/${b.slug}/onizleme.jpg)`, "",
    `- Video: https://youtu.be/${b.videoId}`,
    `- Studio: https://studio.youtube.com/video/${b.videoId}/edit`,
    `- Kalite raporu: https://github.com/${REPO}/blob/main/${paketRepoYolu}/${b.slug}/${kaliteRaporu}`, "",
    ...tiktokBolumu(b.slug),
    "Bu issue videonun tüm yolculuğunu takip eder: yayına girince ve 24 saat / 3 gün / 7 gün sonuçları geldikçe buraya yorum düşer.",
    zaman ? "_İstemezsen: yayın saatinden önce Studio → Visibility → Schedule'ı kaldır._" : "",
  ].join("\n");
  return { baslik, govde, etiket: inceleme ? ["yeni-video", "review"] : ["yeni-video"] };
}

// TikTok gelen kutusuna da gonderildiyse: telefonda kopyalanacak hazir aciklama.
// Video henuz gonderilmediyse bolum hic cikmaz.
function tiktokBolumu(slug) {
  const k = jsonOku(path.join(CHANNEL.paths.state, "tiktok.json"), []).find((x) => x.slug === slug);
  if (!k || k.durum !== "SEND_TO_USER_INBOX") return [];
  return ["**📱 TikTok — gelen kutusunda, yayınlamak için:**",
    "TikTok uygulaması → Inbox → bildirime dokun. Açıklamayı aşağıdan kopyala, **AI-generated content** anahtarını aç, Post.", "",
    "```", k.aciklama || "(açıklama kaydı yok)", "```", ""];
}

function hataMesaji(h) {
  const adimlar = h.yetki ? [
    "**Tek seferlik çözüm:**",
    `1. Google Auth Platform → Audience durumunu **In production** yap`,
    `2. Bilgisayarda proje klasöründe: \`node youtube-yetki.js --channel ${CHANNEL.slug} --github\``,
    "3. Açılan tarayıcıda bu kanalın sahibi/yöneticisi Google hesabıyla giriş yap → izin ver",
    `4. Araç token'ı yazdırmadan \`${CHANNEL.credentialNames.refreshToken[0]}\` secret'ına ve kanal kimliğini \`${CHANNEL.credentialNames.channelId[0]}\` variable'ına kaydeder`,
    "5. Actions → *Multi-channel portfolio production* → Run workflow (ya da bir sonraki otomatik çalışmayı bekle)", "",
    "In production durumunda normal access-token yenilemeleri otomatik yapılır; haftalık token değişimi gerekmez.",
  ] : ["Otomasyon bir sonraki çalışmada tekrar deneyecek. Tekrarlarsa bu issue'ya bak."];
  return { baslik: kanalBaslik(`❌ Yükleme başarısız: ${h.slug}`), etiket: ["hata"], govde: [
    `@${SAHIP} video üretildi ama YouTube'a **yüklenemedi**. Konu harcanmadı; kuyrukta bekliyor.`, "",
    "Neden: `" + String(h.neden).replace(/`/g, "'").slice(0, 400) + "`", "", ...adimlar].join("\n") };
}

function saglikMesaji(s) {
  const sorun = (s.bulgular || []).filter((b) => b.durum !== "ok");
  if (!sorun.length) return null;
  const ikon = { uyari: "⚠️", kritik: "❌" };
  return { baslik: kanalBaslik(sorun.some((b) => b.durum === "kritik") ? "🩺 Sistem uyarısı — müdahale gerekiyor" : "🩺 Sistem uyarısı"),
    // Numeric countdown/inventory text changes every run. Deduplicate on the
    // actionable state so comments are emitted only when a threshold/code changes.
    etiket: ["saglik"], ozet: sorun.map((b) => b.ad + ":" + b.durum + ":" + (b.kod || "")).join("|"),
    govde: [`@${SAHIP} otomatik sağlık kontrolü (${trSaat(new Date(s.tarih))}):`, "",
      ...(s.bulgular || []).map((b) => `- ${ikon[b.durum] || "✅"} **${b.ad}** — ${b.mesaj}` + (b.cozum ? `\n  - Yapılacak: ${b.cozum}` : "")), "",
      "Sorun giderilince bu issue otomatik kapanır."].join("\n") };
}

function checkpointYorumu(o) {
  const m = o.metrikler || {};
  const d = (x, son = "") => (x && x.durum === "ok" ? x.deger + son : "—");
  const shorts = (o.trafik || []).find((t) => t.kaynak === "SHORTS");
  const dusus = dususNoktasi(o.tutma, o.sureSn);
  const etiket = { "1d": "24 saat", "3d": "3 gün", "7d": "7 gün", "14d": "14 gün", "30d": "30 gün" }[o.checkpoint] || o.checkpoint;
  return [`@${SAHIP} 📈 **${etiket} sonucu**`, "",
    `| İzlenme | Beğeni | Yorum | Ort. izlenme oranı | Net abone | Shorts akışı payı |`, "|---:|---:|---:|---:|---:|---:|",
    `| ${d(m.views)} | ${d(m.likes)} | ${d(m.comments)} | ${m.averageViewPercentage && m.averageViewPercentage.durum === "ok" ? "%" + Math.round(m.averageViewPercentage.deger) : "—"} | ${d(m.subscribersGained)} | ${shorts ? "%" + Math.round(shorts.oran * 100) : "—"} |`, "",
    ...(dusus ? [`📉 İzleyicilerin en çok ayrıldığı an: **${dusus.sn}. saniye** (izleyicinin ~%${Math.round(dusus.kayip * 100)}'i).`, ""] : []),
    "Teşhis: " + (o.teshis || []).map((t) => TESHIS_TR[t.kod] || t.kod).join(" · "), "",
    "_“—” = YouTube henüz vermedi (Analytics verisi ~2 gün gecikmeli); uydurulmaz._"].join("\n");
}

function yayindaYorumu(v) {
  const st = v.statistics || {};
  return `@${SAHIP} ✅ **Yayına girdi** — ${trSaat(new Date(v.snippet.publishedAt))}. Şu an ${st.viewCount ?? "?"} izlenme. https://youtu.be/${v.id}\n\n_İlk saatlerde az izlenme normaldir; Shorts dalgalar halinde dağıtılır. 24 saat sonucu buraya gelecek._`;
}

// Bugun video uretilmediyse mesaj (yoksa null). Kalite engeli ayri bildirilir; burada
// amac GitHub'in gunun TUM zamanlanmis denemelerini atladigi durumu yakalamak.
function bosGunMesaji(v) {
  if (v.bugunVar || !v.kalanKonu) return null;
  return { baslik: kanalBaslik(`🚨 Bugün video üretilmedi — ${v.tarih}`), etiket: ["hata"], govde: [
    `@${SAHIP} bugün (${v.tarih}) hiç video üretilmedi ve kuyrukta ${v.kalanKonu} konu bekliyor.`, "",
    "Bunun tek bilinen nedeni: GitHub günün **tüm** zamanlanmış denemelerini atlamış olması (09:00–19:23 TR arası tüm denemeler).", "",
    "**Yapılacak:** Actions → *Multi-channel portfolio production* → **Run workflow**. İlgili kanalı seçip çalıştır.",
    `${v.sunucu}/${REPO}/actions/workflows/portfolio-production.yml`, "",
    "Yarınki otomatik çalışma bundan etkilenmez.",
  ].join("\n") };
}

function slaHataMesaji(v) {
  const recoveryStarted = !!v.automaticRecoveryStarted;
  const verificationBlocked = !v.youtubeVerified;
  return { baslik: kanalBaslik(`🚨 ${recoveryStarted ? "Otomatik kurtarma başarısız" : "Üretim SLA doğrulaması başarısız"} — ${v.date || bugun()}`), etiket: ["hata"], govde: [
    `@${SAHIP} günlük üretim SLA kontrolü başarısız oldu${recoveryStarted ? " ve otomatik kurtarma çalıştıktan sonra da video hazır değil" : ""}.`, "",
    `- YouTube API doğrulaması: **${v.youtubeVerified ? "başarılı" : "başarısız"}**`,
    `- YouTube'da bugünün Short'u: **${v.youtubeTodayExists ? "var" : v.youtubeVerified ? "yok" : "bilinmiyor"}**`,
    `- Otomatik kurtarma: **${recoveryStarted ? "başlatıldı" : verificationBlocked ? "duplicate riskine karşı durduruldu" : "gerekmedi/başlatılmadı"}**`,
    `- Üretildi: **${v.produced ? "evet" : "hayır"}**`,
    `- YouTube'a yüklendi: **${v.uploaded ? "evet" : "hayır"}**`,
    `- publishAt ayarlandı: **${v.scheduled ? "evet" : "hayır"}**`,
    `- videoId doğrulandı: **${v.videoIdExists ? "evet" : "hayır"}**`,
    `- Kalite kapısı: **${v.quality || "yok"}**`,
    `- Normal bildirim: **${v.notificationExists ? "var" : "yok"}**`, "",
    ...(v.youtubeError ? [`- YouTube doğrulama hatası: \`${String(v.youtubeError).replace(/`/g, "'").slice(0, 240)}\``, ""] : []),
    `Çalışma kaydı: ${process.env.GITHUB_SERVER_URL || "https://github.com"}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID || ""}`,
    "API doğrulaması başarısızsa sistem fail-closed davranır ve olası duplicate yerine issue açar.",
  ].join("\n") };
}

function haftalikMesaj(v) {
  const fark = (a, b) => (a != null && b != null ? (a - b >= 0 ? "+" : "") + (a - b) : "?");
  return { baslik: kanalBaslik(`📊 Haftalık özet — ${v.tarih}`), etiket: ["haftalik"], govde: [
    `@${SAHIP} geçen haftanın özeti:`, "",
    `- Abone: **${v.simdi?.subscribers ?? "?"}** (${fark(v.simdi?.subscribers, v.once?.subscribers)} bu hafta)`,
    `- Toplam izlenme: **${v.simdi?.views ?? "?"}** (${fark(v.simdi?.views, v.once?.views)} bu hafta)`, "",
    "**Bu haftanın videoları:**", ...(v.videolar.length ? v.videolar.map((x) => `- ${x.baslik} — ${x.izlenme ?? "?"} izlenme — https://youtu.be/${x.videoId}`) : ["- (yok)"]), "",
    ...(v.ogrenme ? [v.ogrenme, ""] : []),
    "**Sıradaki konular:**", ...v.sira.map((s, i) => `${i + 1}. ${s}`), "",
    `🩺 Sistem: ${v.saglik}`, "",
    "Her şey otomatik. Sadece sorun olduğunda ayrı bir issue açılır."].join("\n") };
}

// ---------------- GitHub islemleri ----------------
const durumOku = () => jsonOku(DURUM, { gonderilen: {} });
function isaretle(d, anahtar) { d.gonderilen[anahtar] = new Date().toISOString(); }

async function issueAc(m) {
  if (!TOKEN) { console.log(`[bildirim] ${m.baslik}\n${m.govde}\n`); return { number: 0 }; }
  const r = await gh("POST", `/repos/${REPO}/issues`, { title: m.baslik, body: m.govde, labels: m.etiket });
  console.log(r.durum === 201 ? `✓ issue: ${r.j.html_url}` : `✗ issue acilamadi (HTTP ${r.durum})`);
  return r.j || {};
}
async function yorumYaz(no, metin) {
  if (!TOKEN || !no) { console.log(`[yorum #${no}] ${metin}\n`); return true; }
  const r = await gh("POST", `/repos/${REPO}/issues/${no}/comments`, { body: metin });
  console.log(r.durum === 201 ? `✓ yorum #${no}` : `✗ yorum yazilamadi #${no} (HTTP ${r.durum})`);
  return r.durum === 201;
}
async function etiketliIssuelar(etiket, durum = "open") {
  if (!TOKEN) return [];
  const r = await gh("GET", `/repos/${REPO}/issues?state=${durum}&labels=${etiket}&per_page=100`);
  const issues = Array.isArray(r.j) ? r.j : [];
  return issues.filter((issue) => {
    const title = String(issue.title || "");
    if (title.startsWith(`[${CHANNEL.name}]`)) return true;
    return CHANNEL.config.pathMode === "legacy-adapter" && !/^\[[^\]]+\]/.test(title);
  });
}
async function videoIssue(videoId) {
  const l = await etiketliIssuelar("yeni-video", "all");
  const i = l.find((x) => String(x.body || "").includes(videoId));
  return i ? i.number : null;
}

// ---------------- adimlar ----------------
async function yeniVideolar(d) {
  const uretim = CHANNEL.paths.production;
  const liste = fs.existsSync(uretim) ? fs.readdirSync(uretim).map((s) => jsonOku(path.join(uretim, s, "BILDIRIM.json"), null)).filter(Boolean) : [];
  for (const b of liste) {
    if (d.gonderilen["video:" + b.videoId]) continue;
    // Eski video issue'lari kapanir (yorumlar kapali issue'ya da duser ve bildirim gider)
    for (const i of await etiketliIssuelar("yeni-video")) if (TOKEN) await gh("PATCH", `/repos/${REPO}/issues/${i.number}`, { state: "closed" });
    await issueAc(videoMesaji(b));
    isaretle(d, "video:" + b.videoId);
  }
}

async function hatalar(d) {
  const uretim = CHANNEL.paths.production;
  const liste = fs.existsSync(uretim) ? fs.readdirSync(uretim).map((s) => jsonOku(path.join(uretim, s, "YUKLEME-HATASI.json"), null)).filter(Boolean) : [];
  for (const h of liste) {
    const k = "hata:" + h.slug + ":" + bugun();
    if (d.gonderilen[k]) continue;
    await issueAc(hataMesaji(h));
    isaretle(d, k);
  }
  const engel = Object.entries(jsonOku(path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "engellenen.json" : "blocked.json"), {})).filter(([, e]) => String(e.tarih || "").startsWith(bugun()));
  for (const [slug, e] of engel) {
    const k = "engel:" + slug + ":" + bugun();
    if (d.gonderilen[k]) continue;
    await issueAc({ baslik: kanalBaslik(`⛔ Kalite kapısı engelledi: ${slug}`), etiket: ["kalite-engeli"],
      govde: `@${SAHIP} bu konu yüklenmedi (kalite yetersiz). Sistem sıradaki konuya geçti; bugünkü video etkilenmez.\n\nNeden: ${e.neden}\n\nRapor: https://github.com/${REPO}/blob/main/${paketRepoYolu}/${slug}/${kaliteRaporu}` });
    isaretle(d, k);
  }
}

async function saglik(d) {
  const s = jsonOku(path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "saglik.json" : "health.json"), null);
  if (!s) return;
  // OAuth, capability and inventory health is consolidated by
  // youtube-oauth-health.yml into the persistent portfolio issue. Keeping the
  // per-channel publisher here would create three competing health issues.
  if (s.aggregateManaged) return;
  const m = saglikMesaji(s);
  const acik = await etiketliIssuelar("saglik");
  if (!m) {
    for (const i of acik) { await yorumYaz(i.number, "✅ Sorun giderildi — tüm kontroller geçti."); await gh("PATCH", `/repos/${REPO}/issues/${i.number}`, { state: "closed" }); }
    d.saglikOzet = null;
    return;
  }
  if (d.saglikOzet === m.ozet && acik.length) return;   // ayni durum: tekrar bildirme
  if (acik.length && TOKEN) {
    await gh("PATCH", `/repos/${REPO}/issues/${acik[0].number}`, { title: m.baslik, body: m.govde });
    await yorumYaz(acik[0].number, `@${SAHIP} sağlık durumu değişti:\n\n` + m.govde.split("\n").filter((x) => /^- /.test(x)).join("\n"));
  } else await issueAc(m);
  d.saglikOzet = m.ozet;
}

async function checkpointler(d) {
  const K = require("./lib/kutuphane");
  for (const y of K.yayinlananlar()) {
    const dir = path.join(CHANNEL.paths.analytics, y.videoId);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((x) => /^\d+d\.json$/.test(x))) {
      const k = "cp:" + y.videoId + ":" + f;
      if (d.gonderilen[k]) continue;
      const no = await videoIssue(y.videoId);
      if (no || !TOKEN) await yorumYaz(no, checkpointYorumu(jsonOku(path.join(dir, f), {})));
      isaretle(d, k);   // issue'su olmayan eski videolar haftalik ozette
    }
  }
}

async function yayinKontrol(d) {
  const K = require("./lib/kutuphane");
  const yt = require("./lib/yt");
  // Unexpected public publication: a video still scheduled for the future that
  // is already public (should never happen; private + publishAt is the rule).
  try {
    const erken = K.yayinlananlar().filter((y) => y.publishAt && Date.parse(y.publishAt) > Date.now() + 10 * 60000 && y.videoId && !d.gonderilen["erken:" + y.videoId]);
    if (erken.length && yt.kimlikVar()) {
      const api0 = yt.istemci(await yt.token());
      for (const v of await yt.videolar(api0, erken.map((y) => y.videoId))) {
        if (v.status && v.status.privacyStatus === "public") {
          require("./lib/ops-log").event(CHANNEL, "publish.unexpected_public", { videoId: v.id, publishAt: (erken.find((y) => y.videoId === v.id) || {}).publishAt });
          isaretle(d, "erken:" + v.id);
        }
      }
    }
  } catch (e) {}
  const bekleyen = K.yayinlananlar().filter((y) => y.publishAt && Date.parse(y.publishAt) <= Date.now() - 5 * 60000
    && Date.now() - Date.parse(y.publishAt) < 4 * 86400000 && !d.gonderilen["yayin:" + y.videoId]);
  if (!bekleyen.length || !yt.kimlikVar()) return;
  const api = yt.istemci(await yt.token());
  if (CHANNEL.expectedChannelId()) await yt.verifyChannelIdentity(api, CHANNEL);
  else if (CHANNEL.config.pathMode !== "legacy-adapter") return;
  const vids = await yt.videolar(api, bekleyen.map((y) => y.videoId));
  for (const y of bekleyen) {
    const v = vids.find((x) => x.id === y.videoId);
    const no = await videoIssue(y.videoId);
    if (v && v.status.privacyStatus === "public") {
      // Publish delay = when the scheduled video was first seen public vs its publishAt.
      try { require("./lib/ops-log").event(CHANNEL, "publish.public", { videoId: y.videoId, publishAt: y.publishAt, delayMinutes: Math.round((Date.now() - Date.parse(y.publishAt)) / 60000) }); } catch (e) {}
      await yorumYaz(no, yayindaYorumu(v)); isaretle(d, "yayin:" + y.videoId);
    }
    else if (Date.now() - Date.parse(y.publishAt) > 60 * 60000) {
      await issueAc({ baslik: kanalBaslik(`❌ Otomatik yayın gerçekleşmedi: ${y.baslik}`), etiket: ["hata"], govde:
        `@${SAHIP} video ${trSaat(new Date(y.publishAt))} saatinde Public olmalıydı ama durumu: **${v ? v.status.privacyStatus : "bulunamadı"}**.\n\nStudio'dan kontrol et: https://studio.youtube.com/video/${y.videoId}/edit` });
      isaretle(d, "yayin:" + y.videoId);
    }
  }
}

async function gunKontrol(d) {
  const K = require("./lib/kutuphane");
  const Calendar = require("./core/scheduling/calendar");
  const tz = CHANNEL.config.timezone || Calendar.DEFAULT_TIME_ZONE;
  const g = Calendar.dayKey(new Date(), tz);
  if (d.gonderilen["bosgun:" + g]) return;
  // Alarm yalnizca uretim SLA son saatinden sonra: sabah slotlari (09:00/09:30/10:00 TR)
  // ile son saat arasinda saatlik yeniden denemeler hala bugunun Short'unu uretebilir.
  const sonSaat = process.env.PRODUCTION_DEADLINE_UTC || "16:30";
  // Son saat, kontrol edilen Istanbul gununun (g) son saatidir; UTC tarihi degil. Gece
  // 22:27 UTC kontrolu Istanbul'da ertesi gune denk gelir ve o gunun uretimi henuz baslamamistir.
  if (Date.now() < Date.parse(`${g}T${sonSaat}:00Z`)) { console.log(`Uretim son saati (${sonSaat} UTC) henuz gelmedi — bos gun kontrolu atlandi.`); return; }
  // Bugun (Europe/Istanbul takvim gunu) URETILDI mi ya da bugune PLANLANDI mi — ikisi de "gun dolu" sayilir
  const bugunVar = !!Calendar.shortForDay(K.yayinlananlar(), g, tz, Calendar.shortSchedule(CHANNEL).publishTimeZone);
  const m = bosGunMesaji({ tarih: g, bugunVar, kalanKonu: K.kuyruk().length, sunucu: process.env.GITHUB_SERVER_URL || "https://github.com" });
  if (!m) { console.log(bugunVar ? "Bugun video uretildi — alarm yok." : "Kuyruk bos — alarm yok."); return; }
  await issueAc(m);
  isaretle(d, "bosgun:" + g);
}

// Haftalik ogrenme ozeti: kanalin kendi olcumlerinden (1. gun izlenme, izlenme
// orani) yayin saati, baslik kalibi ve konu bilinirligi karsilastirmasi +
// ogrenme motorunun gozlem/hipotez/benimsenen bulgulari (core/growth/weekly-learning).
function haftalikOgrenme() {
  const Weekly = require("./core/growth/weekly-learning");
  const Analytics = require("./core/growth/analytics");
  const Popularity = require("./core/growth/popularity");
  const legacy = CHANNEL.config.pathMode === "legacy-adapter";
  const ham = legacy ? require("./lib/kutuphane").konular() : (require("./core/discovery").universe(CHANNEL).topics || []);
  const popularityFor = (slug) => { const raw = ham.find((k) => k.slug === slug); const p = raw ? Popularity.forTopic(CHANNEL.slug, raw) : null; return p ? p.score : null; };
  const learning = jsonOku(path.join(CHANNEL.paths.memory, "growth-learning.json"), {});
  const Store = require("./core/growth/store");
  const records = Analytics.readAll(CHANNEL);
  const Warehouse = require("./core/analytics/warehouse");
  const uploads = records.filter((row) => row.contentType !== "long").map((row) => row.publishAt).filter(Boolean);
  const cadence = require("./core/growth/diagnosis").cadenceRisk(Warehouse.readTable(CHANNEL, "channel_daily").rows, uploads, require("./core/growth/config").forChannel(CHANNEL).diagnosis.cadence);
  return Weekly.markdown(Weekly.summarize(records, learning, { popularityFor,
    predictions: Store.readState(CHANNEL, "growth", "predictions.json", null),
    families: (Store.readState(CHANNEL, "growth", "topic-performance.json", { families: [] }) || {}).families,
    conversion: Analytics.conversionBreakdown(CHANNEL, records), cadence }));
}

async function haftalik(d) {
  const hafta = (() => { const t = new Date(); const p = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate() - ((t.getUTCDay() + 6) % 7))); return p.toISOString().slice(0, 10); })();
  if (new Date().getUTCDay() !== 1 || d.gonderilen["hafta:" + hafta]) return;
  const K = require("./lib/kutuphane");
  const kd = path.join(CHANNEL.paths.analytics, "kanal");
  const anlik = fs.existsSync(kd) ? fs.readdirSync(kd).filter((f) => /\.json$/.test(f)).sort() : [];
  const simdi = anlik.length ? jsonOku(path.join(kd, anlik[anlik.length - 1]), null) : null;
  const esik = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const once = anlik.filter((f) => f.slice(0, 10) <= esik).map((f) => jsonOku(path.join(kd, f), null)).pop() || (anlik.length ? jsonOku(path.join(kd, anlik[0]), null) : null);
  const hafta7 = K.yayinlananlar().filter((y) => Date.parse(y.publishAt || y.tarih) >= Date.now() - 7 * 86400000);
  let izl = {};
  try { const yt = require("./lib/yt"); if (yt.kimlikVar() && hafta7.length) { const api = yt.istemci(await yt.token());
    if (CHANNEL.expectedChannelId()) await yt.verifyChannelIdentity(api, CHANNEL);
    else if (CHANNEL.config.pathMode !== "legacy-adapter") throw new Error(`${CHANNEL.prefix}_YT_CHANNEL_ID missing`);
    for (const v of await yt.videolar(api, hafta7.map((y) => y.videoId))) izl[v.id] = v.statistics.viewCount; } } catch (e) {}
  const s = jsonOku(path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "saglik.json" : "health.json"), null);
  let ogrenme = null;
  try { ogrenme = haftalikOgrenme(); } catch (e) { console.log("Ogrenme ozeti olusturulamadi: " + e.message); }
  const m = haftalikMesaj({ tarih: bugun(), simdi, once, ogrenme, videolar: hafta7.map((y) => ({ ...y, izlenme: izl[y.videoId] })),
    sira: K.kuyruk().slice(0, 7).map((k) => k.baslik),
    saglik: s ? (s.bulgular.every((b) => b.durum === "ok") ? "tüm kontroller geçti ✅" : s.bulgular.filter((b) => b.durum !== "ok").map((b) => b.mesaj).join("; ")) : "bilinmiyor" });
  for (const i of await etiketliIssuelar("haftalik")) if (TOKEN) await gh("PATCH", `/repos/${REPO}/issues/${i.number}`, { state: "closed" });
  await issueAc(m);
  isaretle(d, "hafta:" + hafta);
}

async function main() {
  const d = durumOku();
  const slaIndex = process.argv.indexOf("--sla-failure");
  if (slaIndex > 0) {
    const report = jsonOku(path.resolve(process.argv[slaIndex + 1] || ""), { date: bugun() });
    const key = "sla-failure:" + (report.date || bugun());
    if (!d.gonderilen[key]) {
      await issueAc(slaHataMesaji(report));
      isaretle(d, key);
      if (TOKEN) jsonYaz(DURUM, d);
    }
    return;
  }
  const i = process.argv.indexOf("--is-hatasi");
  if (i > 0) {
    await issueAc({ baslik: kanalBaslik(`🚨 Otomasyon hata verdi — ${bugun()}`), etiket: ["hata"],
      govde: `@${SAHIP} günlük iş akışı hata ile bitti.\n\nKayıt: ${process.argv[i + 1] || "(bağlantı yok)"}\n\nKonu harcanmadı; bir sonraki çalışma tekrar dener. Tekrarlarsa bu kaydı incele.` });
    return;
  }
  const adimlar = process.argv.includes("--gun-kontrol") ? [yayinKontrol, gunKontrol]
    : process.argv.includes("--yayin-kontrol") ? [yayinKontrol]
    : [saglik, yeniVideolar, hatalar, yayinKontrol, checkpointler, haftalik];
  for (const f of adimlar) {
    try { await f(d); } catch (e) { console.log(`  (${f.name} atlandi: ${String(e.message).slice(0, 160)})`); }
  }
  // Durum yalnizca gercekten gonderildiyse yazilir (kuru calisma durumu kirletmez)
  if (TOKEN) {
    const kes = Date.now() - 120 * 86400000;
    for (const [k, t] of Object.entries(d.gonderilen)) if (Date.parse(t) < kes) delete d.gonderilen[k];
    jsonYaz(DURUM, d);
  }
}

module.exports = { haftalikOgrenme, videoMesaji, hataMesaji, saglikMesaji, checkpointYorumu, yayindaYorumu, haftalikMesaj, bosGunMesaji, slaHataMesaji, dususNoktasi, TESHIS_TR };

if (require.main === module) main().catch((e) => { console.error("Hata: " + e.message); process.exit(0); });
