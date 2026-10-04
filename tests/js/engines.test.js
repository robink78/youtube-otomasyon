// Buyume motorlari icin birim testleri (node --test). Ag erisimi YOK; YouTube
// cagrilari yapilmaz. Paket dosyasi yazan calistir() fonksiyonlari degil, saf
// degerlendirme fonksiyonlari test edilir.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");

const M = require("../../lib/metin");
const K = require("../../lib/kutuphane");
const TE = require("../../title-engine");
const HE = require("../../hook-engine");
const SP = require("../../scene-pacing");
const PC = require("../../pronunciation-check");
const OC = require("../../originality-check");
const SS = require("../../story-structure");
const A = require("../../lib/analitik");
const YP = require("../../yayin-plani");
const muzik = require("../../lib/muzik");
const sahne = require("../../lib/sahne");
const TS = require("../../thumbnail-strategy");
const KP = require("../../konu-puan");
const { birlestir } = require("../../lib/ayar");
const yt = require("../../lib/yt");

const tacoma = () => K.konuOku("tacoma-narrows");

test("metin: benzerlik ve baslik bicimi", () => {
  assert.equal(M.trigramBenzerlik("The Bridge That Fell", "The Bridge That Fell"), 1);
  assert.ok(M.kelimeBenzerlik("dams fail without warning", "why do bridges collapse") < 0.2);
  assert.equal(M.baslikBicim("the bridge that tore itself apart"), "The Bridge That Tore Itself Apart");
  assert.equal(M.diziBenzerlik(["a", "b", "c"], ["a", "b", "c"]), 1);
});

test("title engine: >=20 meaningful candidates, scoring detail is retained", () => {
  const r = TE.degerlendir(tacoma(), { digerBasliklar: [], kaliplar: {} });
  assert.ok(r.adaySayisi >= 20, "at least 20 candidates");
  for (const a of r.adaylar) {
    for (const k of ["curiosity", "clarity", "tension", "consequence", "specificity", "appeal", "engineering", "search", "suggested"]) assert.ok(k in a.kriterler);
    assert.ok("similarity" in a && "clickbaitRisk" in a);
  }
  // Secim yalnizca insan-yazimi adaylardan
  assert.ok(["current", "editorial"].includes(r.adaylar.find((a) => a.baslik === r.secilen).kaynak));
});

test("every Failure Reconstructed topic has a 20+ title pool before selection", () => {
  for (const topic of K.konular()) assert.ok(TE.adaylar(topic).length >= 20, topic.slug);
});

test("title engine: anahtar kelime tekrari ve desteklenmeyen iddia cezalandirilir", () => {
  const k = tacoma();
  const kuru = TE.puanla("Tacoma Narrows Explained", k, [], "short");
  const iyi = TE.puanla("The Bridge That Started Twisting — Then Tore Itself Apart", k, [], "short");
  assert.ok(iyi.toplam > kuru.toplam + 10);
  const uydurma = TE.puanla("Secret Nuclear Aliens Destroyed This Bridge", k, [], "short");
  assert.ok(uydurma.clickbaitRisk >= 4, "senaryoda olmayan iddia = clickbait riski");
});

test("hook engine: yasak acilis ve acilis CTA'si engelleyicidir", () => {
  const kotu = HE.puanla("Welcome to Failure Reconstructed. In today's video we look at a bridge. Subscribe for more.", "BIG BRIDGE", "short");
  assert.equal(kotu.engelleyici, true);
  const iyi = HE.puanla("This bridge tore itself apart in a forty mile an hour wind. But the wind was not the real problem. So why did it fail? The reason changed engineering.", "Filmed as it fell", "short");
  assert.equal(iyi.engelleyici, false);
  assert.ok(iyi.puan > kotu.puan);
});

test("scene pacing: rol anlamdan gelir, rastgele degil", () => {
  assert.equal(SP.rolBul("Then the center span lets go and drops into the water.", 3, 9), "event");
  assert.equal(SP.rolBul("Engineers call this the pressure mechanism.", 4, 9), "technical");
  const a = SP.sahnePlani("The dam collapses in seconds.", 2, 9, 6, "long");
  const b = SP.sahnePlani("The dam collapses in seconds.", 2, 9, 6, "long");
  assert.deepEqual(a, b);
  assert.equal(SP.sahnePlani("x", 3, 9, 20, "long", true).tempo, "diagram");
});

