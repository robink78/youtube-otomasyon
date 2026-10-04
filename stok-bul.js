// STOK BUL — Pexels'ten sahne basina dikey stok video klibi indirir.
//
// "tur": "stok" konularinda kullanilir. Her sahnenin "arama" terimine gore
// Pexels'te dikey (portrait) HD klip bulur, indirir, sahne.kaynak'i ayarlar.
// Boylece belirli arsiv goruntusu olmayan konular (bilim/muhendislik acikla-
// yicilari) icin SINIRSIZ konu uretilebilir.
//
// Pexels lisansi: ucretsiz, ticari kullanima uygun, atif zorunlu degil
// (yine de GORSEL-KAYNAKLARI.txt'ye kaydedilir).
//
// Anahtar: PEXELS_KEY (.env ya da ortam). Ucretsiz: pexels.com/api
//
// Kaynak metadatasi: her sahneye kaynakMeta { kurum, url, lisans, arama, alaka, id }
// yazilir. alaka = arama teriminin kelimelerinin Pexels sayfa adresinde (aciklayici
// slug) gecme orani — yedek aramaya dusen sahneler dusuk alakali isaretlenir.
// Kanal genelinde tekrar yok: baska videolarda kullanilmis Pexels klipleri
// (icerik/kaynak-defteri.json) bu videoda secilmez.
//
// Kullanim: node stok-bul.js <is-adi>

const fs = require("fs");
const path = require("path");
const https = require("https");

const KOK = __dirname;
const IS = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
if (!IS) { console.error("Kullanim: node stok-bul.js <is-adi>"); process.exit(1); }
const BASE = path.join(KOK, "uretim", IS);
const konuYol = path.join(BASE, "konu.json");
if (!fs.existsSync(konuYol)) { console.error("Is yok: " + BASE); process.exit(1); }
const konu = JSON.parse(fs.readFileSync(konuYol, "utf8"));
const FOOT = path.join(BASE, "Footage");
fs.mkdirSync(FOOT, { recursive: true });

function env(ad) {
  if (process.env[ad]) return String(process.env[ad]).trim();
  try {
    for (const l of fs.readFileSync(path.join(KOK, ".env"), "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === ad) return m[2].trim();
    }
  } catch (e) {}
  return "";
}
const KEY = env("PEXELS_KEY");
if (!KEY) { console.error("PEXELS_KEY eksik (.env). Ucretsiz: pexels.com/api"); process.exit(2); }

function getJSON(url) {
  return new Promise((coz, red) => {
    https.get(url, { headers: { Authorization: KEY, "User-Agent": "FailureReconstructedBot/1.0" } }, (res) => {
      const p = []; res.on("data", d => p.push(d));
      res.on("end", () => { try { coz(JSON.parse(Buffer.concat(p).toString("utf8"))); } catch (e) { red(e); } });
    }).on("error", red);
  });
}
function indir(url, hedef, kalan = 5) {
  return new Promise((coz, red) => {
    https.get(url, { headers: { "User-Agent": "FailureReconstructedBot/1.0" } }, (res) => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        if (kalan <= 0) return red(new Error("cok yonlendirme"));
        res.resume(); return indir(res.headers.location, hedef, kalan - 1).then(coz, red);
      }
      if (res.statusCode !== 200) { res.resume(); return red(new Error("HTTP " + res.statusCode)); }
      const ws = fs.createWriteStream(hedef);
      res.pipe(ws); ws.on("finish", () => ws.close(() => coz())); ws.on("error", red);
    }).on("error", red);
  });
}

// Karanlik klip korumasi: gece gokyuzu / karanlik sehir klipleri Shorts'ta simsiyah ekran
// gibi gorunur ve final kalite kapisi (siyah kare) videoyu engeller (olculdu: elektrik
// kesintisi, gaz patlamasi, patlama fizigi). Klibin kullanilacak ilk 6 saniyesinden
// 2 kare/sn ornek alinir; ortalama parlaklik (YAVG, 0-255) 45'in altinda olan kare orani
// %30'u gecerse klip reddedilir ve siradaki aday denenir.
const cp = require("child_process");
function karanlikOran(dosya) {
  try {
    const FF = require("./ff-yol.js");
    const r = cp.spawnSync(FF.ffmpeg, ["-hide_banner", "-t", "6", "-i", dosya, "-vf", "fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
      "-an", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 24 });
    const y = [...String(r.stderr).matchAll(/YAVG=([\d.]+)/g)].map((m) => +m[1]);
    return y.length ? y.filter((v) => v < 45).length / y.length : 0;
  } catch (e) { return 0; }
}

