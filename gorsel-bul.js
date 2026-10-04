// gorsel-bul.js <is>
// KONU BAGIMSIZ gorsel bulucu. Spor, yemek, reklam, uzay — fark etmez.
// Arama kelimelerini SENARYODAN kendisi cikarir (senaryo Ingilizce oldugu icin
// Konu notu Turkce yazilsa bile arama dogru calisir).
//
// Kaynaklar (hicbiri anahtar istemez):
//   1. Openverse  — 700M+ CC gorsel (Flickr, muzeler, Wikimedia...) — GENEL AMACLI
//   2. Wikimedia  — ansiklopedik, kisi/yer/olay
//   3. NASA       — SADECE konu uzay/kozmik ise
//
// LISANS: kanal para kazandigi icin NC (ticari degil) ve ND (turetilemez)
// lisanslar HIC alinmaz. Once CC0/kamu mali, yetmezse ticari-kullanima-acik CC-BY.
//
// KAYNAK ONCELIGI (adli muhendislik kanali — gercek kanit once gelir):
//   1 orijinal tarihi/arsiv (archive.org, kamu mali/1929 oncesi)  2 devlet/kamu mali (Wikimedia PD)
//   3 NASA  4 NTSB  5 Wikimedia Commons (CC)  6 teknik diyagram  7 Openverse CC
//   8 stok (Pexels/Pixabay)  9 AI yeniden kurgu (yalnizca "uret:" ile, ekranda etiketli)
// Belirli bir olay varken genel aramalar ("bridge", "rocket") olay adiyla daraltilir.
// Her gorsel icin Visuals/kaynaklar.json: kaynak URL, kurum, lisans, arama terimi,
// alaka puani, oncelik katmani, sentetik mi.

const https = require("https");
const fs = require("fs");
const path = require("path");
const uretici = require("./gorsel-uret.js");   // "uret:" ile isaretli sahneler icin

const KOK = __dirname;
const URETIM = path.join(KOK, "uretim");
const is = process.argv[2];
if (!is) { console.error("kullanim: node gorsel-bul.js <is-adi>"); process.exit(1); }

const BASE = path.join(URETIM, is);
const VIS = path.join(BASE, "Visuals");

// ---------------- yardimcilar ----------------
const bekle = ms => new Promise(r => setTimeout(r, ms));

// Wikimedia politikasi: aciklayici User-Agent sart, yoksa engelliyor.
const UA = "FailureReconstructedBot/1.0 (+https://github.com/eyazan/youtube-otomasyon; node " + process.versions.node + ")";