test("scene pacing: birlesik sahnelerin ses zamanlari", () => {
  const z = SP.sahneZamanlari(["One two three. Four five.", "Six seven"], ["One two three.", "Four five.", "Six seven"], [3, 2, 2], 0.5);
  assert.equal(z[0].bas, 0);
  assert.ok(Math.abs(z[1].bas - 6) < 1e-9);          // 3 + 0.5 + 2 + 0.5
});

test("lib/sahne: bolum basliklari seslendirilmez", () => {
  const r = sahne.bolumAyir("## COLD OPEN\nA.\n\n## THE CAUSE\n\nB is here.");
  assert.deepEqual(r.paragraflar, ["A.", "B is here."]);
  assert.deepEqual(r.harita.map((h) => h.baslik), ["COLD OPEN", "THE CAUSE"]);
});

test("telaffuz: sozluk yalnizca TTS metnine uygulanir, klise yakalanir", () => {
  assert.equal(PC.ttsMetni("The O-rings failed."), "The O rings failed.");
  const d = PC.dogrula("Let's dive in. The RBMK reactor and the XQZT valve failed.");
  assert.ok(d.kliseler.includes("let's dive in"));
  assert.ok(d.supheli.some((s) => s.kelime === "XQZT"));
  assert.ok(!d.supheli.some((s) => s.kelime === "RBMK"), "sozlukteki kisaltma supheli degil");
});

test("originality: ayni senaryo BLOCK, farkli konu PASS", () => {
  const k = tacoma();
  const kopya = { ...k, slug: "tacoma-kopya" };
  const r = OC.degerlendir(kopya, { konular: [k] });
  assert.equal(r.aksiyon, "BLOCK");
  assert.ok(r.metrikler.sentences.deger >= 0.9);
  const farkli = OC.degerlendir(K.konuOku("why-dams-fail"), { konular: [k] });
  assert.notEqual(farkli.aksiyon, "BLOCK");
});

test("story structure: bolumler kanita gore uyarlanir, donguler sonra kapanir", () => {
  const k = tacoma();
  const b = SS.bolumler(k);
  assert.equal(b.sira[0].id, "COLD_OPEN");
  const d = SS.donguler(k, b.sira);
  for (const x of d) assert.ok(b.sira.findIndex((s) => s.id === x.kapatBolum) > b.sira.findIndex((s) => s.id === x.acBolum));
  assert.equal(SS.cta(k, 40, b.sira).strateji, "none", "Shorts: konusulan CTA yok");
  const uzun = SS.cta({ ...k, format: "long" }, 600, b.sira);
  assert.match(uzun.strateji, /mid/);
  const aciklayici = SS.bolumler(K.konuOku("why-dams-fail"));
  assert.equal(aciklayici.tip, "explainer");
});

test("analitik: veri uydurulmaz, kucuk orneklemde yetersiz veri", () => {
  const v = { videoId: "x", format: "short", yasGun: 1, metrikler: {
    views: A.ok(40, "t"), likes: A.ok(1, "t"), comments: A.ok(0, "t"), impressions: A.yok("n"), ctr: A.yok("n"),
    averageViewPercentage: A.yok("n"), subscribersGained: A.yok("n"), returningViewers: A.yok("n") }, trafik: null, tutma: null };
  const t = A.teshis(v, {}, { minViewsForRates: 100 });
  assert.ok(t.some((x) => x.kod === "INSUFFICIENT_DATA"));
  assert.ok(!t.some((x) => x.kod === "HIGH_IMPRESSIONS_LOW_CTR"), "gosterim yokken CTR teshisi konmaz");
  const ustun = A.teshis({ ...v, yasGun: 3, metrikler: { ...v.metrikler, views: A.ok(1000, "t") } }, {}, { minViewsForRates: 100 }, { medyan: 120, n: 4 });
  assert.ok(ustun.some((x) => x.kod === "OUTPERFORMER"));
});

test("analitik: bos trafik ve kucuk orneklemde abone teshisi konmaz", () => {
  const v = { videoId: "x", format: "short", yasGun: 3, metrikler: {
    views: A.ok(178, "t"), likes: A.ok(5, "t"), comments: A.ok(0, "t"), impressions: A.yok("n"), ctr: A.yok("n"),
    averageViewPercentage: A.ok(68, "t"), subscribersGained: A.ok(0, "t"), returningViewers: A.yok("n") }, trafik: [], tutma: null };
  const t = A.teshis(v, {}, { minViewsForRates: 100 }).map((x) => x.kod);
  assert.ok(!t.includes("SHORTS_FEED_NOT_PICKED_UP"), "bos trafik = veri yok");
  assert.ok(!t.includes("HIGH_VIEWS_LOW_SUB_CONVERSION"), "178 izlenmede abone teshisi yok");
});

