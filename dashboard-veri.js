// DASHBOARD VERI — kanal buyume paneli icin veriyi toplar (panel.js /api/buyume).
//
// Kaynaklar yalnizca olculmus veridir: analytics/ (checkpoint'ler), analysis/
// (optimizer), analytics/kanal/ (abone/izlenme anliklari), icerik/paket/ (baslik
// kalibi, kapak duzeni, hook puani). Erisilemeyen metrik "unavailable" kalir.
//
// Desen icgoruleri (en iyi baslik kalibi, kume, uzunluk, gun/saat) grup basina
// yeterli ornek yoksa "low confidence (n=…)" olarak etiketlenir; cok kucuk
// kanalda sonuc cikarilmaz.
//
// Kullanim: node dashboard-veri.js   (JSON'u yazdirir)
"use strict";
const fs = require("fs");
const path = require("path");
const { KOK, jsonOku } = require("./lib/ortak");
const SELECTED = require("./core/channel-context").selectFromArgv(process.argv.slice(2));
const CHANNEL = SELECTED.channel;
const { ayar } = require("./lib/ayar");
const K = require("./lib/kutuphane");

function sonOlcum(id) {
  const dir = path.join(CHANNEL.paths.analytics, id);
  const l = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /\.json$/.test(f)).map((f) => jsonOku(path.join(dir, f), null)).filter(Boolean) : [];
  const a = jsonOku(path.join(CHANNEL.paths.analysis, id, "data.json"), null);
  if (a) l.push(a);
  return l.sort((x, y) => String(x.toplandi).localeCompare(String(y.toplandi))).pop() || null;
}

