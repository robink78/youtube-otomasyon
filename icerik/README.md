# İçerik — Shorts konu kütüphanesi

Kanal: **Failure Reconstructed** — felaketler ve mühendislik hataları (dikey Shorts).

Sistem tamamen otomatik: `icerik/konular/<slug>.json` altındaki onaylı konuları
sırayla üretir (gerçek kamu malı arşiv görüntüsü + doğal ses + kinetik altyazı),
`PUBLISH=1` ve YouTube kimliği varsa **private** yükler.

## Akış (elle adım yok)

```
icerik/konular/<slug>.json
        ↓  shorts-sira.js
arsiv-bul.js   → gerçek görüntüyü indirir (Wikimedia / kamu malı)
shorts-yap.js  → dikey 9:16 Short render eder
youtube-yukle  → (PUBLISH=1 + kimlik varsa) private yükler
        ↓
icerik/uretilenler.json  (üretilen slug'lar; sonraki çalışma sonrakini alır)
```

Elle çalıştırma:
```bash
node shorts-sira.js                 # sonraki üretilmemiş konuyu üret
node shorts-sira.js tacoma-narrows  # belirli konu
node shorts-sira.js --hepsi         # tüm üretilmemişleri
```

GitHub Actions bunu **3 günde bir** otomatik çalıştırır (`.github/workflows/uretim.yml`).

## Konu dosyası biçimi (`icerik/konular/<slug>.json`)

```json
{
  "kanal": "Failure Reconstructed",
  "baslik": "Why the Tacoma Narrows Bridge Tore Itself Apart",
  "ses": "en-US-AndrewNeural",
  "sesHizi": "+6%",
  "altyaziFont": "Arial Black",
  "kaynaklar": [
    { "ad": "tacoma.ogv", "wikimedia": "Tacoma Narrows Bridge destruction.ogv" }
  ],
  "sahneler": [
    { "metin": "Kanca cümlesi...", "kaynak": "Footage/tacoma.ogv", "baslangic": 74 }
  ]
}
```

- `kaynaklar` — indirilecek gerçek görüntü. Telifsiz olmalı:
  - `wikimedia`: Commons dosya adı (çoğu kamu malı/CC — `arsiv-bul` lisansı `GORSEL-KAYNAKLARI.txt`'e yazar)
  - `url`: doğrudan kamu malı bağlantı
  - `archive`: archive.org — sadece `identifier` (en iyi video dosyası otomatik
    seçilir) ya da `identifier/dosya.mp4`. archive.org devasa bir kamu malı film
    arşivi (Prelinger, Universal Newsreels) — kütüphaneyi büyütmenin ana kaynağı.
    Not: bazı arşiv filmlerinin kendi anlatımı/müziği vardır; konu eklemeden önce
    görüntüyü önizle (bizim seslendirmemizle çakışmasın).
- `sahneler` — her biri bir anlatı cümlesi + hangi kaynağın hangi saniyesinden (`baslangic`) alınacağı. Sahne süresi kelime payına göre otomatik hesaplanır.

## Yeni konu eklerken (kalite + doğruluk kuralı)

1. **Olguları doğrula** — anlatı gerçek olmalı; abartı/yanlış bilgi yok.
2. **Telifsiz görüntüyü doğrula** — `kaynaklar`daki dosyanın gerçekten var ve
   kamu malı/CC olduğunu Commons'ta kontrol et.
3. **Dramatik `baslangic` saniyeleri seç** — kancaya en güçlü anı koy.
4. Dosyayı `icerik/konular/<slug>.json` olarak kaydet. Hepsi bu.
