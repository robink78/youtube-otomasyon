# Canlı çalıştırma: yetkiler ve maliyetler

Bu belge, **kod hazır** hale geldikten sonra sistemi 3 günde bir otomatik
çalıştırıp YouTube'a yüklemek için gereken hesap yetkilerini ve net servis
maliyetlerini gösterir. Anahtar girmeden de her şey çalışır; anahtarsızken
sadece **yükleme** ve **ücretli senaryo** adımları atlanır.

> Varsayılan güvenlik: yükleme her zaman **private** yapılır. Hiçbir video
> otomatik olarak herkese açılmaz — YouTube Studio'dan inceleyip sen yayınlarsın.

---

## Özet — neye ne kadar

| Servis | Zorunlu mu? | Maliyet |
|---|---|---|
| **2.5D sinematik görsel** (ffmpeg) | Hayır (varsayılan açık) | **Ücretsiz** |
| **Seslendirme** (Microsoft Edge nöral) | — | **Ücretsiz** |
| **Görsel** (Pollinations / Pexels / Pixabay) | — | **Ücretsiz** |
| **YouTube yükleme** (Data API v3) | Yüklemek istiyorsan | **Ücretsiz** (kota dahilinde) |
| **GitHub Actions** (3 günde bir çalışma) | Otomasyon istiyorsan | Genelde **ücretsiz** (aşağıda) |
| **Anthropic** (senaryo üretimi) | Sadece hazır anlatı vermezsen | ~**0,10 $ / senaryo** |
| **AI video API** (Kling/Runway) | Hayır — bu yolu seçmedik | Seçilmedi |

Kısacası: seçtiğimiz yol (2.5D parallax + GitHub Actions + hazır/onaylı anlatı)
ile **sürekli maliyet ~0 $**. Tek olası ücret, senaryoyu elle vermeyip
Anthropic'e yazdırırsan senaryo başına birkaç senttir.

---

## 1. YouTube yükleme yetkisi (tek seferlik kurulum)

Amaç: betiklerin senin kanalına yükleyebilmesi için bir **yenileme jetonu**
(refresh token) üretmek. Bir kez yapılır; sonra sistem jetonu kendisi tazeler.

