// ADAY GORSEL — bir olay icin KULLANILABILIR arsiv gorseli var mi, otomatik arastirir.
//
// Kutuphaneyi buyuturken darbogaz arastirmaydi: her vaka icin Commons'ta gorsel
// aramak, lisansini tek tek acip bakmak, cozunurlugu kontrol etmek. Bu betik o
// mekanik kismi yapar; editoryal karar (bu vaka kanala uygun mu, hangi kare
// secilecek) insanda kalir.
//
// ELEME KURALLARI (kanalin ilkeleri):
//   - Lisans yalnizca kamu mali / CC0 / CC BY. SA, NC, ND ve bilinmeyen REDDEDILIR
//     (arsiv-bul.js ile ayni kural; Commons'ta CC BY-SA cok yaygin).
//   - En az 800 px genislik (dikey Shorts'ta 1080'e olceklenecek).
//   - Ceset/otopsi/mezar gorselleri elenir — kanal felaketi anlatir, aci teshir etmez.
//   - Anma plaketi, harita, kolaj, arma gibi "olay ani olmayan" gorseller elenir.
//
// Kullanim:
//   node aday-gorsel.js "Texas City disaster"            # tek olay
//   node aday-gorsel.js --liste olaylar.txt              # satir satir olay listesi
//   node aday-gorsel.js "Hartford circus fire" --json    # kaynaklar[] blogu uret
"use strict";
const https = require("https");

const BASLIK = { "User-Agent": "FailureReconstructedBot/1.0 (+https://github.com/eyazan/youtube-otomasyon)", "Accept": "application/json" };
const API = "https://commons.wikimedia.org/w/api.php";

// arsiv-bul.js ile AYNI kural — iki yerde ayrisirsa lisans korumasi delinir.
const lisansUygun = (l) => /^(public domain|pd\b|pd-|cc0|cc by(?!-?(sa|nc|nd))\b)/i.test(String(l).trim()) && !/\b(sa|nc|nd)\b/i.test(String(l));

// Olay anini gostermeyen ya da gosterilmemesi gereken gorseller
const ELE = [
  [/post.?mortem|autopsy|corpse|dead bod(y|ies)|\bbodies\b|\bthe dead\b|for bodies|grave of|funeral|coffin|burial|death certificate|morgue|identifying (the )?(dead|victims)/i, "aci teshiri"],
  [/removing (the )?(victim|casualt|bod)|carrying (the )?(victim|injured|wounded)|stretcher|injured (man|woman|child|person)|wounded (man|woman|child)|mourner/i, "yarali/kurban"],
  [/historical marker|memorial|plaque|monument|cemetery|statue/i, "anma/plaket"],
  [/\bmap\b|\bchart\b|diagram|collage|coat of arms|logo|stamp|banknote|flag of/i, "olay ani degil"],
  [/\bportrait\b|headshot/i, "portre"],
  // Tablo/cizim/karikatur: olayin FOTOGRAFI degil. Tarihi bir eser olabilir ama
  // gercek goruntu gibi gosterilemez (kanalin beyani: "real archival film").
  // Titanic gibi fotografi olmayan olaylarda liste bunlarla dolar — ayrica isaretlenir.
  [/painting|painted by|drawing|illustration|engraving|lithograph|woodcut|cartoon|sketch|artist'?s? impression|depicting|representation|puck magazine|punch magazine|harper'?s weekly|poster|\\bart by\\b/i, "tablo/cizim"],
  // Belge taramasi (kurban listesi, gazete kupuru, mektup) — okunmaz ve olay ani degil
  [/fatality list|casualty list|list of (the )?(dead|victims|missing)|newspaper (clipping|page)|telegram|letter from|affidavit|testimony|report cover|title page/i, "belge"],
];

function getJSON(url) {
  return new Promise((coz) => {
    const r = https.get(url, { headers: BASLIK }, (res) => {
      const p = [];
      res.on("data", (d) => p.push(d));
      res.on("end", () => { try { coz(JSON.parse(Buffer.concat(p).toString("utf8"))); } catch (e) { coz(null); } });
    });
    r.on("error", () => coz(null));
    r.setTimeout(30000, () => r.destroy());
  });
}
const uyku = (ms) => new Promise((r) => setTimeout(r, ms));

async function ara(olay, limit = 30) {
  const d = await getJSON(`${API}?action=query&list=search&srnamespace=6&srlimit=${limit}&format=json&srsearch=` +
    encodeURIComponent(`${olay} filetype:bitmap`));
  return ((d && d.query && d.query.search) || []).map((x) => x.title);
}