function tekGetir(url, ikili, derinlik) {
  derinlik = derinlik || 0;
  return new Promise((coz, red) => {
    if (derinlik > 5) return red(new Error("cok fazla yonlendirme"));
    const r = https.get(url, { headers: { "User-Agent": UA, "Accept": "*/*" }, timeout: 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return coz(tekGetir(new URL(res.headers.location, url).toString(), ikili, derinlik + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        const e = new Error("HTTP " + res.statusCode); e.kod = res.statusCode; return red(e);
      }
      const parca = [];
      res.on("data", c => parca.push(c));
      res.on("end", () => coz(ikili ? Buffer.concat(parca) : Buffer.concat(parca).toString("utf8")));
    });
    r.on("timeout", () => { r.destroy(); red(new Error("zaman asimi")); });
    r.on("error", red);
  });
}

// 429 (cok fazla istek) gelirse artan araliklarla tekrar dene
async function getir(url, ikili) {
  const araliklar = [1500, 4000, 9000];
  for (let i = 0; ; i++) {
    try { return await tekGetir(url, ikili); }
    catch (e) {
      if (e.kod === 429 && i < araliklar.length) { await bekle(araliklar[i]); continue; }
      throw e;
    }
  }
}

// Gorsel indirirken UZUN bekleme yapma: havuz genis, 429 gelirse
// sonraki gorsele gecmek beklemekten cok daha hizli.
async function gorselGetir(url) {
  try { return await tekGetir(url, true); }
  catch (e) {
    if (e.kod !== 429) throw e;
    await bekle(900);
    return await tekGetir(url, true);
  }
}

const jsonGetir = async u => JSON.parse(await getir(u, false));

// ---------------- arama kelimesi cikarimi ----------------
const DURAK = new Set(("a an the and or but if then than that this these those of in on at to for from by with " +
  "as is are was were be been being have has had do does did will would can could should may might must shall " +
  "it its it's we our us you your they their them he she his her i me my not no nor so such very more most " +
  "much many some any all both each few other another same own just also too only even still yet about into " +
  "over under again further once here there when where why how what which who whom while because before after " +
  "above below between through during against among within without across behind beyond upon since until " +
  "one two three first second next last new old good great big small long short high low right left thing " +
  "things something anything everything nothing someone anyone everyone way ways time times year years day days " +
  "make makes made making take takes took taken get gets got getting go goes going gone come comes came " +
  "know knows knew known think thinks thought see sees saw seen look looks looked want wants wanted " +
  "say says said tell tells told give gives gave given find finds found use uses used using " +
  "really actually basically simply literally probably maybe perhaps almost always never often sometimes " +
  "let lets like likes liked well back down out up off now today tomorrow yesterday " +
  "would could should might must shall will can may need needs needed " +
  // soyut kelimeler: gorsel aramada ise yaramaz, cikar
  "moment moments people person thing things story stories part parts half kind sort lot bit " +
  "end ends start starts side sides point points case cases fact facts idea ideas reason reasons " +
  "result results example examples number numbers group groups level levels area areas place places " +
  "life lives work works word words name names form forms line lines order orders state states " +
  "change changes question questions answer answers problem problems chance chances " +
  "sense senses truth kinds amount amounts piece pieces set sets step steps stage stages " +
  "difference differences matter matters issue issues topic subject sense feeling feelings " +
  "everybody nobody somebody anybody others rest whole entire actual real true false " +
  "begin begins began begun happen happens happened turn turns turned keep keeps kept " +
  "become becomes became put puts seem seems seemed leave leaves left bring brings brought " +
  "call calls called work working try tries tried ask asks asked show shows showed shown " +
  "mean means meant feel feels felt run runs ran stop stops stopped talk talks talked " +
  "believe believes hear hears heard hold holds held remember remembers write writes wrote " +
  "understand understands sit sits stand stands lose loses lost pay pays paid meet meets met " +
  "years year day days week weeks month months hour hours minute minutes second seconds " +
  "today tomorrow yesterday tonight morning evening night again already ever never " +
  "little large huge tiny enough far near close early late fast slow hard easy simple " +
  "important different possible impossible available able likely unlikely certain sure " +
  "usually rarely mostly nearly exactly quite rather pretty fairly somewhat entirely completely " +
  "every either neither everywhere anywhere somewhere elsewhere however therefore moreover " +
  "instead besides otherwise meanwhile although though unless whether around throughout"
  ).split(/\s+/));

function kelimeler(metin) {
  return metin.toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .map(w => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(w => w.length > 2 && !DURAK.has(w) && !/^\d+$/.test(w));
}

// Ozel isimler: "Cristiano Ronaldo", "Manchester United", "Madeira".
// Gorsel aramada en degerli sinyal bunlar. Cumle basindaki buyuk harfi sayma.
function ozelIsimler(paragraf) {
  const bulunan = [];
  const re = /([.!?]\s+|^)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})*)/g;
  let m;
  while ((m = re.exec(paragraf)) !== null) {
    const cumleBasi = !!m[1] || m.index === 0;
    const ifade = m[2];
    const kelimeSayisi = ifade.split(/\s+/).length;
    // cok kelimeli her zaman ozel isimdir; tek kelime ise cumle basinda olmamali
    if (kelimeSayisi >= 2 || !cumleBasi) {
      if (!DURAK.has(ifade.toLowerCase())) bulunan.push(ifade);
    }
  }
  return [...new Set(bulunan)];
}

// Tum senaryonun genel konusu: en cok gecen somut kelimeler.
// Her sahne icin garanti yedek arama olarak kullanilir.
function genelCapa(senaryo, paragraflar) {
  const sayim = {}, paragrafta = {};
  for (const w of kelimeler(senaryo)) sayim[w] = (sayim[w] || 0) + 1;
  for (const p of paragraflar)
    for (const w of new Set(kelimeler(p))) paragrafta[w] = (paragrafta[w] || 0) + 1;

  // Konuyu temsil eden kelime = EN COK PARAGRAFTA gecen kelime.
  // (Uzunluga gore siralamak "unremarkable" gibi tek seferlik kelimeleri secip capayi bozuyordu.)
  const sirali = Object.keys(sayim)
    .sort((a, b) => (paragrafta[b] - paragrafta[a]) || (sayim[b] - sayim[a]) || a.localeCompare(b));

  const capa = [];
  const ozel = ozelIsimler(senaryo);
  if (ozel.length) capa.push(ozel[0]);
  for (const w of sirali) {
    if (capa.length >= 3) break;
    if (paragrafta[w] < 2 && capa.length) break;              // tek paragrafta gecen kelime capa olamaz
    if (!capa.join(" ").toLowerCase().includes(w)) capa.push(w);
  }
  return capa;
}

