// SHORTS YAP — dikey (9:16) YouTube Shorts uretici.
//
// Gercek arsiv/stok goruntu (kamu mali) + dogal seslendirme + vurucu kinetik
// altyazi. Metin karti yok; gercek sahne var. Telifsiz, filigransiz.
//
// Girdi: uretim/<is>/konu.json
//   {
//     "kanal": "Failure Reconstructed",
//     "baslik": "...",
//     "ses": "en-US-AndrewNeural",      // Edge nöral ses (dogal)
//     "sesHizi": "+6%",
//     "altyaziFont": "Arial Black",     // istege bagli
//     "sahneler": [
//       { "metin": "cumle...", "kaynak": "Footage/x.mp4", "baslangic": 12 }
//     ]
//   }
// Kaynak klipler once indirilir (arsiv-bul.js). "baslangic" = kaynaktaki saniye.
//
// Cikti: uretim/<is>/Videos/<is>.mp4  (1080x1920)
//        uretim/<is>/Videos/sahne-zamanlari.json  (kapak karesi / analiz icin)
//
// Belgesel katmani (lib + motorlar):
//   - telaffuz sozlugu TTS'e uygulanir (config/pronunciation.json; altyazi orijinal kalir)
//   - scene-pacing: sahnenin anlatidaki rolune gore alt cekim kesmeleri + hareket
//     (olay = hizli kesme/punch-in, teknik = yavas surukleme) — kare hassasiyetinde zamanlama
//   - engineering-visuals: teknik sahnede "FAILURE CHAIN" ust katmani (~3 sn)
//   - vaka videolarinda tarih/yer damgasi; sentetik sahnelerde RECONSTRUCTION etiketi
//   - muzik profili kumeye gore (lib/muzik.js) — her video ayni yatagi calmaz
//
// Kullanim: node shorts-yap.js <is-adi>

const fs = require("fs");
const path = require("path");
const os = require("os");
const cp = require("child_process");
const { MsEdgeTTS, OUTPUT_FORMAT } = require("msedge-tts");
const FF = require("./ff-yol.js");
const font = require("./font-yol.js");
const pacing = require("./scene-pacing");
const telaffuz = require("./pronunciation-check");
const muzik = require("./lib/muzik");
const K = require("./lib/kutuphane");
const { ayar } = require("./lib/ayar");

const KOK = __dirname;
const IS = process.argv.find((a, i) => i >= 2 && !a.startsWith("--"));
if (!IS) { console.error("Kullanim: node shorts-yap.js <is-adi>"); process.exit(1); }
const BASE = path.join(KOK, "uretim", IS);
if (!fs.existsSync(path.join(BASE, "konu.json"))) { console.error("Is yok: " + BASE); process.exit(1); }
const konu = JSON.parse(fs.readFileSync(path.join(BASE, "konu.json"), "utf8"));

const W = 1080, H = 1920, FPS = 30;
const SES = konu.ses || "en-US-AndrewNeural";
const HIZ = konu.sesHizi || "+6%";
const FONT = konu.altyaziFont || process.env.SHORTS_FONT || "Arial Black";
const KANAL = (konu.kanal || "Failure Reconstructed");
const HANDLE = konu.handle || ("@" + KANAL.replace(/[^A-Za-z0-9]/g, ""));
const DFONT = font(true);   // drawtext icin acik font yolu
// Buyume: ekranda kanca (ilk ~2.5s) + sona etkilesim sorusu (yorum icin)
const cleanTxt = (s) => String(s || "").replace(/[{}]/g, "").replace(/\\/g, "").replace(/[<>]/g, "");
const HOOK = cleanTxt(konu.hook).toUpperCase();
const SERI = require("./core/series").label(require("./core/channel-context").getChannel("failure-reconstructed"), IS);
const SORU = cleanTxt(konu.soru);
const sahneler = konu.sahneler || [];
if (!sahneler.length) { console.error("konu.json'da sahneler[] yok."); process.exit(1); }

const VID = path.join(BASE, "Videos");
fs.mkdirSync(VID, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "shorts-" + IS + "-"));