// Bir arama terimi icin en iyi dikey klibi sec (kullanilan id'leri atla).
async function klipSec(terim, kullanilan) {
  const url = "https://api.pexels.com/videos/search?query=" + encodeURIComponent(terim) +
    "&orientation=portrait&size=medium&per_page=15";
  const d = await getJSON(url);
  const vids = (d.videos || []).filter(v => !kullanilan.has(v.id));
  for (const v of vids) {
    // Dikey, yeterince uzun, iyi cozunurluklu bir dosya sec
    const dosyalar = (v.video_files || [])
      .filter(f => f.height >= f.width && f.height >= 960 && /mp4/i.test(f.file_type || "mp4"))
      .sort((a, b) => (a.height - 1920) ** 2 - (b.height - 1920) ** 2 > 0 ? 1 : -1);
    if (dosyalar.length) return { id: v.id, url: dosyalar[0].link, sure: v.duration, kaynak: v.url, yazar: (v.user || {}).name || "" };
  }
  return null;
}

(async () => {
  const sahneler = konu.sahneler || [];
  if (!sahneler.length) { console.error("konu.json'da sahneler yok."); process.exit(1); }
  console.log(`Stok video (Pexels): ${IS}  (${sahneler.length} sahne)`);
  // Kanalin diger videolarinda kullanilmis Pexels kimlikleri (gorsel tekrar onleme)
  const K = require("./lib/kutuphane");
  const kullanilan = new Set();
  for (const [slug, d] of Object.entries(K.defter())) {
    if (slug === IS) continue;
    for (const id of d.kaynakKimlikleri || []) if (/^pexels:/.test(id)) kullanilan.add(Number(id.slice(7)));
  }
  const alakaOlc = (terim, sayfa) => {
    const w = String(terim).toLowerCase().split(/\W+/).filter((x) => x.length > 2);
    const slug = String(sayfa || "").toLowerCase();
    return w.length ? Math.round(w.filter((x) => slug.includes(x.slice(0, 5))).length / w.length * 100) / 100 : 0;
  };
  const kayit = [], kimlikler = [], krediler = [];
  for (let i = 0; i < sahneler.length; i++) {
    const s = sahneler[i];
    const terim = s.arama || s.metin.split(/\s+/).slice(0, 3).join(" ");
    const ad = "s-" + String(i).padStart(2, "0") + ".mp4";
    const hedef = path.join(FOOT, ad);
    process.stdout.write(`  sahne ${i + 1}/${sahneler.length}: "${terim}" ... `);
    let sec = null, yedek = false, reddedilen = 0;
    // En fazla 5 aday: karanlik klip reddedilir, siradaki denenir
    for (let aday = 0; aday < 5; aday++) {
      let s2 = await klipSec(terim, kullanilan), y2 = false;
      if (!s2) { s2 = await klipSec(konu.arama_yedek || konu.baslik || "engineering", kullanilan); y2 = true; }   // yedek: genel tema
      if (!s2) break;
      kullanilan.add(s2.id);
      for (let d = 1; ; d++) {
        try { await indir(s2.url, hedef); break; }
        catch (e) { if (d >= 3) throw e; await new Promise(r => setTimeout(r, d * 2000)); }
      }
      const oran = karanlikOran(hedef);
      if (oran <= 0.3) { sec = s2; yedek = y2; break; }
      reddedilen++;
      process.stdout.write(`(karanlik klip reddedildi: %${Math.round(oran * 100)}) `);
    }
    if (!sec) throw new Error("Pexels'te uygun (karanlik olmayan) klip bulunamadi: " + terim);
    s.kaynak = "Footage/" + ad;
    s.baslangic = 0;
    s.kaynakMeta = { kurum: "Pexels", url: sec.kaynak, lisans: "Pexels License", arama: yedek ? (konu.arama_yedek || konu.baslik) : terim,
      alaka: yedek ? Math.min(0.3, alakaOlc(terim, sec.kaynak)) : alakaOlc(terim, sec.kaynak), yedek, id: "pexels:" + sec.id, yazar: sec.yazar };
    kimlikler.push("pexels:" + sec.id);
    krediler.push(`Stock footage: Pexels${sec.yazar ? " / " + sec.yazar : ""} (Pexels License) — ${sec.kaynak}`);
    console.log((fs.statSync(hedef).size / 1e6).toFixed(1) + " MB");
    kayit.push(ad + "  <=  Pexels " + sec.kaynak);
  }
  fs.writeFileSync(konuYol, JSON.stringify(konu, null, 2));
  K.defterYaz(IS, { kaynakKimlikleri: kimlikler, krediler, tarih: new Date().toISOString() });
  fs.writeFileSync(path.join(BASE, "GORSEL-KAYNAKLARI.txt"),
    kayit.join("\n") + "\n\nPexels License (free, commercial use OK).\n");
  console.log("✓ Bitti. Klipler indi + konu.json guncellendi.");
})().catch(e => { console.error("Hata: " + e.message); process.exit(1); });
