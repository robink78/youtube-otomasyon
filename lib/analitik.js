// ANALITIK — video metriklerini toplar ve teshis koyar. HICBIR DEGER UYDURULMAZ.
//
// Her metrik { deger, durum: "ok" | "unavailable", kaynak, neden } bicimindedir.
// Kaynaklar: YouTube Data API (izlenme/begeni/yorum — herkese acik sayaclar),
// YouTube Analytics API (izlenme suresi, tutma, trafik; yt-analytics.readonly
// kapsami gerekir), ve ELLE girilen Studio verisi (gosterim/CTR API'de yok):
//   analytics/<videoId>/studio-manual.json  { "impressions": 12345, "ctr": 4.1,
//                                             "returningViewers": 120, "tarih": "2026-10-01" }
"use strict";
const path = require("path");
const { KOK, jsonOku, bugun } = require("./ortak");
const CHANNEL = require("../core/channel-context").getChannel();
const yt = require("./yt");

const ok = (deger, kaynak) => ({ deger, durum: "ok", kaynak });
const yok = (neden) => ({ deger: null, durum: "unavailable", neden });

const TRAFIK_AD = { YT_SEARCH: "Search", RELATED_VIDEO: "Suggested", SUBSCRIBER: "Browse (subscribers)", YT_OTHER_PAGE: "Browse/other YouTube",
  BROWSE: "Browse", SHORTS: "Shorts feed", EXT_URL: "External", NO_LINK_OTHER: "Direct/unknown", PLAYLIST: "Playlists", YT_CHANNEL: "Channel page",
  NOTIFICATION: "Notifications", END_SCREEN: "End screens", ANNOTATION: "Annotations", HASHTAGS: "Hashtags", SOUND_PAGE: "Sound page" };