const run = (a) => cp.execFileSync(FF.ffmpeg, a, { stdio: ["ignore", "ignore", "pipe"] });
const sure = (f) => parseFloat(cp.execFileSync(FF.ffprobe,
  ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString().trim());
// Kaynak en/boy (fotograf ve video): tam ekran kadraj karari icin (lib/dikey-kadraj.js).
const boyut = (f) => {
  try {
    const [w, h] = cp.execFileSync(FF.ffprobe, ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height",
      "-of", "csv=p=0:s=x", f]).toString().trim().split("x").map(Number);
    return { w, h };
  } catch (e) { return { w: 0, h: 0 }; }
};
const Kadraj = require("./lib/dikey-kadraj");

// --- 1) Seslendirme (tek parca) -----------------------------------------
function seslendir(metin, dosya) {
  return new Promise(async (coz, red) => {
    try {
      const tts = new MsEdgeTTS();
      await tts.setMetadata(SES, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
      const res = tts.toStream(metin, { rate: HIZ });
      const audioStream = res.audioStream || res;
      const chunks = [];
      audioStream.on("data", c => chunks.push(c));
      audioStream.on("end", () => { fs.writeFileSync(dosya, Buffer.concat(chunks)); coz(); });
      audioStream.on("close", () => { if (chunks.length) { try { fs.writeFileSync(dosya, Buffer.concat(chunks)); } catch (e) {} coz(); } });
      audioStream.on("error", red);
    } catch (e) { red(e); }
  });
}

// Edge TTS ara sira baglantiyi dusurur ("Stream closed..."). Tekrar dene.
async function seslendirGuvenli(metin, dosya, deneme = 4) {
  for (let i = 1; ; i++) {
    try {
      await seslendir(metin, dosya);
      if (fs.existsSync(dosya) && fs.statSync(dosya).size > 2000) return;
      throw new Error("ses cikti cok kisa/bos");
    } catch (e) {
      try { fs.unlinkSync(dosya); } catch (_) {}
      if (i >= deneme) throw new Error("Seslendirme " + deneme + " denemede basarisiz: " + e.message);
      process.stdout.write(`  (ses tekrar ${i}/${deneme}) `);
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}

// --- ASS zaman bicimi + kacis ------------------------------------------
const assTime = (t) => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60;
  return `${h}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`; };
const assKacis = (s) => String(s).replace(/[{}]/g, "").replace(/\\/g, "");

(async () => {
  console.log(`Shorts: ${IS}  (${W}x${H}, ${sahneler.length} sahne, ses ${SES})`);
  const vo = path.join(TMP, "vo.mp3");
  const anlati = sahneler.map(s => s.metin.trim()).join(" ");
  // Ses sozluk karsiliklariyla okunur (O-ring -> "O ring"); altyazi orijinal yazimi korur.
  await seslendirGuvenli(telaffuz.ttsMetni(anlati), vo);
  if (!fs.existsSync(vo) || fs.statSync(vo).size < 1000) throw new Error("Seslendirme uretilemedi.");
  const VODUR = sure(vo);

  // sahne sureleri: kelime payina gore
  const kelime = (t) => t.trim().split(/\s+/).length;
  const toplamK = sahneler.reduce((a, s) => a + kelime(s.metin), 0);
  let acc = 0;
  for (const s of sahneler) { s.dur = VODUR * kelime(s.metin) / toplamK; s.start = acc; acc += s.dur; }

  // baslangic: elle verilmemisse kaynak boyunca otomatik dagit; her zaman
  // kaynak suresine gore kirp (trim kaynak sonunu asmasin).
  const gruplar = {};
  sahneler.forEach((s, i) => { (gruplar[s.kaynak] = gruplar[s.kaynak] || []).push(i); });
  for (const [k, idxs] of Object.entries(gruplar)) {
    const kaynakYol = path.join(BASE, k);
    if (!fs.existsSync(kaynakYol)) continue;
    const kDur = sure(kaynakYol) || 0;
    idxs.forEach((idx, n) => {
      const s = sahneler[idx];
      const ust = Math.max(0, kDur - s.dur - 0.1);
      if (s.baslangic == null) {
        // ayni kaynagi paylasan sahneleri kaynak boyunca esit dagit (cesitlilik)
        s.baslangic = idxs.length > 1 ? ust * (n + 0.05) / idxs.length : Math.min(1.5, ust);
      }
      s.baslangic = Math.max(0, Math.min(s.baslangic, ust));
    });
  }

  // --- 2) sahne plani (anlatidaki role gore) + dikey bulanik-dolgu alt cekimler ---
  const planlar = pacing.planKisa(konu, sahneler.map(s => s.dur));
  // Kanal tonu: stok (modern, renkli) goruntuye tek tip "belgesel tonu" — hafif
  // solgun renk, biraz kontrast, celik/soguk golgeler. Arsiv filmleri oldugu gibi kalir.
  // config/growth.json > renk.stok ile ayarlanir ("" = kapali).
  const TON = konu.tur === "stok" ? (ayar().renk && ayar().renk.stok) || "" : "";
  // Kadraj: fotograf tam ekran + pan, video ~%60 yukseklik (lib/dikey-kadraj.js).
  const boyutlar = {};
  // Hareket: punch = tek sayili alt cekimde anlik %7 yakinlasma (kurgu ritmi);
  // push/drift = 2x ara olcekte zoompan (alt-piksel titreme olmasin).
  const hareketFiltre = (h, j, n) => {
    if (h === "punch") return j % 2 ? "crop=iw/1.07:ih/1.07,scale=1080:1920,setsar=1" : "";
    if (h === "push") return `scale=2160:3840,zoompan=z='1+0.045*on/${n}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30`;
    if (h === "drift") return `scale=2160:3840,zoompan=z='1.04':x='(iw-iw/zoom)*(0.5+0.35*(on/${n}-0.5))':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps=30`;
    return "";
  };
  // ARSIV FOTOGRAFI: hareketsiz kare Shorts'ta olu durur; her cekimde tam ekran pan ya da
  // yavas yakinlasma uygulanir, yon cekim sirasina gore degisir (lib/dikey-kadraj.fotoFiltre).
  const FOTO = /\.(jpe?g|png|webp)$/i;
  const kaynakSure = {};
  const klipler = [];
  const zamanlar = [];
  const ATLA = 0.6;          // alt cekimler arasi kaynakta ileri atlama (jump cut)
  let n = 0;
  for (let i = 0; i < sahneler.length; i++) {
    const s = sahneler[i], p = planlar[i];
    const kaynak = path.join(BASE, s.kaynak);
    if (!fs.existsSync(kaynak)) throw new Error("Kaynak klip yok: " + s.kaynak + " (once: node arsiv-bul.js " + IS + ")");
    const foto = FOTO.test(s.kaynak);
    if (kaynakSure[s.kaynak] == null) kaynakSure[s.kaynak] = foto ? Infinity : (sure(kaynak) || 0);
    // Kare hassasiyetli sinirlar: yuvarlama hatasi sahneler boyunca birikmesin (ses senkronu)
    const f0 = Math.round(s.start * FPS), f1 = Math.round((s.start + s.dur) * FPS);
    const kareler = Math.max(1, f1 - f0);
    const k = Math.max(1, Math.min(p.cekimSayisi || 1, Math.floor(kareler / (1.2 * FPS))));
    const bol = Array.from({ length: k }, (_, j) => Math.round(kareler * (j + 1) / k) - Math.round(kareler * j / k));
    const kalan = Math.max(0, kaynakSure[s.kaynak] - (s.baslangic || 0) - kareler / FPS - 0.1);
    const atla = k > 1 ? Math.min(ATLA, kalan / (k - 1)) : 0;
    let t = s.baslangic || 0;
    zamanlar.push({ sahne: i, bas: f0 / FPS, son: f1 / FPS, rol: p.rol, tempo: p.tempo, cekim: k, hareket: p.hareket });
    for (let j = 0; j < k; j++) {
      const out = path.join(TMP, "s" + String(n++).padStart(3, "0") + ".mp4");
      // Fotograf: hareket zorunlu (durgun kare Shorts'ta olu durur); video: plandaki hareket.
      const d = boyutlar[s.kaynak] || (boyutlar[s.kaynak] = boyut(kaynak));
      const hf = foto ? "" : hareketFiltre(p.hareket, j, bol[j]);
      const vf = foto ? Kadraj.fotoFiltre({ ...d, j: n, n: bol[j], ton: TON })
        : Kadraj.videoTaban({ ...d, ton: TON }) + (hf ? "[v0];[v0]" + hf + ",format=yuv420p[v]" : "[v]");
      const girdi = foto ? ["-loop", "1", "-framerate", String(FPS), "-i", kaynak]
        : ["-ss", Math.max(0, Math.min(t, kaynakSure[s.kaynak] - bol[j] / FPS - 0.05)).toFixed(3), "-i", kaynak];
      run(["-hide_banner", "-loglevel", "error", ...girdi, "-filter_complex", vf, "-map", "[v]",
        "-frames:v", String(bol[j]), "-r", String(FPS),
        "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-an", "-y", out]);
      klipler.push(out);
      if (!foto) t = Math.max(0, Math.min(t, kaynakSure[s.kaynak] - bol[j] / FPS - 0.05)) + bol[j] / FPS + atla;
    }
    process.stdout.write(`\r  sahne ${i + 1}/${sahneler.length} (${p.rol}, ${k} cekim)   `);
  }
  console.log("");
  fs.writeFileSync(path.join(VID, "sahne-zamanlari.json"), JSON.stringify(zamanlar, null, 2));

  // --- 3) sahneleri birlestir ---
  // Loop icin AYRI kapanis karti YOK — video canli goruntude biter, boylece
  // Shorts akici loop yapar (tekrar izleme = algoritma ödülü). Marka kalici
  // ust @handle ile, abone CTA'si aciklama + sabit yorumla korunur.
  const liste = path.join(TMP, "l.txt");
  fs.writeFileSync(liste, klipler.map(f => `file '${f}'`).join("\n"));
  const vid = path.join(TMP, "vid.mp4");
  run(["-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", liste, "-c", "copy", "-y", vid]);
  const TOPLAM = sure(vid);

  // --- muzik yatagi (prosedurel, telifsiz) — profil kumeye + slug'a gore (lib/muzik.js) ---
  const bed = path.join(TMP, "bed.wav");
  const mp = muzik.profil(IS, K.kumeBul(konu));
  run(["-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", `sine=frequency=${mp.kok}:duration=${TOPLAM.toFixed(2)}`,
    "-f", "lavfi", "-i", `sine=frequency=${(mp.kok * mp.oran).toFixed(2)}:duration=${TOPLAM.toFixed(2)}`,
    "-f", "lavfi", "-i", `anoisesrc=d=${TOPLAM.toFixed(2)}:c=${mp.renk}:a=0.04`,
    "-filter_complex",
      `[0]volume=0.55,tremolo=f=${mp.trem}:d=0.5[a];[1]volume=0.26[b];` +
      `[2]highpass=f=180,lowpass=f=1100,volume=0.6[c];` +
      `[a][b][c]amix=inputs=3:normalize=0,lowpass=f=${mp.alcak},aecho=0.8:0.9:${mp.yanki[0]}|${mp.yanki[1]}:0.28|0.2,` +
      `afade=t=in:st=0:d=1.6,afade=t=out:st=${(TOPLAM - 1.6).toFixed(2)}:d=1.6[m]`,
    "-map", "[m]", "-t", TOPLAM.toFixed(2), "-y", bed]);

  // --- 4) ASS altyazi (2-3 kelimelik gruplar, orantisal zaman) ---
  const events = [];
  for (const s of sahneler) {
    // Noktalama silinir AMA rakamlar arasindaki nokta/virgul korunur ("1.4" -> "14" olmasin, "2,500" kalsin)
    const words = require("./lib/metin").altyaziKelimeleri(s.metin);
    const wt = words.map(w => w.length + 1); const tw = wt.reduce((a, b) => a + b, 0);
    let c = 0; const bounds = words.map((w, i) => { const st = s.start + s.dur * c / tw; c += wt[i]; return { w, st, en: s.start + s.dur * c / tw }; });
    for (let i = 0; i < bounds.length;) {
      const n = (bounds.length - i === 3) ? 3 : Math.min(2, bounds.length - i);
      const grp = bounds.slice(i, i + n);
      events.push({ st: grp[0].st, en: grp[grp.length - 1].en, txt: grp.map(g => g.w.toUpperCase()).join(" ") });
      i += n;
    }
  }
  for (let i = 0; i < events.length - 1; i++) if (events[i + 1].st - events[i].en < 0.12) events[i].en = events[i + 1].st;

  // ASS kurucu: k = tum yazi boyutlarina uygulanan olcek (tasma denetimi basarisizsa kuculur).
  // Her yazi once ekrana sigacak boyuta ayarlanir (gorsel-denetim.sigdir).
  const DEN = require("./lib/gorsel-denetim");
  // Muhendislik paneli penceresi (FAILURE CHAIN, sol ust) ASS'ten ONCE bilinir: tarih
  // damgasi da sol ustte durdugu icin ayni saniyelere dusmemeli (ust uste binme olculdu).
  // Zincir artik her Short'ta gosterilir (eski kural 21 sn'lik videolarda hic pencere
  // bulamiyordu): teknik sahne varsa onun basinda, yoksa videonun ~%35'inde
  // (engineering-visuals.kisaZincirPenceresi).
  const teknikSahne = planlar.findIndex((p, i) => ["technical", "discovery"].includes(p.rol) && zamanlar[i].bas >= 3);
  const zincirPencere = require("./engineering-visuals").kisaZincirPenceresi({ adimSayisi: ((konu.vaka || {}).zincir || []).length,
    vodur: VODUR, teknikBas: teknikSahne >= 0 ? zamanlar[teknikSahne].bas + 0.15 : null });
  const katmanSahne = zincirPencere ? Math.max(0, teknikSahne) : -1;
  const katmanA = zincirPencere ? zincirPencere.a : null;
  const katmanB = zincirPencere ? zincirPencere.b : null;
  const katmanlaCakisir = (a, b) => katmanA != null && a < katmanB + 0.3 && b > katmanA - 0.3;
  let damgaPencere = null;
  const assKur = (k) => `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, OutlineColour, BackColour, Bold, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Pop,${FONT},90,&H00FFFFFF,&H00000000,&H64000000,1,1,7,3,2,60,60,470,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
` + events.map(e => {
    const eff = `{\\fs${Math.round(DEN.sigdir(e.txt, 90, W, 0.76) * k)}\\fad(70,60)\\t(0,120,\\fscx116\\fscy116)\\t(120,220,\\fscx100\\fscy100)}`;
    return `Dialogue: 0,${assTime(e.st)},${assTime(e.en)},Pop,,0,0,0,,${eff}${assKacis(e.txt)}`;
  }).join("\n") + "\n" + (() => {
    // BUYUME: ekranda kanca (ilk ~2.5s, ust-orta, iri) + sona etkilesim sorusu.
    const cx = Math.round(W / 2);
    const ekstra = [];
    if (HOOK) {
      // Uzun hook (>18 harf) iki satira bolunur; yazi boyutu en uzun satira gore
      // kucultulur ki ekran kenarlarina tasmasin.
      const H_UP = HOOK.toUpperCase();
      const w = H_UP.split(/\s+/);
      let satirlar = [H_UP];
      if (H_UP.length > 18 && w.length > 1) {
        let en = null;
        for (let i = 1; i < w.length; i++) {
          const a = w.slice(0, i).join(" "), b = w.slice(i).join(" ");
          const m = Math.max(a.length, b.length);
          if (!en || m < en.m) en = { a, b, m };
        }
        satirlar = [en.a, en.b];
      }
      const fs = Math.round(DEN.sigdir(satirlar.join("\\N"), W * 0.078, W) * k), bord = Math.max(5, Math.round(W * 0.006));
      const y = Math.round(H * 0.40);
      const hookSon = Math.min(2.7, VODUR * 0.4);
      // Kanca ILK KAREDE ekranda (fade-in yok): Shorts akisinda kaydirma karari ilk karede verilir.
      ekstra.push(`Dialogue: 0,${assTime(0)},${assTime(hookSon)},Pop,,0,0,0,,` +
        `{\\an5\\pos(${cx},${y})\\fs${fs}\\bord${bord}\\shad3\\fad(0,220)}${satirlar.map(assKacis).join("\\N")}`);
      // Seri etiketi ("FAILURE FILE #13") kancanin hemen ustunde, kanal turuncusuyla:
      // numarali, tekrar eden bir format abone olmak icin bir sebeptir (core/series.js).
      if (SERI) {
        const sfs = Math.round(W * 0.040 * k);
        const sy = Math.round(y - (satirlar.length * fs) / 2 - sfs * 0.9);
        ekstra.push(`Dialogue: 0,${assTime(0)},${assTime(hookSon)},Pop,,0,0,0,,` +
          `{\\an5\\pos(${cx},${sy})\\fs${sfs}\\bord${Math.max(3, bord - 2)}\\shad2\\1c&H3687D8&\\fad(0,220)}${assKacis(SERI)}`);
      }
    }
    // Tarih/yer damgasi (yalnizca belirli bir olay/vaka ise) — baglam sahnesinde
    const v = konu.vaka || {};
    if (v.tip === "vaka" && v.yil) {
      // Once baglam sahneleri, sonra diger sahneler: kancadan sonra ve panelle cakismayan ilk pencere
      const sira = [...planlar.map((p, i) => i).filter((i) => planlar[i].rol === "context"), ...planlar.map((p, i) => i)];
      const bi = sira.find((i) => i >= 1 && zamanlar[i].bas >= 2.7 && !katmanlaCakisir(zamanlar[i].bas + 0.1, Math.min(zamanlar[i].son, zamanlar[i].bas + 3.2)));
      const z = zamanlar[bi == null ? 0 : bi];
      const son = Math.min(z.son, z.bas + 3.2);
      if (bi != null && k === 1) damgaPencere = { bas: +(z.bas + 0.1).toFixed(2), son: +son.toFixed(2) };
      // kisa ad yili zaten iceriyorsa ("Vesuvius 1944") yil tekrar yazilmaz
      const kisa = (v.kisa || "").toUpperCase();
      const dmg = kisa.includes(String(v.yil)) ? kisa : `${v.yil} · ${kisa}`;
      if (bi != null) ekstra.push(`Dialogue: 0,${assTime(z.bas + 0.1)},${assTime(son)},Pop,,0,0,0,,` +
        `{\\an7\\pos(64,${Math.round(H * 0.105)})\\fs${Math.round(DEN.sigdir(dmg, W * 0.036, W, 0.8) * k)}\\bord3\\shad2\\1c&H41A4D9&\\fad(180,180)}` +
        assKacis(dmg));
    }
    // Sentetik (AI) sahne etiketi — gizlenmez (config/growth.json disclosure)
    const ds = ayar().disclosure;
    if (ds.enabled) sahneler.forEach((sh, i) => {
      if (!sh.sentetik) return;
      const z = zamanlar[i];
      ekstra.push(`Dialogue: 1,${assTime(z.bas)},${assTime(z.son)},Pop,,0,0,0,,` +
        `{\\an9\\pos(${W - 50},${Math.round(H * 0.105)})\\fs${Math.round(W * 0.028 * k)}\\bord2\\shad0}` + assKacis(ds.label || "RECONSTRUCTION"));
    });
    if (SORU) {
      const fs = Math.round(DEN.sigdir(SORU, W * 0.040, W, 0.84) * k), bord = Math.max(3, Math.round(W * 0.004));
      const y = Math.round(H * 0.30);
      const bas = Math.max(0, VODUR - 2.8);
      ekstra.push(`Dialogue: 0,${assTime(bas)},${assTime(VODUR)},Pop,,0,0,0,,` +
        `{\\an5\\pos(${cx},${y})\\fs${fs}\\bord${bord}\\1c&H41A4D9&\\fad(200,160)}${assKacis(SORU)}`);
    }
    return ekstra.join("\n") + (ekstra.length ? "\n" : "");
  })();
  const assPath = path.join(TMP, "cap.ass");
  // YAYIN ONCESI DENETIM 1: yazilar gercek fontla render edilip kenar tasmasi olculur.
  // Tasma varsa tum yazilar %10 kucultulup tekrar denenir (en fazla 3 kez).
  let olcek = 1, tasma = [];
  for (let deneme = 0; deneme < 4; deneme++) {
    fs.writeFileSync(assPath, assKur(olcek));
    try { tasma = DEN.metinTasmasi(assPath, VODUR + 0.5, W, H); }
    catch (e) { console.log("  (tasma denetimi calismadi: " + String(e.message).slice(0, 120) + ")"); tasma = null; break; }
    if (!tasma.length) break;
    console.log(`  ⚠ yazi tasmasi (${tasma.length} kare, ornek t=${tasma[0].t}s ${tasma[0].taraf}) — yazilar kucultuluyor`);
    olcek = +(olcek * 0.9).toFixed(3);
  }

  // --- 5) handle filigrani + altyazi + ses (loudnorm konusma + ducking'li muzik) ---
  const cikti = path.join(VID, IS + ".mp4");
  const hy = Math.round(H * 0.052);
  // Muhendislik ust katmani: ilk teknik/kesif sahnesinde ~3 sn FAILURE CHAIN paneli
  // (kanca ve kapanis sorusu pencereleriyle cakismaz).
  // Muhendislik katmani: FAILURE CHAIN adim adim acilir; her asama bir kutu ekler,
  // en yeni adim kirmizi vurgulanir.
  let ustKatman = null;
  if (zincirPencere) {
    try {
      const pngs = require("./engineering-visuals").kisaZincirAsamalari(konu, TMP);
      if (pngs.length && pngs.length === zincirPencere.asamalar.length) {
        ustKatman = { pngs, a: katmanA, b: katmanB, asamalar: zincirPencere.asamalar };
        fs.writeFileSync(path.join(VID, "muhendislik-katmani.json"), JSON.stringify({ tip: "failure-chain", animasyon: "adim-adim", sahne: katmanSahne, bas: katmanA, son: katmanB, asamalar: zincirPencere.asamalar }, null, 2));
      }
    } catch (e) { console.log("  (muhendislik katmani atlandi: " + e.message.slice(0, 120) + ")"); }
  }
  const handleF = `drawtext=fontfile='${DFONT}':text='${HANDLE.replace(/'/g, "")}':fontcolor=white@0.72:` +
    `fontsize=${Math.round(W * 0.030)}:x=(w-tw)/2:y=${hy}:shadowcolor=black@0.5:shadowx=0:shadowy=2`;
  const altyaziF = `subtitles='${assPath.replace(/:/g, "\\:")}',format=yuv420p[v]`;
  const zincirFiltre = () => {
    const son = ustKatman.pngs.length - 1;
    const parcalar = [`[0:v]${handleF}[b0]`];
    ustKatman.asamalar.forEach((st, i) => {
      let f = `[${2 + i}:v]format=rgba`;
      if (i === 0) f += `,fade=t=in:st=${st.a.toFixed(2)}:d=0.25:alpha=1`;
      if (i === son) f += `,fade=t=out:st=${(st.b - 0.3).toFixed(2)}:d=0.3:alpha=1`;
      parcalar.push(`${f}[ov${i}]`);
      parcalar.push(`[b${i}][ov${i}]overlay=0:0:enable='between(t,${st.a.toFixed(2)},${st.b.toFixed(2)})':shortest=1:eof_action=pass[b${i + 1}]`);
    });
    return parcalar.join(";") + `;[b${son + 1}]${altyaziF}`;
  };
  const vFilter = ustKatman ? zincirFiltre() : `[0:v]${handleF},${altyaziF}`;
  // SES AYRI ADIMDA karistirilir: ducking zinciri (sidechaincompress + amix) video
  // filtreleriyle ayni grafikte calisinca ffmpeg is siralamasi yuzunden bazi videolarda
  // erken bitiyordu (olculen: goruntu 31.5 sn, ses 19.3 sn). Ayri adimda sure tamdir.
  const karisim = path.join(TMP, "mix.wav");
  run(["-hide_banner", "-loglevel", "error", "-i", vo, "-i", bed, "-filter_complex",
    `[0:a]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000,apad,asplit=2[vo1][vo2];` +
    `[1:a]aresample=48000,volume=1.0[mus];` +
    `[mus][vo1]sidechaincompress=threshold=0.035:ratio=6:attack=6:release=340[duck];` +
    // Son karisim YouTube seviyesine (-14 LUFS) getirilir: olculen eski cikti -22 LUFS'ti ve
    // YouTube kisik videolari yukseltmedigi icin akista digerlerinden kisik caliyordu.
    `[duck][vo2]amix=inputs=2:duration=first:dropout_transition=0,alimiter=limit=0.95,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[a]`,
    "-map", "[a]", "-t", TOPLAM.toFixed(3), "-ar", "48000", "-y", karisim]);
  const karisimSure = sure(karisim);
  if (Math.abs(karisimSure - TOPLAM) > 0.3) throw new Error(`ses karisimi eksik: ${karisimSure.toFixed(2)} sn / goruntu ${TOPLAM.toFixed(2)} sn`);
  run(["-hide_banner", "-loglevel", "error", "-i", vid, "-i", karisim,
    // PNG katmani videoyla AYNI kare hizinda (30) beslenir; aksi halde (varsayilan 25 fps)
    // bazi kaynak kombinasyonlarinda cikti suresi sisiyordu (31 sn -> 57 sn).
    ...(ustKatman ? ustKatman.pngs.flatMap((png) => ["-loop", "1", "-framerate", String(FPS), "-t", TOPLAM.toFixed(2), "-i", png]) : []),
    "-filter_complex", vFilter,
    "-map", "[v]", "-map", "1:a", "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", "-y", cikti]);

  // YAYIN ONCESI DENETIM 2: siyah kare / donmus goruntu + onizleme gorseli.
  const denetim = { tarih: new Date().toISOString(), damga: damgaPencere, katman: ustKatman ? { bas: +ustKatman.a.toFixed(2), son: +ustKatman.b.toFixed(2), asama: ustKatman.pngs.length } : null,
    yaziOlcegi: olcek, yaziTasmasi: tasma === null ? "olculemedi" : tasma.length,
    tasmaOrnek: tasma && tasma.length ? tasma.slice(0, 5) : [], ton: TON ? "stok-belgesel" : "yok",
    captionBurned: true, captionEvents: events.length,
    captionMaxWords: events.reduce((max, event) => Math.max(max, event.txt.split(/\s+/).length), 0),
    captionMaxLines: 1, captionSafeZoneMeasured: tasma !== null };
  try { Object.assign(denetim, DEN.videoDenetim(cikti)); } catch (e) { denetim.videoDenetimHata = String(e.message).slice(0, 160); }
  try { DEN.onizleme(cikti, path.join(VID, "onizleme.jpg"), sure(cikti)); denetim.onizleme = "Videos/onizleme.jpg"; }
  catch (e) { denetim.onizlemeHata = String(e.message).slice(0, 160); }
  fs.writeFileSync(path.join(VID, "denetim.json"), JSON.stringify(denetim, null, 2));
  console.log(`  denetim: yazi tasmasi ${denetim.yaziTasmasi} · siyah ${denetim.siyahToplam ?? "?"} sn · en uzun donuk ${denetim.donukEnUzun ?? "?"} sn`);

  try { K.defterYaz(IS, { muzik: mp, render: { sure: sure(cikti), tarih: new Date().toISOString(), ustKatman: !!ustKatman } }); }
  catch (e) { console.log("  (kaynak defteri yazilamadi: " + e.message + ")"); }
  // Provenance manifest from the source ledger's credit lines (licence + URL
  // per asset) plus the generated voice, music and graphics.
  try {
    const P = require("./lib/provenance");
    const krediler = ((K.defter() || {})[IS] || {}).krediler || [];
    P.write(path.dirname(K.paketYolu(IS, "provenance.json")), P.build({ channel: "failure-reconstructed", slug: IS,
      extra: krediler.map(P.fromCreditLine), voiceProvider: "Microsoft Edge neural TTS (" + SES + ")", music: true }));
  } catch (e) { console.log("  (provenance yazilamadi: " + e.message.slice(0, 120) + ")"); }
  console.log(`✓ Bitti: ${path.relative(KOK, cikti)}  (${sure(cikti).toFixed(1)}s, ${W}x${H}${ustKatman ? ", failure-chain katmani" : ""})`);
  if (!process.env.SHORTS_TMP_SAKLA) { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} } else console.log("  (ara dosyalar: " + TMP + ")");
})().catch(e => { console.error("\nHata: " + e.message); try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {} process.exit(1); });