// Commons API tek istekte 50 baslik kabul eder
async function bilgi(basliklar) {
  const out = [];
  for (let i = 0; i < basliklar.length; i += 20) {
    const d = await getJSON(`${API}?action=query&prop=imageinfo&iiprop=size|url|extmetadata&format=json&titles=` +
      basliklar.slice(i, i + 20).map(encodeURIComponent).join("|"));
    for (const p of Object.values((d && d.query && d.query.pages) || {})) {
      const ii = (p.imageinfo || [])[0];
      if (!ii) continue;
      const m = ii.extmetadata || {};
      const duz = (x) => String((m[x] || {}).value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      out.push({ baslik: p.title.replace(/^File:/, ""), en: ii.width, boy: ii.height, boyut: ii.size,
        lisans: (m.LicenseShortName || {}).value || "?", aciklama: duz("ImageDescription").slice(0, 120), kurum: duz("Artist").slice(0, 60) });
    }
    await uyku(600);
  }
  return out;
}

function ele(g) {
  if (!lisansUygun(g.lisans)) return "lisans: " + g.lisans;
  if (!g.en || g.en < 800) return `cozunurluk ${g.en}x${g.boy}`;
  const metin = g.baslik + " " + g.aciklama;
  // Commons dosya adlari sik sik bitisik yazilir ("PuckMagazine1912.jpg"); ayiraclari
  // bosluga cevirip bir de oyle bakilir, yoksa desen kacar.
  const bosluklu = metin.replace(/[-_]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  for (const [re, neden] of ELE) if (re.test(metin) || re.test(bosluklu)) return neden;
  return null;
}

// Ayni gorselin farkli surumleri (ayni baslik govdesi ya da ayni boyut+oran) tek sayilir;
// aksi halde "6 gorsel var" derken aslinda 2 gorselin kopyalari olabilir.
function tekilles(l) {
  const gorulen = new Set(), out = [];
  for (const g of l) {
    const ad = g.baslik.replace(/\.(jpe?g|png|webp|tiff?)$/i, "").replace(/[-_ ]+(\d+|v\d|copy|crop|edit|restored|small|large)$/i, "")
      .replace(/\s*-\s*DPLA\s*-\s*[0-9a-f]+$/i, "").replace(/\s*LCCN\s*\d+$/i, "").toLowerCase().trim();
    const imza = ad + "|" + g.en + "x" + g.boy;
    if (gorulen.has(ad) || gorulen.has(imza)) continue;
    gorulen.add(ad); gorulen.add(imza); out.push(g);
  }
  return out;
}

async function tara(olay) {
  const basliklar = await ara(olay);
  if (!basliklar.length) return { olay, uygun: [], elenen: [], toplam: 0 };
  const hepsi = await bilgi(basliklar);
  const uygun = [], elenen = [];
  for (const g of hepsi) { const n = ele(g); if (n) elenen.push({ ...g, neden: n }); else uygun.push(g); }
  uygun.sort((a, b) => b.en * b.boy - a.en * a.boy);
  const tek = tekilles(uygun);
  return { olay, uygun: tek, kopya: uygun.length - tek.length, elenen, toplam: hepsi.length };
}

function yazdir(r, json) {
  if (json) {
    console.log(JSON.stringify({ kaynaklar: r.uygun.slice(0, 8).map((g, i) => ({ ad: `f${i + 1}.jpg`, wikimedia: g.baslik })) }, null, 2));
    return;
  }
  const d = r.uygun.length >= 6 ? "✓ YETERLI" : r.uygun.length >= 3 ? "~ AZ" : "✗ YETERSIZ";
  console.log(`\n${d}  ${r.olay}  —  ${r.uygun.length}/${r.toplam} kullanilabilir`);
  for (const g of r.uygun.slice(0, 8)) console.log(`   ${String(g.en).padStart(5)}x${String(g.boy).padEnd(5)} ${g.lisans.padEnd(14)} ${g.baslik.slice(0, 60)}`);
  const nedenler = {};
  for (const g of r.elenen) nedenler[g.neden.split(":")[0]] = (nedenler[g.neden.split(":")[0]] || 0) + 1;
  if (r.kopya) console.log(`   ${r.kopya} kopya birlestirildi`);
  if (r.elenen.length) console.log(`   elenen: ${Object.entries(nedenler).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  console.log("   ⚠ Gorsellerin olayla ilgili oldugunu GOZLE dogrula — arama metin eslesmesi yapar");
}

module.exports = { lisansUygun, ele, tara, tekilles, ELE };

if (require.main === module) {
  (async () => {
    const argv = process.argv.slice(2);
    const json = argv.includes("--json");
    const li = argv.indexOf("--liste");
    const olaylar = li >= 0
      ? require("fs").readFileSync(argv[li + 1], "utf8").split(/\r?\n/).map((x) => x.trim()).filter((x) => x && !x.startsWith("#"))
      : argv.filter((a) => !a.startsWith("--"));
    if (!olaylar.length) { console.error('Kullanim: node aday-gorsel.js "Olay adi" [--json] | --liste dosya.txt'); process.exit(1); }
    const ozet = [];
    for (const o of olaylar) { const r = await tara(o); yazdir(r, json); ozet.push(r); await uyku(900); }
    if (!json && olaylar.length > 1) {
      const y = ozet.filter((r) => r.uygun.length >= 6).length, a = ozet.filter((r) => r.uygun.length >= 3 && r.uygun.length < 6).length;
      console.log(`\n=== ${y} olay YETERLI (6+ gorsel), ${a} olay AZ (3-5), ${ozet.length - y - a} yetersiz`);
    }
  })().catch((e) => { console.error("Hata: " + e.message); process.exit(1); });
}
