// POST-PUBLISH ANALYZER — her videoyu ~24s / 72s / 7g / 14g / 30g'de olcer.
//
// Checkpoint'ler config/growth.json > analytics.checkpoints (gun). Her olcum
// analytics/<videoId>/<N>d.json olarak saklanir; analytics/<videoId>/report.md
// zaman icindeki degisimi ve MUDAHALE ONERILERINI yazar. Ayrica kanal
// istatistikleri analytics/kanal/<tarih>.json (abone/izlenme buyumesi) olarak
// her calismada kaydedilir.
//
// ASLA silmez, yeniden yuklemez, otomatik degistirmez. Metrik uydurmaz.
//
// Kullanim:
//   node post-publish-analyzer.js --due        vadesi gelen tum checkpoint'ler (gunluk is akisi)
//   node post-publish-analyzer.js <videoId>    simdi olc (checkpoint disi, "manual")
"use strict";
const fs = require("fs");
const path = require("path");
const { KOK, jsonOku, jsonYaz, metinYaz, bugun, videoIdGecerli } = require("./lib/ortak");
const SELECTED = require("./core/channel-context").selectFromArgv(process.argv.slice(2));
const CHANNEL = SELECTED.channel;
const { ayar } = require("./lib/ayar");
const K = require("./lib/kutuphane");
const A = require("./lib/analitik");
const yt = require("./lib/yt");

const MUDAHALE = {
  HIGH_IMPRESSIONS_LOW_CTR: "LOW CTR → test a new thumbnail/title (one variable, logged in experiments.json).",
  GOOD_CTR_LOW_RETENTION: "GOOD CTR + LOW RETENTION → the packaging works; fix hook/structure in FUTURE videos of this cluster.",
  LOW_IMPRESSIONS_GOOD_RETENTION: "GOOD RETENTION + LOW IMPRESSIONS → do not panic; monitor audience matching, improve topic packaging and cluster links.",
  HIGH_VIEWS_LOW_SUB_CONVERSION: "HIGH VIEWS + LOW SUBS → improve subscriber conversion (contextual CTA after the payoff, series links, pinned comment).",
  SEARCH_DEPENDENT: "SEARCH ONLY → build the Suggested network: same-cluster follow-ups, playlist, end screens.",
  HIGH_SUGGESTED: "HIGH SUGGESTED → identify which videos recommend it (Studio → Traffic source → Suggested videos) and make a follow-up in that direction.",
  NO_SUGGESTED_TRAFFIC: "NO SUGGESTED → link it from related videos and the cluster playlist.",
  GOOD_HOOK_WEAK_MIDDLE: "GOOD HOOK, WEAK MIDDLE → future scripts: open loop before the midpoint; diagram in the technical section.",
  SHORTS_FEED_NOT_PICKED_UP: "NOT IN SHORTS FEED → review the opening frame and first sentence.",
  OUTPERFORMER: "OUTPERFORMER → keep as is; reuse its subject/hook shape in the next episode.",
  INSUFFICIENT_DATA: "INSUFFICIENT DATA → no intervention; wait for the next checkpoint.",
  WEAK_TOPIC_PACKAGING: "WEAK PACKAGING (heuristic) → candidate for a logged title experiment once data exists.",
  HEALTHY: "HEALTHY → no action.",
};

async function kanalAnlik(api) {
  const ch = await api.data("channels?part=statistics,snippet&mine=true");
  if (!ch.ok || !ch.veri.items || !ch.veri.items.length) return null;
  const st = ch.veri.items[0].statistics;
  const kayit = { tarih: new Date().toISOString(), subscribers: +st.subscriberCount, views: +st.viewCount, videos: +st.videoCount,
    kaynak: "Data API channels.statistics (subscriber count is rounded by YouTube above 1,000)" };
  jsonYaz(path.join(CHANNEL.paths.analytics, "kanal", bugun() + ".json"), { ...kayit, channel: CHANNEL.slug });
  return kayit;
}