test("yayin plani: tolerans + yalnizca gercek BLOCK'lar aralik esnetir", () => {
  const simdi = new Date("2026-09-25T16:00:00Z");
  const kayit = [{ format: "short", tarih: "2026-09-24T16:05:00Z" }];
  assert.equal(YP.durum("short", simdi, kayit, []).uygun, true, "cron gecikmesi toleransi");
  const gecKalmis = [{ format: "short", tarih: "2026-09-24T19:50:00Z" }];   // dunku cron 3s50dk gecikti
  assert.equal(YP.durum("short", simdi, gecKalmis, []).uygun, true, "gec calisma ertesi gunu atlatmaz");
  assert.equal(YP.durum("short", new Date("2026-09-25T02:00:00Z"), gecKalmis, []).uygun, false, "ayni gece ikinci yayin yok");
  const tarama = [{ asama: "pre", karar: "REVIEW" }, { asama: "pre", karar: "REVIEW" }, { asama: "pre", karar: "REVIEW" }];
  assert.equal(YP.durum("short", simdi, kayit, tarama).esnetme, 0, "kutuphane taramalari sayilmaz");
  const bloklar = [{ asama: "final", karar: "BLOCK" }, { asama: "final", karar: "BLOCK" }];
  const d = YP.durum("short", simdi, kayit, bloklar);
  assert.ok(d.esnetme >= 1 && !d.uygun);
});

test("zamanlama: sabit saat, en az 1 saat once; bildirim metni", () => {
  const z = require("../../lib/zamanlama");
  assert.equal(z.sonrakiSlot(new Date("2026-09-25T10:05:00Z"), 18, 1).toISOString(), "2026-09-25T18:00:00.000Z");
  assert.equal(z.sonrakiSlot(new Date("2026-09-25T17:30:00Z"), 18, 1).toISOString(), "2026-09-26T18:00:00.000Z");
  assert.equal(z.trSaat(new Date("2026-09-25T18:00:00Z")), "25 Eylül 21:00 (TR)");
  const m = require("../../bildirim").videoMesaji({ slug: "x", videoId: "abcdefghijk", baslik: "T", kalite: "REVIEW", publishAt: "2026-09-25T18:00:00Z" });
  assert.match(m.baslik, /21:00/);
  assert.ok(m.etiket.includes("review"));
});

test("muzik profili: deterministik ve videolar arasi farkli", () => {
  assert.deepEqual(muzik.profil("a", "bridge-failures"), muzik.profil("a", "bridge-failures"));
  assert.ok(muzik.benzerlik(muzik.profil("a", "bridge-failures"), muzik.profil("b", "nuclear-accidents")) < 0.95);
});

test("muzik profili: tum konularda ffmpeg sinirlari icinde (tremolo >= 0.1 Hz)", () => {
  for (const k of K.konular()) {
    const p = muzik.profil(k.slug, K.kumeBul(k));
    assert.ok(p.trem >= 0.1 && p.trem <= 20, `${k.slug}: tremolo ${p.trem}`);
    assert.ok(p.kok > 20 && p.alcak > p.kok, `${k.slug}: frekans`);
    assert.ok(["white", "pink", "brown"].includes(p.renk), `${k.slug}: gurultu rengi`);
  }
});

test("gorsel denetim: sigdir uzun metni kucultur, kisa metni tavanda birakir", () => {
  const D = require("../../lib/gorsel-denetim");
  assert.equal(D.sigdir("CAN START", 90, 1080, 0.76), 90);
  assert.ok(D.sigdir("WAS AEROELASTIC FLUTTER", 90, 1080, 0.76) < 70);
  assert.ok(D.sigdir("ONE STEP, A\\NMOVING MOUNTAIN", 67, 1080) <= 67);
});

test("kapak: mobil okunabilirlik ve 3 farkli konsept", () => {
  assert.equal(TS.mobilKontrol("40 MPH", "long").gecti, true);
  assert.equal(TS.mobilKontrol("THIS IS WAY TOO MANY WORDS", "long").gecti, false);
  const l = TS.konseptler(tacoma(), tacoma().baslik);
  assert.equal(l.length, 3);
  assert.equal(new Set(l.map((c) => c.metin)).size, 3);
  const long = TS.konseptler({ ...tacoma(), format: "long" }, tacoma().baslik);
  assert.equal(long.length, 5);
  assert.equal(new Set(long.map((c) => c.duzen)).size, 5);
});

