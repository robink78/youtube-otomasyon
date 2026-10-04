// YORUM YANITLA — kanal videolarindaki yeni yorumlara olculu, cesitli yanit yazar.
//
// Ucretsiz (AI yok): yorumu kategorize eder (soru / ovgu / diger), yalnizca
// ANLAMLI ve SORU yorumlara cevaplar (her yoruma degil -> spam degil), tekrar
// cevaplamaz, calisma basina sinirli sayida. Etkilesim = algoritma yakiti.
//
// force-ssl izni gerekir (youtube-yetki.js ile alinmis). Durum: icerik/yanitlanan.json
//
// Kullanim: node yorum-yanitla.js [--limit N]

const fs = require("fs");
const path = require("path");
const https = require("https");
const Channel = require("./core/channel-context");
const SELECTED = Channel.selectFromArgv(process.argv.slice(2));
const CHANNEL = SELECTED.channel;

const KOK = __dirname;
const DURUM = path.join(CHANNEL.paths.state, CHANNEL.config.pathMode === "legacy-adapter" ? "yanitlanan.json" : "replied-comments.json");
const LIMIT = Number((SELECTED.argv.find(a => a.startsWith("--limit=")) || "").split("=")[1]) ||
  (SELECTED.argv.includes("--limit") ? Number(SELECTED.argv[SELECTED.argv.indexOf("--limit") + 1]) : 0) || 8;

function istek(opt, govde) {
  return new Promise((coz, red) => {
    const r = https.request(opt, (res) => { const p = []; res.on("data", d => p.push(d));
      res.on("end", () => coz({ durum: res.statusCode, govde: Buffer.concat(p).toString("utf8") })); });
    r.on("error", red); if (govde) r.write(govde); r.end();
  });
}
const api = (tok, yol) => istek({ hostname: "www.googleapis.com", path: "/youtube/v3/" + yol,
  headers: { Authorization: "Bearer " + tok } });

// --- Yanit havuzlari (cesitli, marka tonu) ---
const SORU_YANIT = [
  "Great question — that could be a whole video on its own! Which topic should we cover next?",
  "Good one. What's your guess?",
  "Ooh, good question. Might dig into that in a future short. 👀",
  "Honestly a great question — the science behind it is wild.",
  "Love this question. Anyone else wondering the same?",
];
const OVGU_YANIT = [
  "Thanks for watching! New disaster every day. 🙏",
  "Appreciate it! 💥 Which one hit hardest?",
  "Glad you enjoyed it! There's a new one tomorrow.",
  "Thank you! History is wild, right?",
  "Means a lot — more coming every single day. 🌊",
];
const BILGI_YANIT = [
  "Great context — thanks for adding that!",
  "Really good point, that's a big part of the story.",
  "Love this detail. Thanks for sharing it!",
  "Exactly — history is full of these turning points.",
  "Great addition. This is why the comments are the best part. 🙌",
];
const rasgele = (a) => a[Math.floor(Math.random() * a.length)];

function json(metin) {
  try { return JSON.parse(metin || "{}"); } catch (e) { return {}; }
}

function apiHatasi(yanit) {
  const govde = json(yanit.govde);
  return govde?.error?.errors?.[0]?.reason || govde?.error?.message || `HTTP ${yanit.durum}`;
}

function durumuYaz(yanitlanan) {
  fs.mkdirSync(path.dirname(DURUM), { recursive: true });
  const gecici = `${DURUM}.${process.pid}.tmp`;
  fs.writeFileSync(gecici, JSON.stringify([...yanitlanan], null, 2) + "\n");
  fs.renameSync(gecici, DURUM);
}

function kategori(metin) {
  const t = metin.trim();
  if (/\?/.test(t)) return "soru";
  // cok kisa / sadece emoji -> atla (spam olmasin diye cevaplamiyoruz)
  const harf = t.replace(/[^A-Za-z0-9]/g, "");
  if (harf.length < 6) return "atla";
  // olumsuz/troll isaretleri -> atla (guvenli taraf)
  if (/\b(fake|stupid|trash|hate|boring|bot)\b/i.test(t)) return "atla";
  // uzun, bilgi ekleyen yorum -> "bilgi" (ovgu cevabi tonu kaydirir)
  if (t.length > 60) return "bilgi";
  return "ovgu";
}

