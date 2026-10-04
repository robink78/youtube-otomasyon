// ZAMANLAMA — sabit saatte otomatik yayin (YouTube "scheduled publish").
//
// Video private yuklenir ve status.publishAt ile belirlenen saatte YouTube
// tarafindan kendiliginden Public yapilir. Saat config/growth.json >
// publishing.schedule.hourUTC (yaklasik 22:00 UTC). Kanal uretimi ise
// core/scheduling/calendar.js kullanir: 18:00 America/New_York, yaz saatiyle birlikte.
// Izleyici kitlesi degisirse (analytics ulke dagilimi / panel "Publish hour")
// saat oradan guncellenir.
"use strict";

const AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

// simdi'den en az minOnceSaat sonraki ilk hourUTC:00 anı. "dolu" = daha once
// zamanlanmis yayin anlari (icerik/yayinlananlar.json publishAt): ayni GUNE ikinci
// video konmaz (GitHub cron gecikince dunku video bugunun slotuna kaymis olabilir).
function sonrakiSlot(simdi, hourUTC, minOnceSaat = 1, dolu = []) {
  const gunler = new Set(dolu.filter(Boolean).map((d) => new Date(d).toISOString().slice(0, 10)));
  const t = new Date(Date.UTC(simdi.getUTCFullYear(), simdi.getUTCMonth(), simdi.getUTCDate(), hourUTC, 0, 0));
  while (t.getTime() - simdi.getTime() < minOnceSaat * 3600000 || gunler.has(t.toISOString().slice(0, 10))) t.setUTCDate(t.getUTCDate() + 1);
  return t;
}

// Turkiye saati (UTC+3, yaz/kis saati yok) ile okunur metin
function trSaat(d) {
  const t = new Date(d.getTime() + 3 * 3600000);
  return `${t.getUTCDate()} ${AYLAR[t.getUTCMonth()]} ${String(t.getUTCHours()).padStart(2, "0")}:${String(t.getUTCMinutes()).padStart(2, "0")} (TR)`;
}

module.exports = { sonrakiSlot, trSaat };
