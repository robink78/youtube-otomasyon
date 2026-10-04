// ARSIV BUL — bir isin konu.json'undaki kaynak kliplerini indirir.
//
// Yalnizca telifsiz/kamu mali kaynaklar hedeflenir:
//   - Wikimedia Commons (cogu kamu mali / CC)
//   - Dogrudan URL (kamu mali arsiv)
//   - archive.org ogesi
// Indirilen dosyalar uretim/<is>/Footage/ altina yazilir; shorts-yap.js bunlari
// sahne.kaynak ile eslestirir.
//
// konu.json:
//   "kaynaklar": [
//     { "ad": "tacoma.ogv", "wikimedia": "Tacoma Narrows Bridge destruction.ogv" },
//     { "ad": "b.webm", "wikimedia": "Buyuk belgesel.webm", "kalite": "480p" },   // hazir 480p kopya
//     { "ad": "f1.jpg",  "wikimedia": "Texas City Disaster.jpg" }                  // ARSIV FOTOGRAFI
//   ]
// Fotograf: kamu mali felaket FILMI sinirli, FOTOGRAF bol. shorts-yap.js fotografa
// yavas zoom/kaydirma uygular. Lisans denetimi filmle AYNI (yalnizca PD/CC0/CC BY).
//     { "ad": "b.mp4", "url": "https://.../public-domain.mp4" },
//     { "ad": "c.mp4", "archive": "identifier/filename.mp4" }
//   ]
//
// Kullanim: node arsiv-bul.js <is-adi>

const fs = require("fs");
const path = require("path");
const https = require("https");
const cp = require("child_process");

const KOK = __dirname;
const IS = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
if (!IS) { console.error("Kullanim: node arsiv-bul.js <is-adi>"); process.exit(1); }
const BASE = path.join(KOK, "uretim", IS);
const konu = JSON.parse(fs.readFileSync(path.join(BASE, "konu.json"), "utf8"));
const FOOT = path.join(BASE, "Footage");
fs.mkdirSync(FOOT, { recursive: true });

// Wikimedia CDN'i Accept/Accept-Encoding olmayan istekleri bot sanip 429/403
// dondurur. Uyumlu User-Agent (iletisim URL'li) + bu basliklar sart.
const BASLIK = {
  "User-Agent": "FailureReconstructedBot/1.0 (+https://github.com/eyazan/youtube-otomasyon)",
  "Accept": "*/*",
  "Accept-Encoding": "identity",
};

function getJSON(url) {
  return new Promise((coz, red) => {
    https.get(url, { headers: BASLIK }, (res) => {
      const p = []; res.on("data", d => p.push(d));
      res.on("end", () => { try { coz(JSON.parse(Buffer.concat(p).toString("utf8"))); } catch (e) { red(e); } });
    }).on("error", red);
  });
}

function indir(url, hedef, yonlendirmeKalan = 5) {
  return new Promise((coz, red) => {
    https.get(url, { headers: BASLIK }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (yonlendirmeKalan <= 0) return red(new Error("cok fazla yonlendirme"));
        res.resume();
        return indir(res.headers.location, hedef, yonlendirmeKalan - 1).then(coz, red);
      }
      if (res.statusCode !== 200) { res.resume(); return red(new Error("HTTP " + res.statusCode)); }
      const ws = fs.createWriteStream(hedef);
      res.pipe(ws);
      ws.on("finish", () => ws.close(() => coz()));
      ws.on("error", red);
    }).on("error", red);
  });
}

// archive.org: identifier verilirse metadata API ile en buyuk video dosyasini
// bulur; "identifier/dosya.mp4" verilirse dogrudan kullanir.
async function archiveUrl(idVeyaYol) {
  if (idVeyaYol.includes("/")) return "https://archive.org/download/" + idVeyaYol;
  const meta = await getJSON("https://archive.org/metadata/" + encodeURIComponent(idVeyaYol));
  const vids = (meta.files || []).filter(f => /\.(mp4|webm|ogv|ogg|m4v|mpe?g|mov)$/i.test(f.name || ""));
  if (!vids.length) throw new Error("archive.org video dosyasi yok: " + idVeyaYol);
  // Web-dostu format oncelikli (mp4/webm/ogv), sonra buyukluge gore.
  const oncelik = (n) => { const e = (n.split(".").pop() || "").toLowerCase();
    return { mp4: 0, webm: 1, ogv: 2, ogg: 2, m4v: 3 }[e] ?? 5; };
  vids.sort((a, b) => oncelik(a.name) - oncelik(b.name) || Number(b.size || 0) - Number(a.size || 0));
  return "https://archive.org/download/" + idVeyaYol + "/" + encodeURIComponent(vids[0].name);
}

