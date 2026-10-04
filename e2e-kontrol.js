// E2E KONTROL — bir konunun uretimden sonra YUKLEMEYE HAZIR oldugunu uctan uca dogrular.
//
// shorts-sira.js <slug> (yuklemesiz) calistiktan sonra kosulur; YouTube'a hicbir sey
// gondermez. Her maddeyi olcer, hepsi gecmezse cikis kodu 1:
//   video     dosya var · 1080x1920 · 15-60 sn · ses akisi var · A/V farki <= 0.5 sn
//   ses       entegre yukseklik -14 LUFS ± 2 (YouTube seviyesi)
//   denetim   yazi tasmasi 0 · siyah kare yok · donuk goruntu yok · onizleme gorseli var
//   kalite    final kapi PUBLISH (REVIEW/BLOCK yuklenmez) · tutma kurallari (lib/tutunma)
//   paket     aciklama: <=5000 bayt, sentetik ses notu, kaynak satiri, <=5 hashtag, bos
//             satir/"undefined" yok · etiketler · sabit yorum metni · baslik <=100
//   yukleme   youtube-yukle.js --dogrula: meta dogrulama gecer, publishAt slotu gelecekte
//   bildirim  issue metni eksiksiz (undefined/NaN yok, onizleme ve Studio baglantisi var)
//
// Kullanim: node e2e-kontrol.js <slug>
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const FF = require("./ff-yol.js");
const K = require("./lib/kutuphane");
const { KOK, jsonOku } = require("./lib/ortak");
const { ayar } = require("./lib/ayar");

const slug = process.argv[2];
if (!slug) { console.error("Kullanim: node e2e-kontrol.js <slug>"); process.exit(1); }
const sonuc = [];
const kontrol = (grup, ad, gecti, detay = "") => sonuc.push({ grup, ad, gecti: !!gecti, detay });

const VID = path.join(KOK, "uretim", slug, "Videos", slug + ".mp4");
const paket = (f) => K.paketYolu(slug, f);