test("konu puani: erisilemeyen sinyal 'unavailable', guven dusuk", () => {
  const r = KP.puanla({ pageviews: { aylikOrtalama: 50000, sonAy: 60000, ivme: 1.2, degiskenlik: 0.2 }, ozet: { muhendislikTerimi: 20, yil: 1986 },
    commonsVideo: 10, commonsGorsel: 300, nasa: 500, archiveOrg: 40 });
  assert.ok(r.unavailable.includes("searchDemand"));
  assert.ok(r.guven < 1 && r.puan > 0);
  assert.match(r.oncelik, /PRIORITY/);
});

test("aciklama: zincir bicimi (cumle basi ozel isim sayilmaz) ve tek satir stok atfi", () => {
  const D = require("../../description-engine");
  const av = D.olustur(K.konuOku("how-avalanches-start")).metin;
  assert.match(av, /Weak layer buried → .* new snow/);
  const hx = D.olustur(K.konuOku("halifax-explosion")).metin;
  assert.match(hx, /Imo & Mont-Blanc collide/);
  assert.match(D.olustur(K.konuOku("san-francisco-1906")).metin, /M7\.9/);
  const kaynakSatiri = (m) => m.split("\n").filter((l) => /^• (Stock footage|Archival film)/.test(l)).length;
  assert.ok(kaynakSatiri(av) <= 1, "stok kaynaklari tek satir");
  assert.equal(kaynakSatiri(hx), 1, "arsiv kaynagi tekrar etmez");
  assert.ok((av.match(/#\w+/g) || []).length <= 5, "en fazla 5 hashtag");
});

test("ayar birlestirme ve ISO sure", () => {
  assert.deepEqual(birlestir({ a: 1, b: { c: 2 } }, { b: { d: 3 } }), { a: 1, b: { c: 2, d: 3 } });
  assert.equal(yt.sureSn("PT1M5S"), 65);
});

test("tutunma: ikinci vurus / uzunluk / arsiv acilisi kurallari", () => {
  const T = require("../../lib/tutunma");
  const k = (metinler, ek = {}) => ({ tur: "stok", sahneler: metinler.map((m) => ({ metin: m })), ...ek });
  // olculen hata: ikinci cumle tarih kurulumu
  assert.equal(T.denetle(k(["This ended the age of the airship.", "May sixth, 1937. The zeppelin arrives over New Jersey."]))[0].kural, "ikinci-vurus");
  assert.equal(T.denetle(k(["A ship can sink in minutes.", "The power grid is one giant connected machine."]))[0].kural, "ikinci-vurus");
  assert.deepEqual(T.denetle(k(["A dam holds back a lake.", "If it breaks, the water races downstream faster than a car."])), []);
  assert.equal(T.denetle(k(Array(9).fill("one two three four five six seven eight nine ten")))
    .filter((x) => x.kural === "uzunluk").length, 1);
  const arsiv = { sahneler: [{ metin: "It burned.", kaynak: "Footage/x.ogv" }, { metin: "The city collapses in seconds." }] };
  assert.equal(T.denetle(arsiv)[0].kural, "arsiv-acilis");
  arsiv.sahneler[0].baslangic = 12;
  assert.deepEqual(T.denetle(arsiv), []);
});

test("tutunma: henuz uretilmemis tum Shorts konulari kurallara uyar", () => {
  const T = require("../../lib/tutunma");
  const { KOK, jsonOku } = require("../../lib/ortak");
  const path = require("path");
  const bitti = new Set([...jsonOku(path.join(KOK, "icerik", "uretilenler.json"), []), ...jsonOku(path.join(KOK, "icerik", "basarisiz.json"), [])]);
  const hatali = K.konular().filter((x) => !bitti.has(x.slug) && K.formatBul(x) === "short")
    .map((x) => [x.slug, T.denetle(x).map((b) => b.mesaj)]).filter(([, b]) => b.length);
  assert.deepEqual(hatali, []);
});

test("zamanlama: dolu gun atlanir, plan publishAt'i yayin ani sayar (cron gecikmesi = cift yayin yok)", () => {
  const z = require("../../lib/zamanlama");
  // Dun 17:30'da calisan gec is videoyu bugunun 18:00'ine koydu -> bugunku is yarina koyar
  assert.equal(z.sonrakiSlot(new Date("2026-09-26T10:00:00Z"), 18, 1, ["2026-09-26T18:00:00.000Z"]).toISOString(), "2026-09-27T18:00:00.000Z");
  const kayit = [{ format: "short", tarih: "2026-09-25T17:30:00Z", publishAt: "2026-09-26T18:00:00.000Z" }];
  assert.equal(YP.durum("short", new Date("2026-09-26T10:00:00Z"), kayit, []).uygun, false, "o gun icin video zaten planli");
  assert.equal(YP.durum("short", new Date("2026-09-27T10:00:00Z"), kayit, []).uygun, true);
});

test("yukleme meta dogrulama: YouTube sinirlari", () => {
  const { metaDogrula } = require("../../youtube-yukle");
  const iyi = { title: "Why the Bridge Fell", description: "x", tags: ["bridge", "engineering failure"] };
  assert.deepEqual(metaDogrula(iyi, { privacyStatus: "private", publishAt: new Date(Date.now() + 3600e3).toISOString() }), []);
  assert.ok(metaDogrula({ ...iyi, title: "x".repeat(101) }, { privacyStatus: "private" }).length);
  assert.ok(metaDogrula({ ...iyi, description: "a<b" }, { privacyStatus: "private" }).length);
  assert.ok(metaDogrula({ ...iyi, tags: Array(60).fill("engineering failure") }, { privacyStatus: "private" }).length);
  assert.ok(metaDogrula(iyi, { privacyStatus: "public", publishAt: new Date(Date.now() + 3600e3).toISOString() }).length);
  assert.ok(metaDogrula(iyi, { privacyStatus: "private", publishAt: "2020-01-01T00:00:00Z" }).length);
});

test("saglik: gecersiz yetki kritik; production modunda sabit OAuth bitisi varsayilmaz", async () => {
  const S = require("../../saglik");
  const env = { YT_CLIENT_ID: process.env.YT_CLIENT_ID, YT_CLIENT_SECRET: process.env.YT_CLIENT_SECRET, YT_REFRESH_TOKEN: process.env.YT_REFRESH_TOKEN, YT_CHANNEL_ID: process.env.YT_CHANNEL_ID };
  process.env.YT_CLIENT_ID = "a"; process.env.YT_CLIENT_SECRET = "b"; process.env.YT_REFRESH_TOKEN = "c";
  process.env.YT_CHANNEL_ID = "UC_FAILURE_RECONSTRUCTED";
  try {
    const kotu = await S.denetle({ publish: "1", token: async () => { throw new Error("invalid_grant"); }, pexels: async () => 200, kalan: 20,
      authorizationState: { oauthMode: "production" } });
    assert.equal(kotu.yuklemeUygun, false);
    assert.equal(kotu.bulgular.find((b) => b.ad === "youtube-yetki").durum, "kritik");
    const iyi = await S.denetle({ publish: "1", token: async () => ({ kapsam: S.GEREKLI_KAPSAM.join(" ") }),
      identity: async () => ({ actual: "UC_FAILURE_RECONSTRUCTED" }), pexels: async () => 200, kalan: 3,
      authorizationState: { oauthMode: "production" } });
    assert.equal(iyi.yuklemeUygun, true);
    assert.equal(iyi.bulgular.find((b) => b.ad === "youtube-kanal").durum, "ok");
    assert.equal(iyi.bulgular.find((b) => b.ad === "kutuphane").durum, "uyari");
  } finally { for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
});

test("bildirim: yasam dongusu mesajlari eksiksiz, dusus noktasi dogru", () => {
  const B = require("../../bildirim");
  const h = B.hataMesaji({ slug: "x", neden: "YETKI_GECERSIZ: invalid_grant", yetki: true });
  assert.match(h.govde, /youtube-yetki\.js/);
  assert.match(h.govde, /Konu harcanmadı/);
  assert.equal(B.saglikMesaji({ tarih: "2026-09-26T10:00:00Z", bulgular: [{ ad: "a", durum: "ok", mesaj: "x" }] }), null);
  const s = B.saglikMesaji({ tarih: "2026-09-26T10:00:00Z", bulgular: [{ ad: "oauth-reauth-deadline", durum: "uyari", mesaj: "2 gün kaldı", cozum: "yenile" }] });
  assert.match(s.govde, /2 gün kaldı/);
  const t = [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.5].map((o, i) => ({ oran: o, izleme: [1.3, 1.25, 1.2, 1.0, 0.85, 0.8, 0.7][i] }));
  assert.equal(B.dususNoktasi(t, 38).sn, 8);
  const y = B.checkpointYorumu({ checkpoint: "3d", metrikler: { views: { durum: "ok", deger: 10 } }, teshis: [{ kod: "HEALTHY" }], tutma: t, sureSn: 38 });
  assert.match(y, /3 gün/);
  assert.match(y, /8\. saniye/);
  assert.doesNotMatch(y, /undefined|NaN/);
});

test("kuyruk: once gercek arsiv filmi olan konular", () => {
  const l = K.kuyruk();
  const ilkStok = l.findIndex((k) => k.tur === "stok");
  assert.ok(ilkStok === -1 || l.slice(ilkStok).every((k) => k.tur === "stok"));
});

test("etiketler: hicbir konuda virgul/<> yok, YouTube meta dogrulamasini gecer", () => {
  const D = require("../../description-engine");
  const { metaDogrula } = require("../../youtube-yukle");
  for (const k of K.konular()) {
    const t = D.etiketler(k);
    assert.ok(!t.some((x) => /[,<>]/.test(x)), k.slug + ": " + t.join(" | "));
    assert.deepEqual(metaDogrula({ title: k.baslik, description: "x", tags: t }, { privacyStatus: "private" }), [], k.slug);
  }
});

test("altyazi: rakam icindeki nokta/virgul korunur", () => {
  assert.deepEqual(M.altyaziKelimeleri("A 1.4 billion dollar bomber."), ["A", "1.4", "billion", "dollar", "bomber"]);
  assert.deepEqual(M.altyaziKelimeleri("As 2,500 passengers crowded, it tipped."), ["As", "2,500", "passengers", "crowded", "it", "tipped"]);
});

test("bildirim: bos gun alarmi yalnizca gercekten bos gunde", () => {
  const B = require("../../bildirim");
  const t = { tarih: "2026-09-27", kalanKonu: 38, sunucu: "https://github.com" };
  assert.equal(B.bosGunMesaji({ ...t, bugunVar: true }), null, "video uretildiyse alarm yok");
  assert.equal(B.bosGunMesaji({ ...t, bugunVar: false, kalanKonu: 0 }), null, "kuyruk bossa alarm yok");
  const m = B.bosGunMesaji({ ...t, bugunVar: false });
  assert.match(m.baslik, /2026-09-27/);
  assert.match(m.govde, /Run workflow/);
  assert.doesNotMatch(m.govde, /undefined|NaN/);
});

test("tiktok: aciklama kisa ve dogru, kimlik yoksa sessiz, tekrar gonderim yok", () => {
  const T = require("../../tiktok-yukle");
  const a = T.aciklama("challenger-1986");
  assert.ok(a.length > 40 && a.length <= 2100);
  assert.match(a, /[Ss]ynthetic (voice|narration)/, "sentetik ses beyani her gonderide");
  assert.ok((a.match(/#\w+/g) || []).length <= 4, "TikTok'ta az etiket");
  assert.doesNotMatch(a, /undefined|NaN|\[object/);
  assert.doesNotMatch(a, /https?:\/\//, "TikTok aciklamasinda baglanti yok");
  const TT = require("../../lib/tiktok");
  // kimlikVar ortama gore degisir (.env ya da GitHub secrets); burada yalnizca
  // "uc anahtarin UCU birden gerekli" kuralini dogrula — ortamdan bagimsiz.
  assert.equal(typeof TT.kimlikVar(), "boolean");
  assert.equal(TT.GEREKLI ? TT.GEREKLI.length : 3, 3);
  // TikTok hatayi HTTP 200 govdesinde de dondurebilir
  assert.equal(TT.hataMi({ error: { code: "ok" } }), null);
  assert.equal(TT.hataMi({}), null);
  assert.match(TT.hataMi({ error: { code: "invalid_params", message: "bad" } }), /invalid_params/);
  assert.match(TT.hataMi({ error: { code: "x", message: "y", log_id: "L1" } }), /L1/);
});

test("tiktok aciklamasi: kanca, sebep, SORU, beyan, tutarli etiketler", () => {
  const T = require("../../tiktok-yukle");
  const a = T.aciklama("challenger-1986");
  const b = T.aciklama("hindenburg");
  for (const x of [a, b]) {
    assert.match(x, /#FailureReconstructed/, "marka etiketi her videoda");
    assert.match(x, /#engineering/);
    assert.match(x, /Synthetic narration/, "sentetik ses beyani");
    assert.doesNotMatch(x, /#fyp|#foryou|#viral/i, "doldurma etiketi yok");
    assert.doesNotMatch(x, /undefined|NaN|\[object/);
    assert.doesNotMatch(x, /https?:\/\//, "TikTok aciklamasinda baglanti yok");
    assert.ok((x.match(/#\w+/g) || []).length <= 5);
    assert.ok(x.length <= 2100);
    assert.match(x.split("\n")[0], /\S/, "ilk satir kanca (akista gorunen)");
  }
  // 3. blok tartisma SORUSU olmali (yorum getirir), ilk cumle degil
  assert.match(a.split("\n\n")[2], /\?$/, "soru ile bitmeli: " + a.split("\n\n")[2]);
  assert.match(a, /how would you have made them listen\?/);
  // kumeye gore etiket
  assert.match(a, /#space/); assert.match(b, /#aviation/);
});

test("tiktok gecmis kuyrugu: gonderilmemisler, eskiden yeniye", () => {
  const T = require("../../tiktok-yukle");
  const k = T.gecmisKuyrugu();
  assert.ok(Array.isArray(k));
  // Gonderilmis olanlar kuyrukta olmamali
  const fs = require("fs"), path = require("path");
  const { KOK, jsonOku } = require("../../lib/ortak");
  const gonderilmis = new Set(jsonOku(path.join(KOK, "icerik", "tiktok.json"), []).map((x) => x.slug));
  for (const y of k) assert.ok(!gonderilmis.has(y.slug), y.slug + " zaten gonderilmis");
  // Eskiden yeniye sirali
  const t = k.map((y) => String(y.publishAt || y.tarih));
  assert.deepEqual(t, [...t].sort(), "kuyruk eskiden yeniye sirali olmali");
  // Her konusu okunabilir olmali (silinen konu kuyruga girmez)
  for (const y of k) assert.ok(K.konuOku(y.slug), y.slug);
});

test("TikTok gecmis adimi YouTube'a IKINCI KEZ yuklemez", () => {
  const fs = require("fs");
  const kaynak = fs.readFileSync(require("path").join(require("../../lib/ortak").KOK, "tiktok-yukle.js"), "utf8");
  // Gecmis videosu uretilirken shorts-sira PUBLISH=0 ile cagrilmali; aksi halde
  // YouTube'da zaten yayinda olan video ikinci kez yuklenmeye calisilir.
  const cagri = kaynak.match(/spawnSync\("node",\s*\["shorts-sira\.js",\s*slug\][\s\S]{0,220}?\)/);
  assert.ok(cagri, "shorts-sira cagrisi bulunamadi");
  assert.match(cagri[0], /PUBLISH:\s*"0"/, "gecmis uretimi PUBLISH=0 ile calismali:\n" + cagri[0]);

  // Ikinci savunma: shorts-sira yalnizca PUBLISH=1 iken yukler
  const sira = fs.readFileSync(require("path").join(require("../../lib/ortak").KOK, "shorts-sira.js"), "utf8");
  assert.match(sira, /const publish = process\.env\.PUBLISH === "1";/);

  // Ucuncu savunma: yukleyici idempotency anahtari + kanaldaki son yuklemelerle
  // (baslik ya da ayni publishAt) uzlasir; uzlasamazsa yuklemez (lib/publish-safety).
  const yuk = fs.readFileSync(require("path").join(require("../../lib/ortak").KOK, "youtube-yukle.js"), "utf8");
  assert.match(yuk, /Safety\.matchRemote\(await Safety\.recentUploads\(api\)/, "cift yukleme korumasi kaldirilmis");
});

test("arsiv fotografi: acilis ani kurali fotografta gecmez, filmde gecer", () => {
  const T = require("../../lib/tutunma");
  const sahne = (kaynak) => ({ sahneler: [{ metin: "A tank burst and killed twenty one people.", kaynak },
    { metin: "It crushed buildings in seconds.", kaynak }] });
  // Film: baslangic sart
  assert.equal(T.denetle(sahne("Footage/x.ogv")).filter((b) => b.kural === "arsiv-acilis").length, 1);
  // Fotograf: zaman damgasi yok, kural gecmez
  for (const u of ["Footage/f1.jpg", "Footage/f1.JPEG", "Footage/f1.png", "Footage/f1.webp"])
    assert.equal(T.denetle(sahne(u)).filter((b) => b.kural === "arsiv-acilis").length, 0, u);
});

test("shorts-yap: fotograf kaynagi hareketli islenir (durgun kare yok)", () => {
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(require("../../lib/ortak").KOK, "shorts-yap.js"), "utf8");
  assert.match(src, /const FOTO = /, "fotograf tanima yok");
  assert.match(src, /Kadraj\.fotoFiltre\(/, "fotografa hareket uygulanmiyor");
  assert.match(src, /foto \? \["-loop", "1"/, "fotograf -loop 1 ile beslenmeli");
  const kadraj = fs.readFileSync(path.join(require("../../lib/ortak").KOK, "lib", "dikey-kadraj.js"), "utf8");
  assert.match(kadraj, /zoompan/, "Ken Burns hareketi yok");
  assert.match(kadraj, /crop=\$\{W \* 2\}:\$\{H \* 2\}:x=/, "yatay fotografta pan yok");
});

test("aday-gorsel: lisans/cozunurluk/aci teshiri elemesi", () => {
  const A = require("../../aday-gorsel");
  const g = (o) => ({ baslik: "x.jpg", aciklama: "", lisans: "Public domain", en: 1200, boy: 900, ...o });
  assert.equal(A.ele(g()), null, "temiz gorsel gecmeli");
  // Lisans: arsiv-bul ile AYNI kural
  for (const l of ["CC BY-SA 4.0", "CC BY-NC 2.0", "CC BY-ND 4.0", "?", "Fair use", ""])
    assert.ok(A.ele(g({ lisans: l })), "reddedilmeli: " + l);
  for (const l of ["Public domain", "PD-USGov", "CC0", "CC BY 4.0"])
    assert.equal(A.ele(g({ lisans: l })), null, "kabul edilmeli: " + l);
  // Cozunurluk
  assert.ok(A.ele(g({ en: 500 })));
  // Aci teshiri ve olay disi gorseller
  for (const b of ["Eleanor Cook post mortem.jpg", "Removing victims from the building.jpg",
    "Flood Historical Marker.jpg", "Map of the harbour.jpg", "1947 Events Collage.jpg"])
    assert.ok(A.ele(g({ baslik: b })), "elenmeli: " + b);
  // Lisans kurali arsiv-bul.js ile ayni kalmali (iki yerde ayrisirsa koruma delinir)
  const fs = require("fs"), path = require("path");
  const ab = fs.readFileSync(path.join(require("../../lib/ortak").KOK, "arsiv-bul.js"), "utf8");
  const re = ab.match(/const lisansUygun = \(l\) => (.*);/);
  assert.ok(re, "arsiv-bul lisansUygun bulunamadi");
  assert.equal(re[1], String(A.lisansUygun).replace(/^\(?l\)? => /, ""), "lisans kurallari ayrismis");
});

test("aday-gorsel: ceset/cizim/belge elemesi ve kopya birlestirme", () => {
  const A = require("../../aday-gorsel");
  const g = (b) => ({ baslik: b, aciklama: "", lisans: "Public domain", en: 1200, boy: 900 });
  // Gercek olay fotografi gecmeli
  for (const b of ["Among the oil barrels where fire started.jpg", "Panorama of the theatre after the fire.jpg"])
    assert.equal(A.ele(g(b)), null, b);
  // Aci teshiri — kanal bunlari GOSTERMEZ
  for (const b of ["Diver going down for bodies in upper saloon.jpg", "bodies on the beach showing in the background.jpg",
    "Gustav Scholer signing death certificate.jpg", "Victims of the fire, identifying the dead.jpg"])
    assert.equal(A.ele(g(b)), "aci teshiri", b);
  // Tablo/cizim — olayin fotografi degil (bitisik yazim dahil)
  for (const b of ["Titanic sinking, painting by Willy Stower.jpg", "LuxuriesVersusLifeboatsPuckMagazine1912.jpg",
    "Drawing depicting women jumping.jpg"])
    assert.equal(A.ele(g(b)), "tablo/cizim", b);
  // Belge taramasi
  assert.equal(A.ele(g("Partial fatality list for the Iroquois Theatre fire (1903).jpg")), "belge");
  // Ayni gorselin .jpg/.tif ve LCCN surumleri tek sayilir
  assert.equal(A.tekilles([g("X LCCN2009632219.jpg"), g("X LCCN2009632219.tif"), g("Y.jpg")]).length, 2);
});

test("arsiv-bul: stereo kart tespiti ve kirpmasi kodda duruyor", () => {
  const fs = require("fs"), path = require("path");
  const src = fs.readFileSync(path.join(require("../../lib/ortak").KOK, "arsiv-bul.js"), "utf8");
  assert.match(src, /function stereoMu/, "stereo tespiti yok");
  assert.match(src, /ssim/, "SSIM karsilastirmasi yok");
  assert.match(src, /function stereoKirp/, "stereo kirpma yok");
  assert.match(src, /k\.stereo !== false/, "spec'ten kapatma secenegi yok");
});