// Bir paragraf icin denenecek arama ifadeleri — en iyiden en genele.
function ifadeCikar(paragraf, genelSayim, toplamKelime, capa, paragrafta) {
  const k = kelimeler(paragraf);
  const yerel = {};
  for (const w of k) yerel[w] = (yerel[w] || 0) + 1;
  const puan = w => (yerel[w] || 0) * Math.log(toplamKelime / (genelSayim[w] || 1));

  // Metinde SADECE BIR KEZ gecen kelime konuyu temsil etmez — "fiction",
  // "obvious", "yes", "bend" gibi cop aramalar bu yuzden cikiyordu.
  // Konu kelimeleri tekrar eder; gecici kelimeler etmez.
  const tumTekil = [...new Set(k)].sort((a, b) => puan(b) - puan(a));
  const tekrarEden = tumTekil.filter(w => (paragrafta[w] || 0) >= 2 || (genelSayim[w] || 0) >= 3);
  const tekil = tekrarEden.length ? tekrarEden : tumTekil;
  const ozel = ozelIsimler(paragraf);
  const capaMetin = capa.slice(0, 2).join(" ");

  // Sira onemli: paragrafin KENDI kelimesi once. Capayi one eklemek
  // ("unremarkable roaster") aramayi bozuyordu — capa sadece yedek.
  const aday = [];
  ozel.slice(0, 2).forEach(o => aday.push(o));               // 1. ozel isimler — en degerli
  if (tekil[0]) aday.push(tekil[0]);                          // 2. paragrafin en ayirt edici kelimesi
  if (tekil[1]) aday.push(tekil[1]);                          // 3. ikincisi
  if (capa[0] && tekil[0]) aday.push(capa[0] + " " + tekil[0]);  // 4. konu + kelime
  if (capaMetin) aday.push(capaMetin);                        // 5. garanti yedek: genel konu
  if (capa[0]) aday.push(capa[0]);

  return [...new Set(aday.filter(Boolean))];
}

// NASA sadece GERCEKTEN kozmik konularda. "space" tek basina yetmez —
// futbol metnindeki "half second of space" NASA'yi tetikliyordu.
const KOZMIK_GUCLU = /\b(nebula|galaxy|galaxies|cosmos|cosmic|quasar|supernova|astronaut|astronomy|spacecraft|interstellar|spacetime|black hole|solar system|milky way|nasa|hubble|telescope|orbit|planet|planets|asteroid|comet|neutron star)\b/gi;
function kozmikMi(senaryo) {
  const v = senaryo.match(KOZMIK_GUCLU);
  return !!v && v.length >= 3;
}

// ---------------- .env ----------------
function env(ad) {
  try {
    for (const l of fs.readFileSync(path.join(KOK, ".env"), "utf8").split(/\r?\n/)) {
      const m = l.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === ad) return m[2].trim();
    }
  } catch (e) {}
  return "";
}
const PEXELS = env("PEXELS_KEY");
const PIXABAY = env("PIXABAY_KEY");

// ---------------- kaynaklar ----------------

// 0) PEXELS — anahtar varsa EN IYI kaynak: modern, profesyonel, yuksek cozunurluk.
// Reklam / yemek / mekan / spor / insan konularinda Wikimedia'yi acik ara geride birakir.
function pexselsIstek(url) {
  return new Promise((coz, red) => {
    const u = new URL(url);
    const r = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method: "GET",
      headers: { "Authorization": PEXELS, "User-Agent": UA }, timeout: 25000,
    }, res => {
      let g = "";
      res.on("data", c => g += c);
      res.on("end", () => {
        if (res.statusCode !== 200) { const e = new Error("HTTP " + res.statusCode); e.kod = res.statusCode; return red(e); }
        try { coz(JSON.parse(g)); } catch (e) { red(e); }
      });
    });
    r.on("timeout", () => { r.destroy(); red(new Error("zaman asimi")); });
    r.on("error", red);
    r.end();
  });
}