// ---- video ----
let prob = null;
if (fs.existsSync(VID)) {
  prob = JSON.parse(cp.execFileSync(FF.ffprobe, ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", VID]).toString());
}
kontrol("video", "dosya var", !!prob, VID);
if (prob) {
  const v = prob.streams.find((s) => s.codec_type === "video"), a = prob.streams.find((s) => s.codec_type === "audio");
  const sure = +prob.format.duration;
  kontrol("video", "1080x1920", v && v.width === 1080 && v.height === 1920, v ? `${v.width}x${v.height}` : "video akisi yok");
  kontrol("video", "sure 15-60 sn", sure >= 15 && sure <= 60, sure.toFixed(1) + " sn");
  kontrol("video", "ses akisi var", !!a);
  kontrol("video", "A/V farki <= 0.5 sn", a && v && Math.abs(+a.duration - +v.duration) <= 0.5, a && v ? `${(+v.duration).toFixed(2)} / ${(+a.duration).toFixed(2)}` : "");
  const ln = cp.spawnSync(FF.ffmpeg, ["-hide_banner", "-nostats", "-i", VID, "-af", "ebur128", "-f", "null", "-"], { encoding: "utf8" }).stderr || "";
  const I = +((ln.match(/I:\s+(-?[\d.]+) LUFS/g) || []).pop() || "").replace(/[^-\d.]/g, "");
  kontrol("ses", "yukseklik -14 ± 2 LUFS", Number.isFinite(I) && Math.abs(I + 14) <= 2, Number.isFinite(I) ? I + " LUFS" : "olculemedi");
}

// ---- denetim ----
const den = jsonOku(paket("denetim.json"), null);
kontrol("denetim", "denetim.json var", !!den);
if (den) {
  kontrol("denetim", "yazi tasmasi yok", den.yaziTasmasi === 0, String(den.yaziTasmasi));
  kontrol("denetim", "siyah kare yok", (den.siyahToplam || 0) <= 0.4, (den.siyahToplam || 0) + " sn");
  kontrol("denetim", "donuk goruntu yok", (den.donukEnUzun || 0) <= 4, (den.donukEnUzun || 0) + " sn");
  // Sol ustteki iki oge (tarih damgasi + FAILURE CHAIN paneli) ayni anda ekranda olmamali
  const d = den.damga, kt = den.katman;
  kontrol("denetim", "damga ile panel ust uste binmiyor", !(d && kt && d.bas < kt.son && d.son > kt.bas),
    d && kt ? `damga ${d.bas}-${d.son} sn, panel ${kt.bas}-${kt.son} sn` : "tek oge");
}
kontrol("denetim", "onizleme gorseli var", fs.existsSync(paket("onizleme.jpg")));

// ---- kalite ----
const kapi = jsonOku(paket("quality-gate.json"), null);
kontrol("kalite", "final kapi PUBLISH", kapi && kapi.asama === "final" && kapi.karar === "PUBLISH", kapi ? `${kapi.asama} ${kapi.karar} ${kapi.toplam}` : "rapor yok");
const konu = K.uretimKonusu(slug);
const tut = require("./lib/tutunma").denetle(konu);
kontrol("kalite", "tutma kurallari", !tut.length, tut.map((x) => x.mesaj).join("; "));

// ---- paket ----
const acik = fs.existsSync(paket("description.txt")) ? fs.readFileSync(paket("description.txt"), "utf8") : "";
kontrol("paket", "aciklama var", acik.length > 80);
kontrol("paket", "aciklama <= 5000 bayt", Buffer.byteLength(acik) <= 5000, Buffer.byteLength(acik) + " bayt");
kontrol("paket", "sentetik ses notu", acik.includes(ayar().disclosure.voiceNote));
kontrol("paket", "kaynak satiri", /Footage & sources:\n• /.test(acik));
kontrol("paket", "<= 5 hashtag", (acik.match(/#\w+/g) || []).length <= 5);
kontrol("paket", "undefined/null yok", !/undefined|null|NaN/.test(acik));
const etiket = jsonOku(paket("tags.json"), []);
kontrol("paket", "etiketler", Array.isArray(etiket) && etiket.length >= 3 && etiket.join(",").length <= 480, etiket.length + " etiket");
kontrol("paket", "sabit yorum metni", fs.existsSync(paket("pinned-comment.txt")) && fs.readFileSync(paket("pinned-comment.txt"), "utf8").trim().length > 20);

// ---- yukleme (kuru) ----
const y = cp.spawnSync("node", ["youtube-yukle.js", slug, "--dogrula"], { cwd: KOK, encoding: "utf8", env: { ...process.env } });
const ycikti = (y.stdout || "") + (y.stderr || "");
kontrol("yukleme", "meta dogrulama gecti", y.status === 0 && /Meta dogrulama: gecti/.test(ycikti), (ycikti.match(/Meta dogrulama: .*/) || [""])[0]);
const baslik = (ycikti.match(/Baslik\s+:\s+(.*)/) || [])[1] || "";
kontrol("yukleme", "baslik 1-100 karakter", baslik.length > 0 && [...baslik].length <= 100, baslik);
const sched = ayar().publishing.schedule;
if (sched.enabled && kapi && (sched.gates || []).includes(kapi.karar))
  kontrol("yukleme", "otomatik yayin saati planlandi", /otomatik Public: /.test(ycikti), (ycikti.match(/otomatik Public: .*/) || ["planlanmadi"])[0]);

// ---- bildirim ----
const m = require("./bildirim").videoMesaji({ slug, videoId: "e2eTEST0000", baslik: baslik || konu.baslik, kalite: kapi && kapi.karar,
  publishAt: require("./lib/zamanlama").sonrakiSlot(new Date(), sched.hourUTC, sched.minLeadHours).toISOString() });
kontrol("bildirim", "issue metni eksiksiz", !/undefined|NaN|\[object/.test(m.baslik + m.govde) && /onizleme\.jpg/.test(m.govde) && /studio\.youtube\.com/.test(m.govde));

// ---- rapor ----
let hata = 0;
for (const s of sonuc) { if (!s.gecti) hata++; console.log(`${s.gecti ? "✓" : "✗"} [${s.grup}] ${s.ad}${s.detay ? "  — " + s.detay : ""}`); }
console.log(`\n${slug}: ${sonuc.length - hata}/${sonuc.length} kontrol gecti` + (hata ? " — ✗ YUKLEMEYE HAZIR DEGIL" : " — ✓ yuklemeye hazir"));
process.exit(hata ? 1 : 0);
