// EXISTING VIDEO OPTIMIZER — yayinlanmis/uretilmis videolari analiz eder.
//
//   node existing-video-optimizer.js <videoId>     tek video
//   node existing-video-optimizer.js --all         kanaldaki tum videolar + migration plani
//   node existing-video-optimizer.js --sync        yalnizca slug <-> videoId kaydini doldur
//   (--offline: API cagirmaz, yalnizca yerel uretim verisini kullanir)
//
// Cikti: analysis/<videoId>/optimization-report.md + data.json
//        (--all) migration/current-videos.json + migration/EXISTING-VIDEOS-PLAN.md
//
// Kurallar: metrik UYDURULMAZ (erisilemeyen "unavailable" yazilir). Video
// SILINMEZ, YENIDEN YUKLENMEZ, otomatik DEGISTIRILMEZ — yalnizca oneri + komut.
"use strict";
const fs = require("fs");
const path = require("path");
const { KOK, jsonOku, jsonYaz, metinYaz, videoIdGecerli, bugun } = require("./lib/ortak");
const { ayar } = require("./lib/ayar");
const M = require("./lib/metin");
const K = require("./lib/kutuphane");
const A = require("./lib/analitik");

// ---------------- kayit eslestirme ----------------
function slugEslestir(baslik, kayit) {
  const r = kayit.find((y) => y.baslik === baslik && y.slug);
  if (r) return r.slug;
  let en = null, enS = 0;
  for (const k of K.konular()) {
    const s = Math.max(k.baslik === baslik ? 1 : 0, M.trigramBenzerlik(k.baslik, baslik));
    if (s > enS) { enS = s; en = k.slug; }
  }
  return enS >= 0.8 ? en : null;
}

async function senkron(api, videolar) {
  const kayit = K.yayinlananlar();
  let yeni = 0;
  for (const v of videolar) {
    if (kayit.some((y) => y.videoId === v.id)) continue;
    const slug = slugEslestir(v.snippet.title, kayit);
    K.yayinKaydet({ slug, videoId: v.id, baslik: v.snippet.title, tarih: v.snippet.publishedAt,
      format: (require("./lib/yt").sureSn(v.contentDetails.duration) || 0) <= 60 ? "short" : "long", kaynak: "backfill (title match)" });
    yeni++;
  }
  return yeni;
}