function rapor(id, baslik, olcumler) {
  const s = [`# Post-publish analysis — ${baslik}`, "", `https://youtu.be/${id}`, "",
    "> Never deletes, re-uploads or edits automatically. Unavailable metrics are shown as unavailable.", "",
    "| Checkpoint | Collected | Views | Likes | Comments | Avg % viewed | Subs (net) | Top traffic |", "|---|---|---:|---:|---:|---:|---:|---|"];
  const d = (x) => x && x.durum === "ok" ? x.deger : "—";
  for (const o of olcumler) {
    const m = o.metrikler;
    s.push(`| ${o.checkpoint} | ${o.toplandi.slice(0, 10)} | ${d(m.views)} | ${d(m.likes)} | ${d(m.comments)} | ${d(m.averageViewPercentage)} | ${d(m.subscribersGained)} | ${o.trafik ? o.trafik.slice(0, 2).map((t) => `${t.ad} ${Math.round(t.oran * 100)}%`).join(", ") : "unavailable"} |`);
  }
  const son = olcumler[olcumler.length - 1];
  s.push("", `## Diagnosis at ${son.checkpoint}`, "", ...son.teshis.map((t) => `- **${t.kod}** (${t.guven}) — ${t.aciklama}`), "",
    "## Suggested interventions", "", ...[...new Set(son.teshis.map((t) => MUDAHALE[t.kod] || t.oneri))].map((x) => "- " + x), "");
  if (son.retentionDrop) s.push("## First major observed retention drop", "",
    `- Timestamp: ${son.retentionDrop.second}s; magnitude: ${Math.round(son.retentionDrop.magnitude * 100)} percentage points.`,
    `- Active sentence: ${son.retentionDrop.sentence || "unavailable"}`,
    `- Visual type: ${son.retentionDrop.visualType || "unavailable"}`,
    "- This is an observed alignment, not proof that the sentence or visual caused the drop.", "");
  if (olcumler.length >= 2) {
    const a = olcumler[olcumler.length - 2], b = son;
    const dv = (b.metrikler.views.deger ?? 0) - (a.metrikler.views.deger ?? 0);
    s.push(`Views gained between ${a.checkpoint} and ${b.checkpoint}: ${dv}.`, "");
  }
  return s.join("\n");
}

function retentionContext(measurement, slug) {
  const drop = require("./bildirim").dususNoktasi(measurement.tutma, measurement.sureSn);
  if (!drop || !slug) return null;
  const topic = K.uretimKonusu(slug) || {};
  const timeline = jsonOku(K.paketYolu(slug, "sahne-zamanlari.json"), []);
  let index = timeline.findIndex((row) => drop.sn >= row.bas && drop.sn <= row.son);
  if (index < 0 && (topic.sahneler || []).length && measurement.sureSn) {
    index = Math.min(topic.sahneler.length - 1, Math.floor(drop.sn / measurement.sureSn * topic.sahneler.length));
  }
  const scene = index >= 0 && (topic.sahneler || [])[index] || null;
  const source = String(scene && scene.kaynak || "");
  const visualType = scene && scene.sentetik ? "AI-GENERATED VISUAL"
    : /\.(?:jpe?g|png|webp)$/i.test(source) ? "REAL ARCHIVAL IMAGE"
      : source ? "REAL ARCHIVAL/LICENCED FOOTAGE" : "unavailable";
  return { second: drop.sn, magnitude: drop.kayip, sceneIndex: index >= 0 ? index : null,
    sentence: scene && scene.metin || null, visualType };
}

async function olc(api, video, checkpoint, baglam) {
  const v = await A.topla(api, video);
  const kon = K.yayinlananlar().find((y) => y.videoId === video.id);
  const paket = kon && kon.slug ? { titles: jsonOku(K.paketYolu(kon.slug, "titles.json"), null) } : {};
  const teshis = A.teshis(v, paket, ayar().analytics, baglam);
  const o = { ...v, checkpoint, teshis, retentionDrop: retentionContext(v, kon && kon.slug) };
  const dir = path.join(CHANNEL.paths.analytics, video.id);
  jsonYaz(path.join(dir, checkpoint + ".json"), o);
  const olcumler = fs.readdirSync(dir).filter((f) => /^\d+d\.json$|^manual-.*\.json$/.test(f))
    .map((f) => jsonOku(path.join(dir, f), null)).filter(Boolean).sort((a, b) => a.toplandi.localeCompare(b.toplandi));
  metinYaz(path.join(dir, "report.md"), rapor(video.id, video.snippet.title, olcumler));
  return o;
}

