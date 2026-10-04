// GORSEL DENETIM — yayindan once videonun GORUNTUSUNU olcer (tahmin degil).
//
//  metinTasmasi : ekrandaki tum yazilar (ASS) gercek fontla SIYAH bir katmana
//                 render edilir; ekranin sol/sag kenar seritlerinde yazi pikseli
//                 var mi diye her karede olculur (signalstats YMAX). Taşma = yazi
//                 kenara degiyor/kesiliyor.
//  videoDenetim : siyah kare (blackdetect) ve donmus goruntu (freezedetect).
//  onizleme     : videodan esit aralikli 8 karelik tek bir onizleme gorseli
//                 (bildirimde gosterilir; telefondan tek bakista kontrol).
//
// Hepsi yerel ffmpeg; ek servis yok.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");

const FF = () => require("../ff-yol").ffmpeg;
const kacisYol = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");

// Yazinin ekrana sigmasi icin font boyutu. Olculen (libass, buyuk harf): DejaVu Sans
// Bold ~0.52 em, Arial Black ~0.49 em, genis harflerde (M/W) ~0.72. 0.58 tipik metni
// guvenle sigdirir; kalan istisnalari metinTasmasi() GERCEK olcumle yakalar.
function sigdir(metin, fsMax, W, pay = 0.86, oran = 0.58) {
  const uz = Math.max(1, ...String(metin).split(/\\N|\n/).map((s) => s.length));
  return Math.round(Math.min(fsMax, (W * pay) / (uz * oran)));
}

// ASS dosyasini siyah zemine render edip kenar seritlerinde yazi pikseli arar.
// Donus: [{ t, taraf }] — bos dizi = tasma yok.
function metinTasmasi(assPath, sureSn, W, H, kenar = 24, fps = 10) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tasma-"));
  const sonuc = [];
  try {
    for (const [taraf, x] of [["left", 0], ["right", W - kenar]]) {
      const out = path.join(tmp, taraf + ".txt");
      cp.execFileSync(FF(), ["-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=c=black:s=${W}x${H}:d=${sureSn.toFixed(2)}:r=${fps}`,
        "-vf", `subtitles='${kacisYol(assPath)}',crop=${kenar}:${H}:${x}:0,signalstats,metadata=mode=print:key=lavfi.signalstats.YMAX:file='${kacisYol(out)}'`,
        "-f", "null", "-"], { stdio: ["ignore", "ignore", "pipe"] });
      const satir = fs.existsSync(out) ? fs.readFileSync(out, "utf8").split(/\r?\n/) : [];
      let t = null;
      for (const l of satir) {
        const m = l.match(/pts_time:([\d.]+)/);
        if (m) { t = +m[1]; continue; }
        const y = l.match(/YMAX=(\d+)/);
        if (y && +y[1] > 60) sonuc.push({ t, taraf });
      }
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  return sonuc;
}

// Ses ve goruntu akislarinin sureleri (ffprobe) — uyumsuzluk = bozuk birlestirme
function akisSureleri(video) {
  const FP = require("../ff-yol").ffprobe;
  const j = JSON.parse(cp.execFileSync(FP, ["-v", "error", "-show_entries", "stream=codec_type,duration", "-of", "json", video]).toString());
  const s = (t) => { const x = (j.streams || []).find((a) => a.codec_type === t); return x ? +x.duration : null; };
  return { video: s("video"), ses: s("audio") };
}

function videoDenetim(video) {
  const ak = akisSureleri(video);
  const r = cp.spawnSync(FF(), ["-hide_banner", "-nostats", "-i", video, "-an",
    "-vf", "blackdetect=d=0.4:pic_th=0.97,freezedetect=n=0.001:d=2.5", "-f", "null", "-"], { encoding: "utf8" });
  const err = r.stderr || "";
  const siyah = [...err.matchAll(/black_start:([\d.]+)\s+black_end:([\d.]+)\s+black_duration:([\d.]+)/g)].map((m) => ({ bas: +m[1], sure: +m[3] }));
  const don = [...err.matchAll(/freeze_duration:\s*([\d.]+)/g)].map((m) => +m[1]);
  return { videoSure: ak.video, sesSure: ak.ses, sureFarki: ak.video != null && ak.ses != null ? +Math.abs(ak.video - ak.ses).toFixed(2) : null,
    siyahKare: siyah, siyahToplam: +siyah.reduce((a, s) => a + s.sure, 0).toFixed(2), donukGoruntu: don, donukEnUzun: don.length ? Math.max(...don) : 0 };
}

function onizleme(video, cikti, sureSn, kare = 8) {
  fs.mkdirSync(path.dirname(cikti), { recursive: true });
  cp.execFileSync(FF(), ["-hide_banner", "-loglevel", "error", "-y", "-i", video,
    "-vf", `fps=${(kare / Math.max(1, sureSn)).toFixed(5)},scale=240:-2,tile=${kare / 2}x2:padding=4:color=0x0B1522`,
    "-frames:v", "1", "-q:v", "4", cikti], { stdio: ["ignore", "ignore", "pipe"] });
  return cikti;
}

module.exports = { sigdir, metinTasmasi, videoDenetim, akisSureleri, onizleme };