const deger = (m) => (m && m.durum === "ok" ? m.deger : null);
const medyan = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null; };
const GUNLER = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function topla() {
  const min = ayar().analytics.minSampleForInsight;
  const TE = require("./title-engine");
  const kanalDir = path.join(CHANNEL.paths.analytics, "kanal");
  const kanal = fs.existsSync(kanalDir) ? fs.readdirSync(kanalDir).filter((f) => f.endsWith(".json")).sort().map((f) => jsonOku(path.join(kanalDir, f), null)).filter(Boolean) : [];
  const videolar = K.yayinlananlar().map((y) => {
    const o = sonOlcum(y.videoId);
    const m = o ? o.metrikler : {};
    const hook = y.slug ? jsonOku(K.paketYolu(y.slug, "hook.json"), null) : null;
    const th = y.slug ? jsonOku(K.paketYolu(y.slug, "thumbnails.json"), null) : null;
    const kon = y.slug ? K.konuOku(y.slug) : null;
    const tr = o && o.trafik ? Object.fromEntries(o.trafik.map((t) => [t.kaynak, Math.round(t.oran * 1000) / 10])) : null;
    const d = new Date(y.publishAt || y.tarih);      // yayin ani (zamanlanmissa publishAt)
    return {
      videoId: y.videoId, slug: y.slug, baslik: y.baslik, format: y.format, tarih: y.tarih, gun: GUNLER[d.getUTCDay()], saatUTC: d.getUTCHours(),
      sureSn: o ? o.sureSn : null, olcum: o ? o.checkpoint || "optimizer" : null, olcumTarihi: o ? o.toplandi : null,
      views: deger(m.views), likes: deger(m.likes), comments: deger(m.comments), ctr: deger(m.ctr), impressions: deger(m.impressions),
      avd: deger(m.averageViewDuration), avp: deger(m.averageViewPercentage), subs: deger(m.subscribersGained),
      subsPer1000: o && o.turetilmis ? deger(o.turetilmis.subsPer1000) : null,
      browse: tr ? (tr.SUBSCRIBER || 0) + (tr.YT_OTHER_PAGE || 0) + (tr.BROWSE || 0) : null, suggested: tr ? tr.RELATED_VIDEO || 0 : null,
      search: tr ? tr.YT_SEARCH || 0 : null, shortsFeed: tr ? tr.SHORTS || 0 : null,
      returning: deger(m.returningViewers),
      baslikKalibi: TE.kalip(y.baslik), kapakDuzeni: th ? ((th.konseptler || []).find((c) => c.id === th.birincil) || {}).duzen || null : null,
      hookPuani: hook ? hook.mevcut.puan : null, kume: kon ? K.KUMELER[K.kumeBul(kon)].ad : null,
      teshis: o && o.teshis ? o.teshis.map((t) => t.kod) : [],
    };
  });
  const olculen = videolar.filter((v) => v.views != null);
  const toplam = (k) => { const a = olculen.map((v) => v[k]).filter((x) => x != null); return a.length ? a.reduce((x, y) => x + y, 0) : null; };
  const ortalama = (k) => { const a = olculen.map((v) => v[k]).filter((x) => x != null); return a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10 : null; };
  const ilk = kanal[0], son = kanal[kanal.length - 1];
  const ozet = {
    toplamIzlenme: son ? son.views : toplam("views"), abone: son ? son.subscribers : null,
    aboneBuyume: ilk && son && ilk !== son ? { baslangic: ilk.subscribers, simdi: son.subscribers, fark: son.subscribers - ilk.subscribers, from: ilk.tarih.slice(0, 10), to: son.tarih.slice(0, 10) } : null,
    videoBasinaIzlenme: olculen.length ? Math.round(toplam("views") / olculen.length) : null,
    ctr: ortalama("ctr"), avd: ortalama("avd"), avp: ortalama("avp"),
    subsPer1000: (() => { const s = toplam("subs"), v = toplam("views"); return s != null && v ? Math.round(s / v * 10000) / 10 : null; })(),
    browse: ortalama("browse"), suggested: ortalama("suggested"), search: ortalama("search"), returning: toplam("returning"),
  };
  // Desenler: grup -> n, medyan izlenme; yetersiz orneklem etiketlenir
  const desen = (anahtar, etiket) => {
    const g = {};
    for (const v of olculen) { const k = v[anahtar]; if (k == null) continue; (g[k] = g[k] || []).push(v.views); }
    const satir = Object.entries(g).map(([k, a]) => ({ grup: String(k), n: a.length, medyanIzlenme: medyan(a),
      guven: a.length >= min ? "ok" : `low confidence (n=${a.length}, need ${min})` })).sort((a, b) => b.medyanIzlenme - a.medyanIzlenme);
    return { etiket, satir, not: olculen.length < min * 2 ? `Only ${olculen.length} measured videos — patterns are descriptive, not conclusions.` : null };
  };
  const uzunlukKova = (v) => v.sureSn == null ? null : v.sureSn <= 30 ? "≤30 s" : v.sureSn <= 45 ? "31-45 s" : v.sureSn <= 60 ? "46-60 s" : v.sureSn <= 600 ? "1-10 min" : ">10 min";
  const hookKova = (v) => v.hookPuani == null ? null : v.hookPuani >= 80 ? "hook ≥80" : v.hookPuani >= 60 ? "hook 60-79" : "hook <60";
  olculen.forEach((v) => { v._uzunluk = uzunlukKova(v); v._hook = hookKova(v); });
  return {
    channel: CHANNEL.slug, channelName: CHANNEL.name, olusturuldu: new Date().toISOString(), analitikKapsami: olculen.some((v) => v.avp != null) ? "analytics" : "public counters only (Analytics API scope missing)",
    ozet, kanalGecmisi: kanal, videolar,
    desenler: [desen("baslikKalibi", "Title patterns"), desen("kapakDuzeni", "Thumbnail layouts"), desen("kume", "Topics (clusters)"),
      desen("_hook", "Hooks"), desen("_uzunluk", "Video length"), desen("gun", "Publish day (UTC)"), desen("saatUTC", "Publish hour (UTC)")],
  };
}

module.exports = { topla };

if (require.main === module) console.log(JSON.stringify(topla(), null, 2));