async function topla(api, video, ops = {}) {
  const id = video.id;
  const yayin = video.snippet.publishedAt.slice(0, 10);
  const bitis = ops.bitis || bugun();
  const st = video.statistics || {};
  const sn = yt.sureSn(video.contentDetails && video.contentDetails.duration);
  const m = {
    views: st.viewCount != null ? ok(+st.viewCount, "Data API") : yok("hidden"),
    likes: st.likeCount != null ? ok(+st.likeCount, "Data API") : yok("hidden"),
    comments: st.commentCount != null ? ok(+st.commentCount, "Data API") : yok("disabled/hidden"),
    impressions: yok("not exposed by YouTube APIs — export from Studio into studio-manual.json"),
    ctr: yok("not exposed by YouTube APIs — export from Studio into studio-manual.json"),
    returningViewers: yok("not exposed per video by the public API"),
    watchTimeMinutes: yok("analytics unavailable"), averageViewDuration: yok("analytics unavailable"),
    averageViewPercentage: yok("analytics unavailable"), subscribersGained: yok("analytics unavailable"),
    subscribersLost: yok("analytics unavailable"), netSubscribers: yok("analytics unavailable"),
    shares: yok("analytics unavailable"), engagedViews: yok("analytics unavailable"), first30sRetention: yok("analytics unavailable"),
  };
  let trafik = null, tutma = null, analitikNeden = null;
  if (api) {
    const a = await api.analytics({ startDate: yayin, endDate: bitis, filters: "video==" + id,
      metrics: "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,subscribersLost,shares" });
    if (a.ok) {
      const r = yt.satirlar(a)[0] || {};
      if (r.estimatedMinutesWatched != null) m.watchTimeMinutes = ok(r.estimatedMinutesWatched, "Analytics API");
      if (r.averageViewDuration != null) m.averageViewDuration = ok(r.averageViewDuration, "Analytics API");
      if (r.averageViewPercentage != null) m.averageViewPercentage = ok(r.averageViewPercentage, "Analytics API");
      if (r.subscribersGained != null) m.subscribersGained = ok(r.subscribersGained, "Analytics API");
      if (r.subscribersLost != null) m.subscribersLost = ok(r.subscribersLost, "Analytics API");
      if (r.subscribersGained != null && r.subscribersLost != null) m.netSubscribers = ok(r.subscribersGained - r.subscribersLost, "derived from Analytics API gained − lost");
      if (r.shares != null) m.shares = ok(r.shares, "Analytics API");
      if (r.engagedViews != null) m.engagedViews = ok(r.engagedViews, "Analytics API");
      const t = await api.analytics({ startDate: yayin, endDate: bitis, filters: "video==" + id, dimensions: "insightTrafficSourceType", metrics: "views" });
      if (t.ok) {
        const satir = yt.satirlar(t), top = satir.reduce((x, s) => x + s.views, 0);
        trafik = satir.map((s) => ({ kaynak: s.insightTrafficSourceType, ad: TRAFIK_AD[s.insightTrafficSourceType] || s.insightTrafficSourceType,
          views: s.views, oran: top ? s.views / top : 0 })).sort((a, b) => b.views - a.views);
      }
      const e = await api.analytics({ startDate: yayin, endDate: bitis, filters: "video==" + id + ";audienceType==ORGANIC",
        dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio,relativeRetentionPerformance" });
      if (e.ok) {
        tutma = yt.satirlar(e).map((s) => ({ oran: s.elapsedVideoTimeRatio, izleme: s.audienceWatchRatio, goreceli: s.relativeRetentionPerformance }));
        if (tutma.length && sn) {
          const hedef = Math.min(1, 30 / sn);
          const n = tutma.reduce((b, s) => Math.abs(s.oran - hedef) < Math.abs(b.oran - hedef) ? s : b, tutma[0]);
          m.first30sRetention = ok(n.izleme, `Analytics API (retention at ${Math.round(hedef * 100)}% of video)`);
        }
      }
    } else analitikNeden = a.neden;
  }
  if (analitikNeden) for (const k of Object.keys(m)) if (m[k].durum === "unavailable" && /analytics unavailable/.test(m[k].neden)) m[k].neden = analitikNeden;
  // Elle girilen Studio verisi (etiketli)
  const el = jsonOku(path.join(CHANNEL.paths.analytics, id, "studio-manual.json"), null);
  if (el) {
    if (el.impressions != null) m.impressions = ok(+el.impressions, "Studio (manual entry " + (el.tarih || "undated") + ")");
    if (el.ctr != null) m.ctr = ok(+el.ctr, "Studio (manual entry " + (el.tarih || "undated") + ")");
    if (el.returningViewers != null) m.returningViewers = ok(+el.returningViewers, "Studio (manual entry)");
  }
  const g = m.views.deger;
  const turetilmis = {
    subsPer1000: m.subscribersGained.durum === "ok" && g ? ok(Math.round(m.subscribersGained.deger / g * 10000) / 10, "derived") : yok("needs subscribersGained"),
    netSubsPer1000: m.netSubscribers.durum === "ok" && g ? ok(Math.round(m.netSubscribers.deger / g * 10000) / 10, "derived") : yok("needs subscribersGained and subscribersLost"),
    likeRate: m.likes.durum === "ok" && g ? ok(Math.round(m.likes.deger / g * 1000) / 10, "derived (% of views)") : yok("needs likes and views"),
    commentRate: m.comments.durum === "ok" && g ? ok(Math.round(m.comments.deger / g * 10000) / 100, "derived (% of views)") : yok("needs comments and views"),
  };
  const yas = Math.max(0, (Date.parse(bitis) - Date.parse(yayin)) / 86400000);
  return { videoId: id, baslik: video.snippet.title, yayin, yasGun: Math.round(yas * 10) / 10, sureSn: sn,
    format: sn != null && sn <= 60 ? "short" : "long", gizlilik: video.status && video.status.privacyStatus,
    metrikler: m, turetilmis, trafik, tutma, analitikDurumu: analitikNeden || (api ? "ok" : "offline"), toplandi: new Date().toISOString() };
}

// ---------------- teshis ----------------
// Esikler Shorts ve uzun format icin ayri. Yeterli veri yoksa teshis KONMAZ.
function teshis(v, paket = {}, ayarlar = { minViewsForRates: 100 }, baglam = {}) {
  // Bos trafik dizisi = veri henuz islenmedi (Analytics 1-2 gun gecikir), "sifir" DEGIL.
  const m = v.metrikler, t = v.trafik && v.trafik.length ? v.trafik : null;
  const kisa = v.format === "short";
  const g = m.views.deger || 0;
  const out = [];
  const ekle = (kod, guven, aciklama, oneri) => out.push({ kod, guven, aciklama, oneri });
  const pay = (kaynak) => t ? (t.find((x) => x.kaynak === kaynak) || { oran: 0 }).oran : null;
  const avp = m.averageViewPercentage.deger;
  const iyiTutma = avp != null && avp >= (kisa ? 80 : 50);
  const kotuTutma = avp != null && avp < (kisa ? 60 : 35);

  if (g < ayarlar.minViewsForRates || v.yasGun < 2) {
    ekle("INSUFFICIENT_DATA", "high", `${g} views after ${v.yasGun} days — too early/small for rate-based conclusions.`,
      "Do not change packaging yet unless something is objectively broken (missing sources, typo). Re-check at 7 days.");
  }
  if (m.impressions.durum === "ok" && m.ctr.durum === "ok") {
    if (m.impressions.deger >= 5000 && m.ctr.deger < (kisa ? 3 : 4)) ekle("HIGH_IMPRESSIONS_LOW_CTR", "medium",
      `${m.impressions.deger} impressions but CTR ${m.ctr.deger}%.`, "Test a new title/thumbnail (one change at a time, log it as an experiment).");
    if (m.impressions.deger < 1000 && iyiTutma) ekle("LOW_IMPRESSIONS_GOOD_RETENTION", "medium",
      "Viewers who arrive stay, but YouTube shows it to few people.", "Do not panic; improve topic packaging and cluster links, monitor audience matching.");
    if (m.ctr.deger >= (kisa ? 6 : 6) && kotuTutma) ekle("GOOD_CTR_LOW_RETENTION", "medium",
      "Packaging works; the video doesn't keep the promise long enough.", "Fix future hooks/structure; check the title promise matches the first 30 s.");
  } else if (iyiTutma && g < 500 && v.yasGun >= 3) {
    ekle("LOW_IMPRESSIONS_GOOD_RETENTION", "low", "Good retention with low reach (impressions unavailable — views used as a proxy).",
      "Monitor; strengthen cluster links and title/thumbnail packaging. Add Studio impressions/CTR to studio-manual.json for a firmer diagnosis.");
  }
  if (v.tutma && v.tutma.length >= 10 && !kisa) {
    const at = (r) => (v.tutma.reduce((b, s) => Math.abs(s.oran - r) < Math.abs(b.oran - r) ? s : b, v.tutma[0])).izleme;
    if (at(0.1) >= 0.7 && at(0.5) < 0.4) ekle("GOOD_HOOK_WEAK_MIDDLE", "medium", `Retention ${Math.round(at(0.1) * 100)}% at 10% but ${Math.round(at(0.5) * 100)}% at 50%.`,
      "Future scripts: add an open loop before the midpoint and tighten the technical middle with a diagram.");
  }
  // Abone donusumu: Shorts'ta tipik oran ~0.5-2 / 1.000 izlenme; 1.000 izlenmenin
  // altinda "0 abone" istatistiksel olarak anlamsiz (beklenen deger < 1).
  if (m.subscribersGained.durum === "ok" && g >= Math.max(ayarlar.minViewsForRates, 1000)) {
    const s1k = m.subscribersGained.deger / g * 1000;
    if (s1k < (kisa ? 1 : 3)) ekle("HIGH_VIEWS_LOW_SUB_CONVERSION", "medium", `${s1k.toFixed(1)} subscribers per 1,000 views.`,
      "Add a contextual CTA after the payoff (not in the opening), a pinned comment pointing to the series, and a clear related-video link.");
  }
  if (t && g >= ayarlar.minViewsForRates) {
    if (pay("YT_SEARCH") >= 0.5) ekle("SEARCH_DEPENDENT", "medium", `${Math.round(pay("YT_SEARCH") * 100)}% of views from Search.`,
      "Strengthen the Suggested network: cluster playlist, end screens, related links in description.");
    if (!kisa && pay("RELATED_VIDEO") < 0.05) ekle("NO_SUGGESTED_TRAFFIC", "medium", "Under 5% of views from Suggested videos.",
      "Build same-cluster follow-ups and link them; Suggested grows from videos watched together.");
    if (kisa && pay("SHORTS") < 0.5) ekle("SHORTS_FEED_NOT_PICKED_UP", "low", "Most views are not from the Shorts feed.",
      "Opening frame and first sentence decide feed pickup — review the hook.");
    if (pay("RELATED_VIDEO") >= 0.3) ekle("HIGH_SUGGESTED", "medium", `${Math.round(pay("RELATED_VIDEO") * 100)}% from Suggested.`,
      "Identify recommending videos in Studio (Traffic source → Suggested videos) and make a follow-up in that direction.");
  }
  // Olculen performans sezgisel puanin ONUNE gecer: kanal ortancasinin 2 kati+ izlenen
  // videonun paketlemesi "zayif" sayilmaz — kazanan kalip korunur ve ogrenilir.
  const ustun = baglam.medyan != null && g >= Math.max(300, baglam.medyan * 2);
  if (ustun) ekle("OUTPERFORMER", baglam.n >= 10 ? "medium" : "low",
    `${g} views vs channel median ${baglam.medyan} (n=${baglam.n} videos).`,
    "Keep the title and opening as they are. Reuse what worked (subject, hook shape) in the next episode of this cluster.");
  const tp = paket.titles;
  if (!ustun && tp && tp.mevcutPuan != null && ((tp.mevcutPuan < 50) || (tp.secilenPuan >= tp.mevcutPuan + 10))) {
    ekle("WEAK_TOPIC_PACKAGING", "low", `Current title scores ${tp.mevcutPuan}/100 in the title engine; best editorial option scores ${tp.secilenPuan}.`,
      "Heuristic only — test the stronger title as a logged experiment rather than switching silently.");
  }
  if (!out.length) ekle("HEALTHY", "low", "No problem pattern detected with available data.", "Keep; revisit at the next checkpoint.");
  return out;
}

// Kanal baglami: videolarin izlenme ortancasi (goreceli performans icin)
function baglam(videolar) {
  const g = videolar.map((x) => +(x.statistics || {}).viewCount || 0).sort((a, b) => a - b);
  if (!g.length) return { medyan: null, n: 0 };
  const m = g.length % 2 ? g[(g.length - 1) / 2] : (g[g.length / 2 - 1] + g[g.length / 2]) / 2;
  return { medyan: m, n: g.length };
}

module.exports = { topla, teshis, baglam, TRAFIK_AD, ok, yok };