// ---------------- rapor bolumleri ----------------
function aciklamaSorunlari(d) {
  const s = [];
  const t = String(d || "");
  if (t.length < 120) s.push("very short — no documentary summary");
  if (!/wikimedia|archive\.org|pexels|footage|source/i.test(t)) s.push("no footage/source attribution");
  if (!/wikipedia|report|reference|https?:\/\/(?!youtu)/i.test(t)) s.push("no technical references");
  if (!/youtu\.be\/|youtube\.com\/watch|playlist\?list=/i.test(t)) s.push("no related-episode or playlist link (session growth)");
  const h = (t.match(/#\w+/g) || []).length;
  if (h > 5) s.push(`${h} hashtags — keep to 5`);
  if (!/synthetic voice|ai voice|narration/i.test(t)) s.push("no synthetic-voice disclosure line");
  return s;
}

function tablo(m) {
  const satir = (ad, x, birim = "") => `| ${ad} | ${x.durum === "ok" ? x.deger + birim : "unavailable"} | ${x.durum === "ok" ? x.kaynak : x.neden} |`;
  return ["| Metric | Value | Source / reason |", "|---|---|---|",
    satir("Views", m.views), satir("Likes", m.likes), satir("Comments", m.comments), satir("Impressions", m.impressions),
    satir("CTR", m.ctr, "%"), satir("Watch time", m.watchTimeMinutes, " min"), satir("Average view duration", m.averageViewDuration, " s"),
    satir("Average % viewed", m.averageViewPercentage, "%"), satir("Subscribers gained (net)", m.subscribersGained),
    satir("Shares", m.shares), satir("Returning viewers", m.returningViewers), satir("Retention at 30 s", m.first30sRetention)].join("\n");
}

function aksiyonlar(v, tes, kon, paket, bag, aciklamaS) {
  const l = [];
  const kod = new Set(tes.map((t) => t.kod));
  const ustun = kod.has("OUTPERFORMER");
  const baslikZayif = !ustun && paket.titles && paket.titles.secilenPuan >= (paket.titles.mevcutPuan || 0) + 8;
  if (ustun) l.push({ sinif: "KEEP", neden: "outperforming the channel — keep title and thumbnail; only fix objective gaps below" });
  if (baslikZayif) l.push({ sinif: "RETITLE", neden: `title engine: current ${paket.titles.mevcutPuan} vs "${paket.titles.secilen}" ${paket.titles.secilenPuan}` });
  if (v.format === "long") l.push({ sinif: "RETHUMBNAIL", neden: "long-form: test concept 1 vs current (custom thumbnails apply to long-form)" });
  if (aciklamaS.length) l.push({ sinif: "REDESCRIBE", neden: aciklamaS.join("; ") });
  if (bag && bag.playlist && bag.playlist.durum === "active" && bag.playlist.id) l.push({ sinif: "PLAYLIST_MOVE", neden: `add to cluster playlist "${bag.playlist.ad}" (keep existing series)` });
  if (bag && (bag.onceki || bag.sonraki) && aciklamaS.some((x) => /related-episode/.test(x))) l.push({ sinif: "ADD_INTERNAL_LINKS", neden: "a related published episode exists but is not linked" });
  if (!kon) l.push({ sinif: "REVIEW_MANUALLY", neden: "no matching production spec — check title/topic by hand" });
  if (kon && kon.vaka && kon.vaka.dogrulama) l.push({ sinif: "REVIEW_MANUALLY", neden: kon.vaka.dogrulama });
  if (l.filter((x) => ["RETITLE", "RETHUMBNAIL", "REDESCRIBE"].includes(x.sinif)).length >= 2 && !kod.has("INSUFFICIENT_DATA"))
    l.unshift({ sinif: "REPACKAGE", neden: "several packaging elements are weak at once" });
  if (!l.length) l.push({ sinif: "KEEP", neden: "no action needed with the data available" });
  let oncelik = "P4";
  if (kod.has("HIGH_IMPRESSIONS_LOW_CTR")) oncelik = "P1";
  else if (kod.has("HIGH_VIEWS_LOW_SUB_CONVERSION")) oncelik = "P2";
  else if (kod.has("LOW_IMPRESSIONS_GOOD_RETENTION") || kod.has("NO_SUGGESTED_TRAFFIC") || kod.has("SEARCH_DEPENDENT")) oncelik = "P3";
  return { oncelik, siniflar: l };
}

function rapor(v, kon, paket, tes, aks, bag, aciklama, aciklamaS) {
  const s = [];
  const liste = (a) => a.map((x) => "- " + x).join("\n");
  s.push(`# Optimization report — ${v.baslik}`, "", `Video: https://youtu.be/${v.videoId} · ${v.format} · ${v.sureSn}s · published ${v.yayin} (${v.yasGun} days ago) · ${v.gizlilik}`,
    `Production slug: ${kon ? "`" + kon.slug + "`" : "_not matched_"} · Analytics: ${v.analitikDurumu} · Generated ${new Date().toISOString()}`, "",
    "> Nothing here is applied automatically. No video is deleted or re-uploaded. Metrics marked *unavailable* were not invented.", "");
  s.push("## CURRENT TITLE", "", `"${v.baslik}"` + (paket.titles ? ` — title engine score **${paket.titles.mevcutPuan}/100**` : ""), "");
  s.push("## CURRENT THUMBNAIL", "", v.thumb ? `![current](${v.thumb})\n\n${v.thumb}` : "_unavailable_",
    v.format === "short" ? "\n_Shorts: the feed shows a frame from the video; the opening frame and on-screen hook act as the thumbnail._" : "", "");
  s.push("## CURRENT DESCRIPTION", "", "```", v.aciklama || "(empty)", "```", "");
  s.push("## CURRENT PERFORMANCE", "", tablo(v.metrikler), "");
  const tr = v.trafik ? v.trafik.map((x) => `${x.ad} ${Math.round(x.oran * 100)}%`).join(" · ") : "unavailable (" + v.analitikDurumu + ")";
  s.push(`Traffic sources: ${tr}`, "");
  s.push("Derived: " + Object.entries(v.turetilmis).map(([k, x]) => `${k} = ${x.durum === "ok" ? x.deger : "unavailable"}`).join(" · "), "");
  s.push("## PROBLEM DIAGNOSIS", "", ...tes.map((t) => `- **${t.kod}** (confidence: ${t.guven}) — ${t.aciklama}\n  → ${t.oneri}`), "");
  s.push("## TITLE OPTIONS", "");
  if (paket.titles) {
    s.push("| Score | Title | Source | Notes |", "|---:|---|---|---|");
    for (const a of paket.titles.adaylar.slice(0, 8)) s.push(`| ${a.toplam} | ${a.baslik} | ${a.kaynak} | ${a.notes.join("; ") || ""} |`);
    const ustun = tes.some((t) => t.kod === "OUTPERFORMER");
    s.push("", ustun ? `Recommended: **keep "${v.baslik}"** — measured performance beats the heuristic score; "${paket.titles.secilen}" is a pattern to reuse for new episodes.`
      : `Recommended: **${paket.titles.secilen}**` + (paket.titles.secilen === v.baslik ? " (already live — keep)" : ""), "");
  } else s.push("_no production spec — run title-engine on a spec first_", "");
  s.push("## THUMBNAIL CONCEPTS", "");
  if (paket.thumbs) for (const c of paket.thumbs.konseptler)
    s.push(`- **${c.id}** (${c.duzen}) — text: "${c.metin || "none"}" · focal: ${c.odak} · trigger: ${c.duyguTetigi} · contrast: ${c.kontrast} · mobile: ${c.mobil.gecti ? "pass" : "FAIL (" + c.mobil.sorunlar.join(", ") + ")"}`);
  s.push("", v.format === "short" ? "_For a published Short, pick the frame in the YouTube app (Edit → Thumbnail) that matches concept 1._" : "_Render with: node thumbnail-strategy.js " + (kon && kon.slug) + " --render_", "");
  s.push("## DESCRIPTION IMPROVEMENT", "", aciklamaS.length ? "Issues in the current description:\n" + liste(aciklamaS) : "Current description covers the essentials.", "",
    "Proposed description:", "", "```", aciklama || "(no spec)", "```", "");
  s.push("## HOOK IMPROVEMENT", "");
  if (paket.hook) {
    s.push(`Current hook score: **${paket.hook.mevcut.puan}/100**`, "", liste(paket.hook.mevcut.bulgular), "");
    if (paket.hook.oneri) s.push("Draft structure for a future re-cut / long-form version (0-5 / 5-12 / 12-20 / 20-30 s):", "", liste(paket.hook.oneri.segmentler.map((x) => `${x.pencere} ${x.rol}: ${x.metin}`)), "");
    s.push("_A published video's audio can't be edited in place — apply this to the next production in the cluster, not by re-uploading._", "");
  }
  s.push("## PLAYLIST RECOMMENDATION", "", bag ? `Cluster: **${bag.kume}** — playlist "${bag.playlist.ad}" (${bag.playlist.durum}). Keep the existing series playlist too.` : "_unmatched_", "");
  s.push("## RELATED VIDEO LINKS", "", bag ? liste([`Previous: ${bag.onceki ? bag.onceki.baslik + " " + (bag.onceki.url || "") : "—"}`,
    `Next: ${bag.sonraki ? bag.sonraki.baslik + " " + (bag.sonraki.url || "") : (bag.sonrakiKuyruk ? "queued: " + bag.sonrakiKuyruk : "—")}`]) : "_unmatched_", "");
  s.push("## END SCREEN RECOMMENDATION", "", bag && bag.endScreen ? `${bag.endScreen.baslik} ${bag.endScreen.url || ""}\n\n${bag.endScreen.not}` : "No other published video to point to yet.", "");
  s.push("## PINNED COMMENT RECOMMENDATION", "", "```", paket.pinned || "(no spec)", "```", "_Post with `node pinned-comment.js --post-pending`, then pin it in Studio (the API cannot pin)._", "");
  const sub = v.turetilmis.subsPer1000;
  s.push("## SUBSCRIBER CONVERSION OPPORTUNITY", "", sub.durum === "ok" ? `Subscribers per 1,000 views: **${sub.deger}**.` : "Subscribers per 1,000 views: unavailable (needs Analytics scope).",
    v.format === "short" ? "Shorts: no spoken CTA (it costs retention). Convert through the series: pinned comment → related episode, and a cluster playlist once it has 3+ videos." :
      "Long-form: one contextual CTA after the technical payoff (~40-60%), e.g. \"If you like engineering failures reconstructed from the evidence, subscribe to Failure Reconstructed.\"", "");
  s.push("## ACTION PRIORITY", "", `**${aks.oncelik}** — ` + { P1: "high impressions + low CTR", P2: "good views + low subscriber conversion", P3: "good retention + weak Suggested traffic", P4: "low-data video: fix objective gaps only, then wait for data" }[aks.oncelik], "",
    ...aks.siniflar.map((a) => `- \`${a.sinif}\` — ${a.neden}`), "",
    "Apply (manual, reversible — review first):", "", "```",
    kon ? `node youtube-guncelle.js ${v.videoId} ${kon.slug}     # updates title/description/tags from the production spec` : "# match this video to a spec first",
    "```", "");
  return s.join("\n");
}

async function analizEt(api, video, kayit, baglam = {}) {
  const v = await A.topla(api, video);
  v.aciklama = video.snippet.description || "";
  v.thumb = ((video.snippet.thumbnails || {}).maxres || (video.snippet.thumbnails || {}).high || {}).url || null;
  const rec = kayit.find((y) => y.videoId === video.id);
  const slug = (rec && rec.slug) || slugEslestir(video.snippet.title, kayit);
  const kon = slug ? K.uretimKonusu(slug) : null;
  const paket = {};
  let aciklama = null, bag = null;
  if (kon) {
    const TE = require("./title-engine");
    paket.titles = TE.degerlendir({ ...kon, baslik: video.snippet.title }, { format: v.format });
    paket.thumbs = require("./thumbnail-strategy").degerlendir(kon);
    paket.hook = require("./hook-engine").degerlendir(kon);
    const plan = require("./channel-plan").kur();
    bag = require("./channel-plan").baglanti(plan, slug);
    aciklama = require("./description-engine").olustur(kon, { plan, format: v.format }).metin;
    paket.pinned = require("./pinned-comment").uret(kon, { baglanti: bag });
  }
  const tes = A.teshis(v, paket, ayar().analytics, baglam);
  const aS = aciklamaSorunlari(v.aciklama);
  const aks = aksiyonlar(v, tes, kon, paket, bag, aS);
  const dir = path.join(KOK, "analysis", video.id);
  jsonYaz(path.join(dir, "data.json"), { ...v, slug, teshis: tes, aksiyon: aks });
  metinYaz(path.join(dir, "optimization-report.md"), rapor(v, kon, paket, tes, aks, bag, aciklama, aS));
  return { videoId: video.id, slug, baslik: video.snippet.title, format: v.format, yayin: v.yayin, views: v.metrikler.views.deger,
    teshis: tes.map((t) => t.kod), oncelik: aks.oncelik, siniflar: aks.siniflar, onerilenBaslik: paket.titles ? paket.titles.secilen : null };
}

// ---------------- migration plani ----------------
function yerelUretimler(yuklenen) {
  const d = path.join(KOK, "uretim");
  if (!fs.existsSync(d)) return [];
  return fs.readdirSync(d).filter((s) => fs.existsSync(path.join(d, s, "konu.json")) && !yuklenen.has(s)).map((s) => {
    const vid = fs.existsSync(path.join(d, s, "Videos")) ? fs.readdirSync(path.join(d, s, "Videos")).filter((f) => f.endsWith(".mp4")) : [];
    const spec = K.konuOku(s);
    const basarisiz = jsonOku(path.join(KOK, "icerik", "basarisiz.json"), []).includes(s);
    return { slug: s, videoId: null, durum: vid.length ? "rendered, not uploaded" : "not rendered", specVar: !!spec,
      siniflar: [{ sinif: spec ? (basarisiz ? "REVIEW_MANUALLY" : "KEEP") : "REVIEW_MANUALLY",
        neden: !spec ? "local test/legacy job with no production spec — not part of the channel queue" : basarisiz ? "production previously failed — rerun after checking sources" : "queued for normal production" }] };
  });
}

function migrationYaz(ozetler) {
  const yuklenen = new Set(ozetler.map((o) => o.slug).filter(Boolean));
  const yerel = yerelUretimler(yuklenen);
  const veri = { olusturuldu: new Date().toISOString(), not: "Classification only. Nothing is deleted, replaced or re-uploaded automatically.",
    yayinlanan: ozetler, yerel };
  jsonYaz(path.join(KOK, "migration", "current-videos.json"), veri);
  const s = ["# Existing videos — migration plan", "", `Generated ${bugun()} by \`node existing-video-optimizer.js --all\`. Per-video detail: \`analysis/<videoId>/optimization-report.md\`.`, "",
    "Rules: never delete, never re-upload, never replace automatically. Change one packaging element at a time and log it in `experiments/experiments.json` so the effect can be measured.", "",
    "Priority key: **P1** high impressions + low CTR · **P2** good views + low subscriber conversion · **P3** good retention + weak Suggested traffic · **P4** low-data videos.", ""];
  for (const p of ["P1", "P2", "P3", "P4"]) {
    const l = ozetler.filter((o) => o.oncelik === p);
    s.push(`## ${p}`, "");
    if (!l.length) { s.push("_none_", ""); continue; }
    for (const o of l.sort((a, b) => (b.views || 0) - (a.views || 0))) {
      s.push(`### ${o.baslik}`, `https://youtu.be/${o.videoId} · ${o.views ?? "?"} views · diagnosis: ${o.teshis.join(", ")}`, "");
      for (const c of o.siniflar) s.push(`- \`${c.sinif}\` — ${c.neden}`);
      if (o.onerilenBaslik && o.onerilenBaslik !== o.baslik && !o.teshis.includes("OUTPERFORMER")) s.push(`- Title to test later (as a logged experiment): "${o.onerilenBaslik}"`);
      s.push("");
    }
  }
  s.push("## Order of work", "", "1. **REDESCRIBE / ADD_INTERNAL_LINKS** first — objective gaps (sources, references, related links, disclosure), zero risk to CTR.",
    "2. **PLAYLIST_MOVE** when a cluster reaches 3 published videos (`node channel-plan.js` shows status).",
    "3. **RETITLE / RETHUMBNAIL** only after ~7 days of data, one video at a time, logged as an experiment.",
    "4. **REPACKAGE** is reserved for videos with measured weak packaging (P1), never on day-one guesses.", "",
    "## Local productions (not on YouTube)", "", "| Slug | State | Class | Why |", "|---|---|---|---|",
    ...yerel.map((y) => `| ${y.slug} | ${y.durum} | ${y.siniflar[0].sinif} | ${y.siniflar[0].neden} |`), "");
  metinYaz(path.join(KOK, "migration", "EXISTING-VIDEOS-PLAN.md"), s.join("\n"));
}

async function main() {
  const argv = process.argv.slice(2);
  const hedef = argv.find((a) => !a.startsWith("--"));
  const hepsi = argv.includes("--all"), sync = argv.includes("--sync"), offline = argv.includes("--offline");
  if (!hedef && !hepsi && !sync) { console.error("Kullanim: node existing-video-optimizer.js <videoId> | --all | --sync [--offline]"); process.exit(1); }
  if (hedef && !videoIdGecerli(hedef)) { console.error("Gecersiz video kimligi: " + hedef); process.exit(1); }
  const yt = require("./lib/yt");
  if (offline || !yt.kimlikVar()) {
    console.log("Kimlik yok/offline — API'siz yalnizca yerel migration envanteri yaziliyor.");
    migrationYaz(K.yayinlananlar().map((y) => ({ videoId: y.videoId, slug: y.slug, baslik: y.baslik, format: y.format, yayin: y.tarih, views: null,
      teshis: ["INSUFFICIENT_DATA"], oncelik: "P4", siniflar: [{ sinif: "REVIEW_MANUALLY", neden: "offline — no metrics collected" }] })));
    return;
  }
  const api = yt.istemci(await yt.token());
  const { ids } = await yt.yuklemeler(api);
  const videolar = await yt.videolar(api, hedef ? [hedef] : ids);
  const yeni = await senkron(api, videolar);
  if (yeni) console.log(`kayit: ${yeni} video slug ile eslestirildi (icerik/yayinlananlar.json)`);
  if (sync) return;
  const kayit = K.yayinlananlar();
  // Kanal baglami: ayni kanaldaki videolarin ortanca izlenmesi (goreceli performans)
  const tumu = hedef ? await yt.videolar(api, ids) : videolar;
  const baglam = A.baglam(tumu);
  const ozet = [];
  for (const v of videolar) {
    const o = await analizEt(api, v, kayit, baglam);
    ozet.push(o);
    console.log(`  ${o.oncelik} ${v.id} ${String(o.views).padStart(5)} izlenme  ${o.teshis.join(",")}  -> analysis/${v.id}/optimization-report.md`);
  }
  if (hepsi) { migrationYaz(ozet); require("./channel-plan").calistir(); console.log("✓ migration/current-videos.json + migration/EXISTING-VIDEOS-PLAN.md"); }
}

module.exports = { aciklamaSorunlari, aksiyonlar, slugEslestir, migrationYaz };

if (require.main === module) main().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