### 1.1 Google Cloud projesi + API
1. [console.cloud.google.com](https://console.cloud.google.com) → yeni proje oluştur.
2. **APIs & Services → Library** → "YouTube Data API v3" → **Enable**.

### 1.2 OAuth onay ekranı
3. **APIs & Services → OAuth consent screen**.
4. Kullanıcı tipi: **External**.
5. Kapsam (scope) ekle: `.../auth/youtube.upload`.
6. **Önemli — jeton süresi:** Onay ekranını **"Testing" değil "Production/Üretim"**
   yayın durumuna al.
   - *Testing* modunda üretilen refresh token **7 günde bir geçersiz** olur —
     3 günde bir çalışan zamanlama birkaç gün sonra kırılır.
   - *Production* modunda jeton süresiz kalır. Uygulama "doğrulanmamış"
     göründüğü için ilk onayda bir uyarı ekranı çıkar; kendi kanalın için
     "Advanced → devam et" ile geçersin. Google doğrulaması (video/gizlilik
     incelemesi) **sadece** uygulamayı başkalarına açacaksan gerekir; tek
     kullanıcı (sen) için gerekmez.

### 1.3 OAuth istemcisi
7. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
8. Tip: **Desktop app** (ya da Web app; Web ise yönlendirme URI'si
   `http://localhost:53682` olmalı — yardımcı script bu portu kullanıyor).
9. Çıkan **Client ID** ve **Client secret**'i `.env`'e yaz:
   ```
   YT_CLIENT_ID=...
   YT_CLIENT_SECRET=...
   ```

### 1.4 Yenileme jetonunu üret
10. Şunu çalıştır:
    ```bash
    node youtube-yetki.js
    ```
11. Terminaldeki bağlantıyı tarayıcıda aç, Google ile onayla. Dönen
    `YT_REFRESH_TOKEN=...` satırını `.env`'e ekle.
12. Doğrula (hiçbir şey yüklemez):
    ```bash
    node youtube-yukle.js <is-adi> --dogrula
    ```

**Gereken hesap:** yüklemenin yapılacağı YouTube kanalının bağlı olduğu Google
hesabı. Kanal, 1.2'deki onayı veren hesabın kanalıdır.

### YouTube API kotası (ücretsiz ama sınırlı)
- Günlük varsayılan kota: **10.000 birim**.
- Bir video yükleme (`videos.insert`): **1.600 birim** → günde ~**6 video**.
- 3 günde bir 1 video için bu fazlasıyla yeterli. Para yok; sadece kota.

---

## 2. Sürekli çalışma: GitHub Actions (3 günde bir)

Zamanlama `.github/workflows/uretim.yml` içinde kuruldu: **3 günde bir 06:00
UTC** + elle tetikleme. İş akışı `kuyruk/` klasöründeki onaylı işlerden en
eskisini üretir; izin ve kimlik varsa private yükler.

### 2.1 Repo ayarları (Settings)
- **Secrets** (Settings → Secrets and variables → Actions → *Secrets*):
  - `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`
  - (isteğe bağlı) `ANTHROPIC_API_KEY`
- **Variables** (aynı yer → *Variables*):
  - `PUBLISH` = `1` → yüklemeyi aç. **Boş bırakırsan üretir ama yüklemez.**
  - (isteğe bağlı) `ANTHROPIC_MODEL`

### 2.2 İş ekleme
`kuyruk/README.md`'deki biçimde `kuyruk/<ad>.json` ekle (konu + başlık + opsiyonel
hazır anlatı metni). İşlenen işler otomatik `kuyruk/islenen/`'e taşınır.

### 2.3 GitHub Actions maliyeti
- **Public repo:** dakika **ücretsiz ve sınırsız**.
- **Private repo (Free plan):** aylık **2.000 dakika ücretsiz**. Bir üretim
  koşusu (render dahil) kabaca 15–60 dk; ayda ~10 koşu → limitin çok altında.
- Depon şu an public: `github.com/eyazan/youtube-otomasyon` → dakika ücreti yok.
- Not: cron ayın günlerine göre çalışır (1, 4, 7, … 28, 31), bu yüzden ay
  sonunda tek seferlik 2 günlük bir boşluk olur. Kabul edilebilir.

---

## 3. İsteğe bağlı: senaryo üretimi (Anthropic)

`kuyruk` işine `narration` (hazır anlatı metni) verirsen senaryo bundan kurulur
ve **ücret olmaz**. Vermezsen senaryo Anthropic'e yazdırılır:
- Gereken: `ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`.
- Maliyet: senaryo başına yaklaşık **10 sent** (uzunluğa göre değişir).
- Aboneliğin API kullanımını kapsamadığını unutma; bu ayrı faturalanır.

---

## 4. Canlıya geçiş kontrol listesi

- [ ] Google Cloud projesi + YouTube Data API v3 açık
- [ ] OAuth onay ekranı **Production** modunda (jeton süresiz)
- [ ] `YT_CLIENT_ID` / `YT_CLIENT_SECRET` alındı
- [ ] `node youtube-yetki.js` ile `YT_REFRESH_TOKEN` üretildi
- [ ] `node youtube-yukle.js <is> --dogrula` temiz çıktı verdi
- [ ] GitHub'da Secrets (3 anahtar) girildi
- [ ] GitHub'da `PUBLISH=1` değişkeni ayarlandı (yüklemeyi açmak için)
- [ ] `kuyruk/`'a en az bir onaylı iş kondu
- [ ] Actions → "Run workflow" ile elle bir test koşusu yapıldı
- [ ] İlk video YouTube Studio'da **private** göründü, incelenip yayınlandı

Bu liste tamamlanana kadar sistem hiçbir şeyi herkese açık yayınlamaz.
