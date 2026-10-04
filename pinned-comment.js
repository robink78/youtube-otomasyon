// PINNED COMMENT — her video icin teknik tartisma baslatan sabit yorum.
//
// Genel "What do you think?" YOK. Yorum: yaygin bir yanilgiyi duzeltir ya da
// gercek bir muhendislik ikilemini sorar, sonra izleyiciden bir sonraki
// vakayi ister (yorum + tartisma + yeni konu fikri + geri donen izleyici).
//
// YouTube API yorum SABITLEMEYI desteklemez: --post yorumu kanal adina yazar,
// sabitleme Studio'da tek tiktir (rapor bunu listeler).
//
// Kullanim:
//   node pinned-comment.js <slug> | --all        -> icerik/paket/<slug>/pinned-comment.txt
//   node pinned-comment.js --post-pending        yayinda (public) olup sabit yorumu olmayan videolara yazar
"use strict";
const path = require("path");
const { KOK, jsonOku, jsonYaz, metinYaz, sec } = require("./lib/ortak");
const { ayar } = require("./lib/ayar");
const K = require("./lib/kutuphane");

const DURUM = path.join(KOK, "icerik", "sabit-yorumlar.json");
const KAPANIS = [
  "Which engineering failure should we reconstruct next?",
  "Which case should Failure Reconstructed investigate next? Name it below.",
  "Got a failure you want rebuilt from the evidence? Drop the name below.",
  "What should the next reconstruction be — a bridge, a plane, a dam?",
];

function uret(konu, ops = {}) {
  const v = konu.vaka || {};
  const parca = [];
  if (v.yanilgi) parca.push(v.yanilgi);
  else if (v.mekanizma && v.tetik) parca.push(`The trigger was ${v.tetik}, but the failure mechanism was ${v.mekanizma}.`);
  if (v.tartisma) parca.push(v.tartisma);
  const bag = ops.baglanti;
  if (bag && bag.sabitYorumVideo && bag.sabitYorumVideo.url) parca.push(`Related reconstruction: ${bag.sabitYorumVideo.baslik} → ${bag.sabitYorumVideo.url}`);
  parca.push(sec(KAPANIS, konu.slug));
  return parca.join("\n\n");
}

function calistir(slug) {
  const konu = K.uretimKonusu(slug);
  if (!konu) throw new Error("konu yok: " + slug);
  const plan = require("./channel-plan").kur();
  const t = uret(konu, { baglanti: require("./channel-plan").baglanti(plan, slug) });
  metinYaz(K.paketYolu(slug, "pinned-comment.txt"), t);
  return t;
}

// Yayinlanmis (public) ve daha once yorum yazilmamis videolara sabit yorum adayi yaz.
async function bekleyenleriYaz() {
  if (!ayar().pinnedComment.post) { console.log("pinnedComment.post=false — atlandi"); return; }
  const yt = require("./lib/yt");
  // Comments are a YouTube write action: refresh and pin the authenticated
  // identity to the configured channel before reading or posting anything.
  const api = (await yt.getYouTubeClient()).api;
  const durum = jsonOku(DURUM, {});
  const kayit = K.yayinlananlar().filter((y) => y.slug && !durum[y.videoId]);
  if (!kayit.length) { console.log("Bekleyen sabit yorum yok."); return; }
  const vids = await yt.videolar(api, kayit.map((y) => y.videoId));
  for (const y of kayit) {
    const v = vids.find((x) => x.id === y.videoId);
    if (!v || v.status.privacyStatus !== "public") { console.log(`  - ${y.slug}: henuz public degil, bekliyor`); continue; }
    // Yerel durum dosyasi eski olabilir (baska bir calisma yazmis olabilir): YouTube'da
    // kanalin bu videoda zaten ust duzey yorumu varsa ASLA ikinci yorum yazma.
    const mevcut = await api.data("commentThreads?part=snippet&maxResults=100&videoId=" + y.videoId);
    const kendi = mevcut.ok ? (mevcut.veri.items || []).find((t) => {
      const a = t.snippet.topLevelComment.snippet.authorChannelId;
      return a && a.value === t.snippet.channelId;
    }) : null;
    if (!mevcut.ok) { console.log(`  - ${y.slug}: yorumlar okunamadi (${mevcut.neden}) — guvenlik icin atlandi`); continue; }
    if (kendi) {
      durum[y.videoId] = { slug: y.slug, commentId: kendi.id, tarih: kendi.snippet.topLevelComment.snippet.publishedAt, sabitlendi: false, kaynak: "existing" };
      jsonYaz(DURUM, durum);
      console.log(`  = ${y.slug}: kanalin yorumu zaten var — yazilmadi`);
      continue;
    }
    const metin = calistir(y.slug);
    const r = await api.post("commentThreads?part=snippet", { snippet: { videoId: y.videoId, topLevelComment: { snippet: { textOriginal: metin } } } });
    if (r.ok) {
      durum[y.videoId] = { slug: y.slug, commentId: r.veri.id, tarih: new Date().toISOString(), sabitlendi: false };
      console.log(`  ✓ ${y.slug}: yorum yazildi — Studio'da SABITLE (API sabitleyemez): https://studio.youtube.com/video/${y.videoId}/comments`);
    } else console.log(`  ✗ ${y.slug}: ${r.neden}`);
    jsonYaz(DURUM, durum);
  }
}

module.exports = { uret, calistir, bekleyenleriYaz, DURUM };

if (require.main === module) {
  const arg = process.argv[2];
  if (!arg) { console.error("Kullanim: node pinned-comment.js <slug> | --all | --post-pending"); process.exit(1); }
  if (arg === "--post-pending") bekleyenleriYaz().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
  else for (const s of arg === "--all" ? K.konular().map((k) => k.slug) : [arg]) {
    const t = calistir(s);
    if (arg !== "--all") console.log(t); else console.log("  ✓ " + s);
  }
}