let pexelsKapali = !PEXELS;
async function pexels(q, dikey) {
  if (pexelsKapali) return [];
  const u = "https://api.pexels.com/v1/search?query=" + encodeURIComponent(q) +
            "&per_page=40&orientation=" + (dikey ? "portrait" : "landscape");
  try {
    const d = await pexselsIstek(u);
    return (d.photos || []).map(p => ({
      url: (p.src && (p.src.large2x || p.src.original || p.src.large)) || "",
      baslik: p.alt || q, lisans: "Pexels", kaynak: "pexels",
      atif: p.photographer || "", nereden: p.url || "",
      en: p.width, boy: p.height,
    })).filter(x => x.url);
  } catch (e) {
    if (e.kod === 429) { pexelsKapali = true; console.log("  (Pexels saatlik limit doldu — diger kaynaklarla devam)"); }
    else if (e.kod === 401) { pexelsKapali = true; console.log("  (Pexels anahtari gecersiz — diger kaynaklarla devam)"); }
    return [];
  }
}

// 0b) PIXABAY — anahtar varsa ikinci kaliteli kaynak. Genis arsiv, cok yuksek limit.
let pixabayKapali = !PIXABAY;
async function pixabay(q, dikey) {
  if (pixabayKapali) return [];
  const u = "https://pixabay.com/api/?key=" + encodeURIComponent(PIXABAY) +
            "&q=" + encodeURIComponent(q) + "&image_type=photo&per_page=40&safesearch=true" +
            "&orientation=" + (dikey ? "vertical" : "horizontal") + "&min_width=1200";
  try {
    const d = await tekGetir(u, false).then(JSON.parse);
    return (d.hits || []).map(h => ({
      url: h.largeImageURL || h.webformatURL, baslik: h.tags || q,
      lisans: "Pixabay", kaynak: "pixabay", atif: h.user || "", nereden: h.pageURL || "",
      en: h.imageWidth, boy: h.imageHeight,
    })).filter(x => x.url);
  } catch (e) {
    if (e.kod === 429 || e.kod === 400 || e.kod === 401) {
      pixabayKapali = true;
      console.log("  (Pixabay kullanilamadi: HTTP " + e.kod + " — diger kaynaklarla devam)");
    }
    return [];
  }
}

// 1) Openverse — genel amacli. Anahtarsiz kullanimda saatlik istek limiti COK dar,
// o yuzden ek kaynak olarak kullanilir; 429 gelince bu calisma icin kapatilir.
let openverseKapali = false;
async function openverse(q) {
  if (openverseKapali) return [];
  const u = "https://api.openverse.org/v1/images/?q=" + encodeURIComponent(q) +
            "&page_size=40&mature=false";
  try {
    const d = await tekGetir(u, false).then(JSON.parse);
    return (d.results || [])
      .filter(r => r.url && (r.width || 0) >= 800 && (r.height || 0) >= 500)
      .map(r => ({
        url: r.url, baslik: r.title || q, lisans: r.license,
        kaynak: "openverse", atif: r.creator || "", nereden: r.foreign_landing_url || "",
        en: r.width, boy: r.height,
      }));
  } catch (e) {
    if (e.kod === 429) { openverseKapali = true; console.log("  (Openverse istek limiti doldu — Wikimedia ile devam)"); }
    return [];
  }
}

// 2) Wikimedia Commons — ansiklopedik
async function wikimedia(q) {
  const u = "https://commons.wikimedia.org/w/api.php?action=query&generator=search" +
    "&gsrsearch=" + encodeURIComponent(q) + "&gsrnamespace=6&gsrlimit=30" +
    "&prop=imageinfo&iiprop=url|size|extmetadata&iiurlwidth=1920&format=json&origin=*";
  try {
    const d = await jsonGetir(u);
    const s = (d.query && d.query.pages) || {};
    return Object.values(s).map(p => {
      const i = p.imageinfo && p.imageinfo[0];
      if (!i || !i.thumburl) return null;
      // Tarihi kamu mali fotograflar cogu zaman kucuk: 640px'e kadar kabul.
      if ((i.width || 0) < 640) return null;
      // Wikimedia URL'lere "?utm_source=..." ekliyor — uzanti kontrolu sorgu disinda yapilmali
      // (aksi halde TUM Wikimedia sonuclari sessizce eleniyordu).
      if (!/\.(jpe?g|png)$/i.test(String(i.url || "").split("?")[0])) return null;
      const m = i.extmetadata || {};
      const lis = (m.LicenseShortName && m.LicenseShortName.value) || "";
      return {
        url: i.thumburl, baslik: (p.title || "").replace(/^File:/, ""), lisans: lis || "CC/PD",
        kaynak: "wikimedia", atif: (m.Artist && String(m.Artist.value).replace(/<[^>]+>/g, "").trim()) || "",
        nereden: i.descriptionurl || "", en: i.width, boy: i.height,
      };
    }).filter(Boolean);
  } catch (e) { return []; }
}

