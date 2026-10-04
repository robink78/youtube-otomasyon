// YOUTUBE GUNCELLE — yuklenmis bir videonun basligini/aciklamasini/etiketlerini
// gunceller (videos.update). Zaten yuklenmis videolarda eksik metni tamamlamak
// icin. Video dosyasini DEGISTIRMEZ, sadece metni.
//
// Metin kaynagi: uretim/<is>/YUKLEME.json varsa o; yoksa description-engine.js
// (ozet + kaynaklar + teknik referanslar + ilgili bolum + aciklama notu) ve
// ilgili etiketler. BASLIK VARSAYILAN OLARAK DEGISMEZ (canli baslik korunur);
// baslik degisikligi bilincli bir deney olmali: --baslik "<yeni>" ya da
// --baslik-spec (konu spec'indeki baslik).
//
// Geri alinabilir: eski snippet analysis/<video-id>/snippet-before-<zaman>.json'a yazilir.
//
// Kullanim:
//   node youtube-guncelle.js <video-id> <is-adi> [--dogrula] [--baslik "<yeni>" | --baslik-spec]
//   ornek: node youtube-guncelle.js qkzRUqlEy5I tacoma-narrows --dogrula

const fs = require("fs");
const path = require("path");
const https = require("https");
const Channel = require("./core/channel-context");
const SELECTED = Channel.selectFromArgv(process.argv.slice(2));
const CHANNEL = SELECTED.channel;

const KOK = __dirname;

function istek(opt, govde) {
  return new Promise((coz, red) => {
    const r = https.request(opt, (res) => {
      const p = []; res.on("data", d => p.push(d));
      res.on("end", () => coz({ durum: res.statusCode, govde: Buffer.concat(p).toString("utf8") }));
    });
    r.on("error", red); if (govde) r.write(govde); r.end();
  });
}

const temizle = (s) => String(s).replace(/[<>]/g, "");

function metniAl(BASE, is) {
  const oz = path.join(BASE, "YUKLEME.json");
  if (fs.existsSync(oz)) { const j = JSON.parse(fs.readFileSync(oz, "utf8"));
    return { baslik: j.baslik, aciklama: j.aciklama, etiketler: j.etiketler || [] }; }
  const konu = require("./lib/kutuphane").uretimKonusu(is);
  if (!konu) throw new Error("Konu bulunamadi: " + is);
  const d = require("./description-engine").olustur(konu);
  return { baslik: konu.baslik || konu.baslik_en, aciklama: d.metin, etiketler: d.etiketler };
}

async function main() {
  const argv = SELECTED.argv;
  const [id, is] = argv.filter((a, i) => !a.startsWith("--") && argv[i - 1] !== "--baslik");
  const kuru = argv.includes("--dogrula");
  const bi = argv.indexOf("--baslik");
  if (!id || !is) { console.error("Kullanim: node youtube-guncelle.js <video-id> <is-adi> [--dogrula] [--baslik \"<yeni>\" | --baslik-spec]"); process.exit(1); }
  if (!/^[A-Za-z0-9_-]{11}$/.test(id)) { console.error("Gecersiz video kimligi: " + id); process.exit(1); }
  const BASE = path.join(CHANNEL.paths.production, is);
  const m = metniAl(BASE, is);
  const auth = await require("./lib/yt").getYouTubeClient(CHANNEL);
  const token = auth.accessToken;

  // Mevcut snippet'i al (categoryId gerekli).
  const mevcut = await istek({ hostname: "www.googleapis.com",
    path: "/youtube/v3/videos?part=snippet&id=" + encodeURIComponent(id),
    headers: { "Authorization": "Bearer " + token } });
  const items = JSON.parse(mevcut.govde).items || [];
  if (!items.length) throw new Error("Video bulunamadi (senin kanalinda mi?): " + id);
  const snip = items[0].snippet;
  const baslik = bi >= 0 ? argv[bi + 1] : argv.includes("--baslik-spec") ? m.baslik : snip.title;

  const yeni = {
    id,
    snippet: {
      title: temizle(baslik || snip.title).slice(0, 100),
      description: temizle(m.aciklama || snip.description || ""),
      tags: (m.etiketler && m.etiketler.length ? m.etiketler : snip.tags || []).map(String).slice(0, 30),
      categoryId: snip.categoryId || "27",
    },
  };
  console.log("Baslik : " + (yeni.snippet.title === snip.title ? "(degismiyor) " : snip.title + "  ->  ") + yeni.snippet.title);
  console.log("Aciklama:\n" + yeni.snippet.description.split("\n").map((l) => "  | " + l).join("\n"));
  if (kuru) { console.log("\n[--dogrula] Hicbir sey gonderilmedi."); return; }
  const yedek = path.join(CHANNEL.paths.analysis, id, "snippet-before-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json");
  fs.mkdirSync(path.dirname(yedek), { recursive: true });
  fs.writeFileSync(yedek, JSON.stringify(snip, null, 2));
  console.log("Yedek  : " + path.relative(KOK, yedek));
  const body = JSON.stringify(yeni);
  const y = await istek({ hostname: "www.googleapis.com",
    path: "/youtube/v3/videos?part=snippet", method: "PUT",
    headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } }, body);
  if (y.durum === 200) {
    console.log("✓ Guncellendi: " + id);
    console.log("  Baslik : " + yeni.snippet.title);
    console.log("  Etiket : " + (yeni.snippet.tags.join(", ") || "(yok)"));
    console.log("  https://youtu.be/" + id);
  } else {
    console.error("Guncelleme basarisiz (HTTP " + y.durum + "): " + y.govde.slice(0, 500));
    process.exit(1);
  }
}
main().catch(e => { console.error("Hata: " + e.message); process.exit(1); });