async function main() {
  const tok = (await require("./lib/yt").getYouTubeClient(CHANNEL)).accessToken;
  const yanitlanan = new Set((() => { try { return JSON.parse(fs.readFileSync(DURUM, "utf8")); } catch (e) { return []; } })());

  // Kanalin son yuklemelerini al
  const ch = await api(tok, "channels?part=contentDetails&mine=true");
  if (ch.durum !== 200) throw new Error(`Kanal okunamadi: ${apiHatasi(ch)}`);
  const uploads = (json(ch.govde).items || [{}])[0]?.contentDetails?.relatedPlaylists?.uploads;
  if (!uploads) throw new Error("Yuklemeler listesi bulunamadi (izin/kanal?).");
  const pl = await api(tok, "playlistItems?part=contentDetails&maxResults=15&playlistId=" + uploads);
  if (pl.durum !== 200) throw new Error(`Yuklemeler okunamadi: ${apiHatasi(pl)}`);
  const videoIds = (json(pl.govde).items || []).map(i => i.contentDetails.videoId);

  let yanit = 0;
  let basarisiz = 0;
  for (const vid of videoIds) {
    if (yanit >= LIMIT) break;
    const c = await api(tok, "commentThreads?part=snippet&maxResults=20&order=time&videoId=" + vid);
    if (c.durum !== 200) {
      const neden = apiHatasi(c);
      if (neden === "commentsDisabled") { console.log(`  - ${vid}: yorumlar kapali`); continue; }
      throw new Error(`${vid} yorumlari okunamadi: ${neden}`);
    }
    const threads = (json(c.govde).items || []);
    for (const th of threads) {
      if (yanit >= LIMIT) break;
      const top = th.snippet.topLevelComment;
      const cid = top.id;
      const yazar = top.snippet.authorChannelId?.value;
      const metin = top.snippet.textOriginal || "";
      if (yanitlanan.has(cid)) continue;
      // Kanalin KENDI yorumuna (or. sabit tartisma yorumu) asla cevap verme —
      // yazar kimligi video sahibinin kanal kimligiyle karsilastirilir.
      if (yazar && yazar === th.snippet.channelId) { yanitlanan.add(cid); durumuYaz(yanitlanan); continue; }
      // zaten cevaplanmis konusmaya tekrar girme
      if (th.snippet.totalReplyCount > 0) { yanitlanan.add(cid); durumuYaz(yanitlanan); continue; }
      const kat = kategori(metin);
      if (kat === "atla") { yanitlanan.add(cid); durumuYaz(yanitlanan); continue; }
      const cevap = kat === "soru" ? rasgele(SORU_YANIT)
        : kat === "bilgi" ? rasgele(BILGI_YANIT) : rasgele(OVGU_YANIT);
      const body = JSON.stringify({ snippet: { parentId: cid, textOriginal: cevap } });
      const r = await istek({ hostname: "www.googleapis.com", path: "/youtube/v3/comments?part=snippet",
        method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body) } }, body);
      if (r.durum === 200) {
        console.log(`  ✓ [${kat}] "${metin.slice(0, 40)}" -> yanitlandi`);
        yanit++;
        yanitlanan.add(cid);
        durumuYaz(yanitlanan);
      } else {
        basarisiz++;
        console.log(`  ✗ yanit basarisiz (yeniden denenecek, HTTP ${r.durum}): ${r.govde.slice(0, 120)}`);
      }
      await new Promise(r => setTimeout(r, 800));
    }
  }
  durumuYaz(yanitlanan);
  console.log(`Bitti. ${yanit} yorum yanitlandi (limit ${LIMIT}).`);
  if (basarisiz) throw new Error(`${basarisiz} yorum yaniti gonderilemedi; sonraki calismada yeniden denenecek.`);
}
if (require.main === module) main().catch(e => { console.error("Hata: " + e.message); process.exit(1); });

module.exports = { kategori, apiHatasi, durumuYaz, main };