// 3) NASA — sadece kozmik konularda
const NASA_KARA = /(chart|graph|diagram|plot|schematic|logo|portrait|headshot|award|ceremony|meeting|conference|badge|patch|infographic|screenshot|map of|timeline)/i;
async function nasa(q) {
  const u = "https://images-api.nasa.gov/search?q=" + encodeURIComponent(q) + "&media_type=image";
  try {
    const d = await jsonGetir(u);
    const ogeler = (d.collection && d.collection.items) || [];
    const cikti = [];
    for (const o of ogeler.slice(0, 30)) {
      const veri = o.data && o.data[0];
      const bag = o.links && o.links[0];
      if (!veri || !bag || !bag.href) continue;
      if (NASA_KARA.test(veri.title || "")) continue;
      cikti.push({
        url: bag.href.replace(/~thumb\.jpg$/, "~orig.jpg"), baslik: veri.title || q,
        lisans: "NASA / kamu mali", kaynak: "nasa", atif: "NASA", nereden: "",
        en: 2000, boy: 1500,
      });
    }
    return cikti;
  } catch (e) { return []; }
}

// 0) archive.org — tarihi arsiv gorselleri. Yalnizca kamu mali isaretli ya da 1929
// oncesi (ABD'de sure dolmus) ogeler alinir; hak durumu belirsiz olan ALINMAZ.
async function arsivOrg(q) {
  const u = "https://archive.org/advancedsearch.php?q=" + encodeURIComponent("(" + q + ") AND mediatype:(image)") +
    "&fl[]=identifier&fl[]=title&fl[]=licenseurl&fl[]=year&rows=8&output=json";
  try {
    const d = await jsonGetir(u);
    const cikti = [];
    for (const o of ((d.response || {}).docs || [])) {
      const pd = /publicdomain|\/zero\//i.test(o.licenseurl || "") || (o.year && +o.year < 1929);
      if (!pd) continue;
      const meta = await jsonGetir("https://archive.org/metadata/" + encodeURIComponent(o.identifier)).catch(() => null);
      const f = ((meta && meta.files) || []).filter((x) => /\.(jpe?g|png)$/i.test(x.name || "") && +(x.size || 0) > 150000)
        .sort((a, b) => +b.size - +a.size)[0];
      if (!f) continue;
      cikti.push({ url: "https://archive.org/download/" + o.identifier + "/" + encodeURIComponent(f.name), baslik: String(o.title || q),
        lisans: /publicdomain|\/zero\//i.test(o.licenseurl || "") ? "Public domain (archive.org)" : "Public domain (published before 1929)",
        kaynak: "archive.org", atif: "", nereden: "https://archive.org/details/" + o.identifier, en: 1600, boy: 1200 });
      await bekle(300);
    }
    return cikti;
  } catch (e) { return []; }
}

const PD = /public domain|^pd|cc0|pdm|no restrictions|us-?gov/i;
const GENEL = new Set("engineer engineers rocket rockets bridge bridges factory plant building buildings ship ships plane planes dam dams fire explosion disaster ruins city".split(" "));

// Oncelik katmanlari — ust katman yeterli gorsel verirse alttakilere inilmez.
function katmanlar(ctx) {
  return [
    { ad: "archive", kurum: "Internet Archive", fn: (q) => arsivOrg(q) },
    { ad: "gov-pd", kurum: "Wikimedia Commons (public domain)", fn: async (q) => (await ctx.wiki(q)).filter((g) => PD.test(g.lisans)) },
    { ad: "nasa", kurum: "NASA", fn: (q) => ctx.kozmik ? nasa(q) : [] },
    { ad: "ntsb", kurum: "NTSB (via Wikimedia)", fn: async (q) => ctx.ulasim ? (await wikimedia(q + " NTSB")).filter((g) => PD.test(g.lisans)) : [] },
    { ad: "wikimedia", kurum: "Wikimedia Commons", fn: async (q) => (await ctx.wiki(q)).filter((g) => !PD.test(g.lisans)) },
    { ad: "diagram", kurum: "Wikimedia Commons (diagram)", fn: (q) => ctx.teknik ? wikimedia(q + " diagram") : [] },
    { ad: "openverse", kurum: "Openverse (CC)", fn: (q) => openverse(q) },
    { ad: "stock", kurum: "Pexels/Pixabay", fn: async (q) => (await pexels(q, ctx.kisa)).concat(ctx.azMi() ? await pixabay(q, ctx.kisa) : []) },
  ];
}