async function main() {
  const arg = SELECTED.argv[0];
  if (!arg) { console.error("Kullanim: node post-publish-analyzer.js --channel <slug> --due | <videoId>"); process.exit(1); }
  if (!yt.kimlikVar()) { console.log("YouTube kimligi yok — analiz atlandi (veri uydurulmaz)."); return; }
  const api = yt.istemci(await yt.token());
  const expected = CHANNEL.expectedChannelId();
  if (expected) {
    const identity = await yt.verifyChannelIdentity(api, CHANNEL);
    console.log(`✓ Analitik kanal kimligi dogrulandi: ${identity.title || identity.actual} (${identity.actual})`);
  } else if (CHANNEL.config.pathMode !== "legacy-adapter") {
    console.log(`${CHANNEL.prefix}_YT_CHANNEL_ID yok — yanlis kanal verisini kaydetmemek icin analiz atlandi.`);
    return;
  }
  const kanal = await kanalAnlik(api);
  if (kanal) console.log(`[${CHANNEL.name}] kanal: ${kanal.subscribers} abone, ${kanal.views} izlenme, ${kanal.videos} video`);
  const { ids } = await yt.yuklemeler(api);
  const hepsi = await yt.videolar(api, ids);
  const baglam = A.baglam(hepsi);
  if (arg !== "--due") {
    if (!videoIdGecerli(arg)) { console.error("Gecersiz video kimligi"); process.exit(1); }
    const v = hepsi.find((x) => x.id === arg);
    if (!v) { console.error("Video kanalda bulunamadi"); process.exit(1); }
    const o = await olc(api, v, "manual-" + bugun(), baglam);
    console.log(`✓ ${arg}: ${o.teshis.map((t) => t.kod).join(", ")} -> analytics/${arg}/report.md`);
    const Retention = require("./core/retention");
    const learned = Retention.learn(Retention.samplesFromAnalytics(CHANNEL), CHANNEL);
    console.log(`Learning: ${learned.status} (${learned.sampleSize}/${learned.minimumSample})`);
    return;
  }
  let n = 0;
  for (const v of hepsi) {
    if (v.status.privacyStatus !== "public") continue;
    const yas = (Date.now() - Date.parse(v.snippet.publishedAt)) / 86400000;
    for (const gun of ayar().analytics.checkpoints) {
      const dosya = path.join(CHANNEL.paths.analytics, v.id, gun + "d.json");
      if (yas >= gun && !fs.existsSync(dosya)) {
        // Gec kalinan checkpoint: yalnizca en son vadesi gelmis olani olc (gecmis yeniden kurulamaz)
        const sonraki = ayar().analytics.checkpoints.find((c) => c > gun);
        if (sonraki && yas >= sonraki) continue;
        const o = await olc(api, v, gun + "d", baglam);
        console.log(`  ✓ ${v.id} @${gun}d: ${o.teshis.map((t) => t.kod).join(", ")}`);
        n++;
      }
    }
  }
  console.log(`Bitti: ${n} checkpoint olculdu.`);
  // Growth engine pass: 1h/6h/12h/24h/48h/7d/14d/30d checkpoints, Shorts and
  // long-form baselines kept separate, diagnosis, channel-isolated learning.
  try {
    const growth = await require("./core/growth/runtime").analyticsPass(CHANNEL, hepsi, (video) => A.topla(api, video));
    console.log(`Growth analytics: ${growth.measured} checkpoint(s) · learning shorts=${growth.learning.shorts} longform=${growth.learning.longform}`);
  } catch (e) { console.log("  (growth analytics: " + e.message + ")"); }
  const Retention = require("./core/retention");
  const learned = Retention.learn(Retention.samplesFromAnalytics(CHANNEL), CHANNEL);
  console.log(`Learning: ${learned.status} (${learned.sampleSize}/${learned.minimumSample})`);
}

module.exports = { MUDAHALE, rapor, retentionContext };

if (require.main === module) main().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