// STEREOGRAF: Library of Congress gibi arsivlerde 1900'lerin fotograflarinin cogu
// "stereo kart" — yan yana IKI ayni kare, gri karton ve beyaz tarama kenariyla.
// Dikey Shorts'ta iki kucuk resim gibi durur. Iki yariyi SSIM ile karsilastirip
// kart oldugunu anlar ve SOL fotografi kesip kaydeder.
const FOTO_UZ = /\.(jpe?g|png|webp)$/i;
function stereoMu(dosya) {
  try {
    const FF = require("./ff-yol.js");
    const r = cp.spawnSync(FF.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", dosya, "-filter_complex",
      "[0:v]crop=iw/2:ih:0:0,scale=320:240,format=gray[l];[0:v]crop=iw/2:ih:iw/2:0,scale=320:240,format=gray[r];[l][r]ssim=stats_file=-",
      "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 22 });
    const m = String(r.stdout || "").match(/All:([\d.]+)/);
    return m ? +m[1] >= 0.35 : false;     // olculen: kart 0.45-0.55, tek fotograf 0.17
  } catch (e) { return false; }
}
function stereoKirp(dosya) {
  try {
    const FF = require("./ff-yol.js");
    const gecici = dosya.replace(FOTO_UZ, ".kirp$&");
    // Olculen oranlar: kartin sol fotografi, yuvarlak kenarlarin icinden
    const r = cp.spawnSync(FF.ffmpeg, ["-hide_banner", "-loglevel", "error", "-i", dosya,
      "-vf", "crop=iw*0.375:ih*0.50:iw*0.105:ih*0.235", "-q:v", "2", "-y", gecici], { encoding: "utf8" });
    if (r.status === 0 && fs.existsSync(gecici) && fs.statSync(gecici).size > 10000) {
      fs.renameSync(gecici, dosya); return true;
    }
    try { fs.unlinkSync(gecici); } catch (e) {}
  } catch (e) {}
  return false;
}

const lisansUygun = (l) => /^(public domain|pd\b|pd-|cc0|cc by(?!-?(sa|nc|nd))\b)/i.test(String(l).trim()) && !/\b(sa|nc|nd)\b/i.test(String(l));
// kalite ("480p" gibi) verilirse Commons'un hazir donusturulmus kopyasi indirilir:
// yuzlerce MB'lik 1080p belgeseller her gunluk calismada tam boyutuyla inmesin
// (dikey Shorts'ta arka plan zaten bulaniklastirilir; 480p yeterli). Kopya yoksa orijinal.
async function wikimediaUrl(baslik, kalite) {
  const api = "https://commons.wikimedia.org/w/api.php?action=query&titles=" +
    encodeURIComponent("File:" + baslik) + "&prop=imageinfo|videoinfo&iiprop=url|mime|extmetadata&viprop=derivatives&format=json";
  const d = await getJSON(api);
  const page = Object.values(d.query.pages)[0];
  const ii = (page.imageinfo || [])[0];
  if (!ii || !ii.url) throw new Error("Wikimedia dosyasi bulunamadi: " + baslik);
  const lisans = (ii.extmetadata && ii.extmetadata.LicenseShortName && ii.extmetadata.LicenseShortName.value) || "?";
  if (kalite) {
    const der = ((page.videoinfo || [])[0] || {}).derivatives || [];
    const uygun = der.filter((x) => String(x.transcodekey || "").startsWith(kalite));
    const k = uygun.find((x) => /webm$/.test(x.transcodekey)) || uygun[0];   // webm yoksa mov (ffmpeg ikisini de okur)
    if (k && k.src) return { url: k.src, lisans, kopya: k.transcodekey };
  }
  return { url: ii.url, lisans };
}

(async () => {
  const kaynaklar = konu.kaynaklar || [];
  if (!kaynaklar.length) { console.error("konu.json'da kaynaklar[] yok."); process.exit(1); }
  console.log(`Arsiv indiriliyor: ${IS}  (${kaynaklar.length} kaynak)`);
  const kayit = [];
  for (const k of kaynaklar) {
    const hedef = path.join(FOOT, k.ad);
    if (fs.existsSync(hedef) && fs.statSync(hedef).size > 0) { console.log("  var, atlandi: " + k.ad); continue; }
    let url = k.url, lisans = k.lisans || "belirtilmemis";
    if (k.wikimedia) {
      const w = await wikimediaUrl(k.wikimedia, k.kalite); url = w.url; lisans = w.lisans;
      if (w.kopya) console.log("  (Commons kopyasi: " + w.kopya + ")");
      // Lisans korumasi: yalnizca kamu mali / CC0 / CC BY. Paylasim-benzer (SA), ticari
      // olmayan (NC), turetilemez (ND) ya da bilinmeyen lisansli film KULLANILMAZ.
      if (!lisansUygun(lisans)) throw new Error(`lisans uygun degil (${lisans}): ${k.wikimedia} — yalnizca Public domain / CC0 / CC BY`);
    }
    else if (k.archive) { url = await archiveUrl(k.archive); if (lisans === "belirtilmemis") lisans = "archive.org (kaynagi dogrula)"; }
    if (!url) throw new Error("kaynak icin url/wikimedia/archive yok: " + k.ad);
    process.stdout.write("  indiriliyor: " + k.ad + " ... ");
    // 429/503/aglar icin backoff'lu tekrar
    for (let deneme = 1; ; deneme++) {
      try { await indir(url, hedef); break; }
      catch (e) {
        try { fs.unlinkSync(hedef); } catch (_) {}
        if (deneme >= 4) throw e;
        const bekle = deneme * 4000;
        process.stdout.write(`(${e.message}, ${bekle / 1000}s bekle) `);
        await new Promise(r => setTimeout(r, bekle));
      }
    }
    // Stereo kart ise tek fotografa indir (konu spec'inde "stereo": false ile kapatilabilir)
    let not = "";
    if (FOTO_UZ.test(k.ad) && k.stereo !== false && stereoMu(hedef) && stereoKirp(hedef)) not = "  [stereo kart -> tek fotograf]";
    const mb = (fs.statSync(hedef).size / 1e6).toFixed(1);
    console.log(mb + " MB  [lisans: " + lisans + "]" + not);
    kayit.push({ ad: k.ad, kaynak: k.wikimedia || k.archive || url, lisans });
  }
  // Sahne basina kaynak metadatasi + kanal kaynak defteri (ozgunluk/atif icin)
  const meta = {};
  for (const k of kaynaklar) {
    const r = kayit.find((x) => x.ad === k.ad) || { lisans: k.lisans || "see source" };
    meta["Footage/" + k.ad] = k.wikimedia
      ? { kurum: "Wikimedia Commons", url: "https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(k.wikimedia.replace(/ /g, "_")), lisans: r.lisans, id: "wikimedia:" + k.wikimedia }
      : k.archive ? { kurum: "Internet Archive", url: "https://archive.org/details/" + k.archive.split("/")[0], lisans: r.lisans, id: "archive:" + k.archive }
      : { kurum: "direct URL", url: k.url, lisans: r.lisans, id: "url:" + k.url };
  }
  for (const s of konu.sahneler || []) if (meta[s.kaynak]) s.kaynakMeta = { ...meta[s.kaynak], arama: null, alaka: 1, secim: "curated timestamp" };
  fs.writeFileSync(path.join(BASE, "konu.json"), JSON.stringify(konu, null, 2));
  try {
    require("./lib/kutuphane").defterYaz(IS, { kaynakKimlikleri: Object.values(meta).map((m) => m.id),
      krediler: Object.values(meta).map((m) => `Archival film: ${m.kurum} (${m.lisans}) — ${m.url}`), tarih: new Date().toISOString() });
  } catch (e) { console.log("  (kaynak defteri yazilamadi: " + e.message + ")"); }

  // Telif/atif kaydi — yayinlamadan once incelenebilir
  fs.writeFileSync(path.join(BASE, "GORSEL-KAYNAKLARI.txt"),
    kayit.map(r => `${r.ad}  <=  ${r.kaynak}  [${r.lisans}]`).join("\n") + "\n");
  console.log("✓ Bitti. Kaynak/lisans kaydi: GORSEL-KAYNAKLARI.txt");
})().catch(e => { console.error("Hata: " + e.message); process.exit(1); });