function alaka(q, g) {
  const w = String(q).toLowerCase().split(/\W+/).filter((x) => x.length > 2);
  const t = (String(g.baslik || "") + " " + String(g.nereden || "")).toLowerCase();
  return w.length ? Math.round(w.filter((x) => t.includes(x.slice(0, 5))).length / w.length * 100) / 100 : 0;
}

// ---------------- ana akis ----------------
(async () => {
  const senaryoYolu = path.join(BASE, "Voice", "SESLENDIRME-TAM-METIN.txt");
  let senaryo = "";
  try { senaryo = fs.readFileSync(senaryoYolu, "utf8").trim(); } catch (e) {}
  if (senaryo.length < 50) {
    console.error("✗ Senaryo yok. Once senaryo yazilmali (zincir bunu otomatik yapar).");
    process.exit(1);
  }

  let konu = {};
  try { konu = JSON.parse(fs.readFileSync(path.join(BASE, "konu.json"), "utf8")); } catch (e) {}
  const kisa = konu.aspect === "9:16" || konu.format === "short";

  // Paragraf = sahne kurali kisa paragraflarda cok fazla sahne uretiyor
  // (230 paragraf -> 690 gorsel). Kisa paragraflari birlestirip her sahnenin
  // en az ~10 saniyelik anlatim tasimasini sagliyoruz.
  // Sahne kurali lib/sahne.js'te tek kaynak (video-yap.js ayni kurala gore zamanlar).
  const hamParagraflar = senaryo.split(/\n\s*\n/).map(p => p.trim()).filter(p => p.length > 25);
  const paragraflar = require("./lib/sahne").sahneParagraflari(senaryo);
  if (hamParagraflar.length !== paragraflar.length)
    console.log("sahne     : " + hamParagraflar.length + " paragraf -> " + paragraflar.length + " sahne (kisalar birlestirildi)");
  const toplamKelime = kelimeler(senaryo).length;        // SUZULMUS (tf-idf icin)
  const hamKelime = senaryo.split(/\s+/).filter(Boolean).length;   // HAM (sure icin)
  const genelSayim = {};
  for (const w of kelimeler(senaryo)) genelSayim[w] = (genelSayim[w] || 0) + 1;

  // Sure HAM kelime sayisindan hesaplanmali. Suzulmus sayiyi kullanmak
  // sureyi ~2.5 kat eksik gosteriyordu -> cok az gorsel iniyordu.
  // OLCULEN konusma hizi: Ingilizce 151 kel/dk, Turkce 113 (kelimeler uzun).
  // Dil, konu.json'daki ses kodundan anlasiliyor (tr-TR-... = Turkce).
  const KEL_DK = /^tr[-_]/i.test(String(konu.ses || "")) ? 113 : 151;
  const sure = hamKelime / KEL_DK * 60;
  const toplamGorsel = Math.max(6, Math.min(160, Math.round(sure / 8)));
  const sahneBasina = Math.max(3, Math.min(14, Math.ceil(toplamGorsel / paragraflar.length)));

  const kozmik = kozmikMi(senaryo);
  const capa = genelCapa(senaryo, paragraflar);
  const paragrafta = {};
  for (const p of paragraflar)
    for (const w of new Set(kelimeler(p))) paragrafta[w] = (paragrafta[w] || 0) + 1;

  console.log("senaryo   : " + paragraflar.length + " paragraf · " + hamKelime + " kelime · ~" +
              Math.floor(sure / 60) + " dk " + Math.round(sure % 60) + " sn");
  console.log("hedef     : ~" + toplamGorsel + " gorsel (sahne basina " + sahneBasina + ")");
  console.log("konu capa : " + capa.join(" · "));
  console.log("kaynaklar : " + [PEXELS && "Pexels", PIXABAY && "Pixabay", "Wikimedia", "Openverse",
              kozmik && "NASA"].filter(Boolean).join(" + "));
  console.log("");

  fs.mkdirSync(VIS, { recursive: true });

  const kunye = [];
  const meta = [];                 // Visuals/kaynaklar.json
  let toplamIndirilen = 0;
  const gorulen = new Set();
  const vaka = konu.vaka || {};
  const kumeId = (() => { try { return require("./lib/kutuphane").kumeBul(konu); } catch (e) { return ""; } })();
  const wikiOnbellek = new Map();
  const ctx = { kozmik, kisa, ulasim: /aviation|spaceflight|maritime/.test(kumeId), teknik: true, azMi: () => true,
    wiki: async (q) => { if (!wikiOnbellek.has(q)) { wikiOnbellek.set(q, await wikimedia(q)); await bekle(1200); } return wikiOnbellek.get(q); } };
  const KATMAN = katmanlar(ctx);

  for (let i = 0; i < paragraflar.length; i++) {
    const no = String(i + 1).padStart(2, "0");
    // konu.json > sahneKelimeleri[i] varsa OTOMATIK CIKARIM DEVRE DISI.
    // Soyut paragraflarda otomatik cikarim "ceiling", "changed" gibi
    // ise yaramaz kelimeler seciyor; elle yazmak her zaman daha iyi.
    const elle = Array.isArray(konu.sahneKelimeleri) ? konu.sahneKelimeleri[i] : null;
    const adaylar = elle
      ? (Array.isArray(elle) ? elle.slice() : [String(elle)])
      : ifadeCikar(paragraflar[i], genelSayim, toplamKelime, capa, paragrafta);
    if (!adaylar.length) adaylar.push(capa[0] || "abstract");
    const sahneAd = no + "-" + adaylar[0].toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "").slice(0, 24);
    const klasor = path.join(VIS, sahneAd);
    fs.mkdirSync(klasor, { recursive: true });

    // --- AI URETIMI ---
    // Sahne kelimesi "uret:" ile basliyorsa stok arama yapilmaz, gorsel
    // uretilir. Soyut kavramlarin ("kuantum dolanikligi", "sinir agi")
    // stok fotografi yoktur. Gercek seyler stok fotograftan gelmeli.
    if (/^uret:/i.test(adaylar[0])) {
      const istem = uretici.istemKur(adaylar[0], konu.uretStil);
      const adet = Number(konu.uretAdet || sahneBasina || 2);
      let n = 0;
      for (let s = 0; s < adet; s++) {
        const hedef = path.join(klasor, `${no}-${s + 1}.jpg`);
        if (fs.existsSync(hedef) && fs.statSync(hedef).size > 20000) { n++; continue; }
        try {
          const { govde } = await uretici.uretBir(istem, kisa ? 768 : 1280, kisa ? 1344 : 720,
                                                  i * 100 + s + 1, true);
          fs.writeFileSync(hedef, govde);
          n++; toplamIndirilen++;
          kunye.push(`${sahneAd}/${path.basename(hedef)}  —  AI reconstruction (${istem.slice(0, 80)}) · labelled on screen`);
          meta.push({ sahne: sahneAd, dosya: path.basename(hedef), url: null, kurum: "AI generation", lisans: "generated", arama: adaylar[0],
            alaka: null, katman: "ai", sentetik: true });
        } catch (e) { /* uretilemezse sahne bos kalir, asagida uyari veriyoruz */ }
        await bekle(400);
      }
      console.log(`  ${sahneAd.padEnd(28)} [URETILDI] ${n} gorsel`);
      if (!n) console.log(`    !! uretilemedi — konu.json'daki "uret:" isaretini kaldirip stok aramaya birak`);
      continue;
    }

    // Belirli bir olay varsa genel tek kelimelik aramalari olay adiyla daralt
    // ("bridge" -> "Tacoma Narrows bridge") — generic stok yerine tarihi kanit.
    const sorgular = adaylar.map((q) => (vaka.tip === "vaka" && vaka.kisa && q.split(/\s+/).every((w) => GENEL.has(w.toLowerCase())))
      ? vaka.kisa + " " + q : q);
    // Oncelik katmanlari: ust katman yeterli gorsel verirse alta inilmez.
    let havuz = [], kullanilan = null;
    for (const katman of KATMAN) {
      if (havuz.length >= sahneBasina * 2) break;
      for (const q of sorgular) {
        if (havuz.length >= sahneBasina * 2) break;
        const onceki = havuz.length;
        const bulunan = (await katman.fn(q)) || [];
        havuz = havuz.concat(bulunan.map((g) => ({ ...g, katman: katman.ad, kurum: katman.kurum, arama: q, alaka: alaka(q, g) })));
        if (havuz.length > onceki && !kullanilan) kullanilan = q;
      }
    }

    // Ayni gorseli iki sahnede kullanma — AMA sahneyi bos birakma pahasina degil.
    // Ayni arama kelimesi iki sahnede gecerse (ornegin "MRI scanner"), tum
    // sonuclar ilk sahnede tukeniyor ve ikincisi bos kaliyordu.
    const tazeler = havuz.filter(g => !gorulen.has(g.url.split("?")[0]));
    if (tazeler.length >= Math.min(2, sahneBasina)) havuz = tazeler;
    for (const g of havuz.slice(0, sahneBasina)) gorulen.add(g.url.split("?")[0]);
    // Sira: oncelik katmani (kanit once) > alaka > cozunurluk
    const kSira = Object.fromEntries(KATMAN.map((k, i) => [k.ad, i]));
    havuz.sort((a, b) => (kSira[a.katman] - kSira[b.katman]) || (b.alaka - a.alaka) || ((b.en * b.boy) - (a.en * a.boy)));

    let n = 0;
    for (const g of havuz) {
      if (n >= sahneBasina) break;
      try {
        const veri = await gorselGetir(g.url);
        if (veri.length < 30000) continue;                       // cok kucuk / bozuk
        const uzanti = /\.png(\?|$)/i.test(g.url) ? ".png" : ".jpg";
        fs.writeFileSync(path.join(klasor, String(++n).padStart(2, "0") + uzanti), veri);
        toplamIndirilen++;
        kunye.push(`${sahneAd}/${String(n).padStart(2, "0")}${uzanti}  —  "${g.baslik}" ${g.atif ? "· " + g.atif : ""} · ${g.lisans} · ${g.kurum} · ${g.nereden || g.url}`);
        meta.push({ sahne: sahneAd, dosya: String(n).padStart(2, "0") + uzanti, url: g.nereden || g.url, kurum: g.kurum, lisans: g.lisans,
          yazar: g.atif || "", arama: g.arama, alaka: g.alaka, katman: g.katman, sentetik: false });
      } catch (e) { /* bu gorsel olmadi, sonrakine gec */ }
      await bekle(450);
    }

    console.log(`  ${sahneAd.padEnd(28)} "${kullanilan || adaylar[0]}" → ${n} gorsel`);
    if (n === 0) console.log(`     ⚠ bulunamadi — denenen: ${adaylar.join(" / ")}`);
  }

  // Atif (insan okur) + sahne basina kaynak metadatasi (video-yap etiketleri, aciklama, kalite kapisi)
  if (kunye.length) {
    fs.writeFileSync(path.join(BASE, "GORSEL-KAYNAKLARI.txt"), kunye.join("\n") + "\n", "utf8");
  }
  fs.writeFileSync(path.join(VIS, "kaynaklar.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");
  const katmanSay = meta.reduce((o, m) => (o[m.katman] = (o[m.katman] || 0) + 1, o), {});
  console.log("kaynak katmanlari: " + Object.entries(katmanSay).map(([k, v]) => k + "=" + v).join(" · "));

  // Uzun format: vaka dosyasi varsa adli muhendislik gorselleri (zaman cizelgesi, ariza
  // zinciri, kok neden...) ayni asamada sahne klasorlerine eklenir (hedef 4-8).
  if (!kisa && konu.vaka) {
    try {
      const m = require("./engineering-visuals").uzunIcinUret(is);
      console.log("muhendislik gorselleri: " + m.map((x) => x.tip).join(", "));
    } catch (e) { console.log("  (muhendislik gorselleri atlandi: " + e.message.slice(0, 120) + ")"); }
  }

  console.log("");
  console.log("✓ " + toplamIndirilen + " gorsel indirildi · " + paragraflar.length + " sahne");
  if (toplamIndirilen < paragraflar.length * 2) {
    console.log("  ⚠ Gorsel az geldi. Konuyu biraz daha somut yazmak sonucu iyilestirir.");
  }
})().catch(e => { console.error("✗ " + e.message); process.exit(1); });
