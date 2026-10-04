# TikTok — kurulum ve işleyiş

> **Emekli (2 Ekim 2026).** Otomasyon artık yalnız YouTube Shorts üretir. TikTok tüm kanallarda kapalıdır (`platforms.tiktok.enabled: false`) ve hiçbir workflow TikTok'a gönderim yapmaz. Kod referans için duruyor; `TT_CLIENT_KEY`, `TT_CLIENT_SECRET`, `TT_REFRESH_TOKEN` secret'ları ve `TT_EXPECTED_OPEN_ID_SHA256` değişkeni silinebilir. Aşağısı tarihsel kayıttır.

Aynı videolar, aynı otomasyon. YouTube yayını bundan **hiç etkilenmez**: TikTok kimlik
bilgileri yoksa adım sessizce atlanır, TikTok tarafında bir hata olursa gün bozulmaz.

## Neden "gelen kutusu" yolu

TikTok'un Content Posting API'sinde iki yol var:

| Yol | Kapsam | Denetim | Sonuç |
|---|---|---|---|
| **Gelen kutusu** (kullanılan) | `video.upload` | gerekmez | Video TikTok uygulamana düşer, bildirime dokunup yayınlarsın. Gönderi **herkese açık** olabilir. |
| Doğrudan gönderi | `video.publish` | TikTok denetimi gerekir | Denetimden geçene kadar gönderiler **yalnızca gizli** olabilir — yani kimse göremez. |

Bu yüzden gelen kutusu yolu seçildi: günde bir dokunuş, ama gerçek erişim. TikTok
uygulamayı denetleyip onaylarsa doğrudan gönderiye geçilebilir (kod hazır, tek satır
değişir).

## Senin yapman gerekenler (bir kerelik)

Hesap açmayı ve şartları kabul etmeyi ben yapamam — bu adımlar sende.

1. **TikTok hesabı aç** (telefondan, `tiktok.com`). Kullanıcı adı olarak kanal adıyla
   uyumlu bir şey seç, örn. `failurereconstructed`. Profil fotoğrafı ve açıklamayı
   YouTube kanalıyla aynı yap.
2. **developers.tiktok.com** → **Sign up**. Burası TikTok uygulama hesabından
   **tamamen ayrı** bir hesaptır: sadece bir e‑posta adresi ister, e‑postaya PIN
   gönderir. TikTok hesabına e‑posta eklemene gerek yok; telefonla açılmış hesap
   olduğu gibi kalır. Videonun hangi hesaba gideceği 4. adımda (`tiktok-yetki.js`
   çalışırken tarayıcıda "izin ver" dediğin hesapla) belirlenir.
3. Portalda **Manage apps** → **Connect an app**. Uygulama adı:
   `Failure Reconstructed uploader`.
4. Uygulamada **Content Posting API** ürününü ekle ve **Upload to inbox** (scope
   `video.upload`) iznini seç. *Direct Post'u işaretleme.*
5. TikTok **Login Kit**'i de otomatik ekler (OAuth izni için gerekli). Doldurulması
   zorunlu alanlar şunlarla doldurulur:

   | Alan | Değer |
   |---|---|
   | Terms of Service URL | `https://eyazan.github.io/youtube-otomasyon/terms.html` |
   | Privacy Policy URL | `https://eyazan.github.io/youtube-otomasyon/privacy.html` |
   | Website / App URL | `https://eyazan.github.io/youtube-otomasyon/` |
   | Platform | Web (Desktop/Mobile app değil) |
   | Category | Tools / Productivity (ya da en yakını) |

   TikTok bu adreslerin **sahipliğini doğrulatır** ("This URL is not verified" uyarısı).
   `github.com` doğrulanamaz — bu yüzden sayfalar GitHub Pages ile yayınlandı:
   `gh-pages` dalı → https://eyazan.github.io/youtube-otomasyon/ (kaynak: bu deponun
   `gh-pages` dalı; uygulama kodu `main`'de kalır). Doğrulama için **Verify URL
   properties** → **URL prefix** seç, `https://eyazan.github.io/youtube-otomasyon/`
   gir, verdiği imza dosyasını indir ve `gh-pages` dalının köküne ekleyip gönder.

   Ayrıca *Content Posting API* kartında **Direct Post kapalı** kalmalı ve
   *Verify domains* adımı **atlanır** — o yalnızca `pull_by_url` içindir, biz dosyayı
   doğrudan gönderiyoruz (`push_by_file`).

6. **Redirect URI** olarak sahibi olduğun bir HTTPS adresi gir. TikTok `http://localhost`
   kabul etmez. Elinde bir şey yoksa şunu kullan:
   `https://eyazan.github.io/youtube-otomasyon/`
   Sayfanın var olması gerekmiyor; 404 verse de olur, tarayıcının adres çubuğu yeterli.
7. Uygulamadan **Client key** ve **Client secret** değerlerini al.

## Uygulama onaylanana kadar: test kullanıcısı şart

TikTok uygulaması onaylanmadan önce **geliştirme modundadır** ve OAuth ekranı yalnızca
*test kullanıcısı* olarak eklenmiş hesapları kabul eder. Kanal hesabı listede yoksa
yetki ekranı `client_key` hatası verir ("Something went wrong").

Portalda uygulamanın sayfasında **Sandbox → Add account** ya da **Test Users → Add Test
User** bölümünü bul ve kanal hesabını ekle (TikTok o hesaba giriş yaptırıp Developer
Terms'i onaylatır). TikTok "sonuçlar bir saat içinde görünür" diyor; hemen çalışmazsa
biraz bekle. En fazla 10 hesap eklenebilir.

Uygulama incelemeden geçip **Live** moda alınırsa bu adım gereksizleşir; ama inceleme
çalışan bir entegrasyonun demo videosunu istediği için önce test kullanıcısıyla
çalıştırmak gerekir.

## Sonra (bunu birlikte yaparız)

`.env` dosyasına üç satır ekle:

```
TT_CLIENT_KEY=...
TT_CLIENT_SECRET=...
TT_REDIRECT=https://eyazan.github.io/youtube-otomasyon/
```

Sonra bir kez çalıştır:

```bash
node tiktok-yetki.js
```

Tarayıcıda izin verirsin, dönen adresi yapıştırırsın, `TT_REFRESH_TOKEN` `.env`'e yazılır.
Bu jeton **365 gün** geçerli (YouTube'un 7 günlük jetonunun aksine).

Son olarak GitHub → Settings → Secrets and variables → Actions altına üç secret ekle:
`TT_CLIENT_KEY`, `TT_CLIENT_SECRET`, `TT_REFRESH_TOKEN`. Ve `config/yetki.json`
değişikliğini commit et (sağlık kontrolü bu tarihi okuyup süre bitmeden uyarır).

## Günlük işleyiş

1. Günlük üretim videoyu yapar ve YouTube'a yükler (21:00'de otomatik yayın).
2. Başarılı üretim `PRODUCTION_RESULT_PATH` dosyasına gerçek slug, videoId,
   `publishAt`, MP4 yolu ve SHA-256 yazar. TikTok adımı bu sonucu doğrular ve
   YouTube için üretilen **aynı MP4'ü**, yeniden render etmeden inbox'a gönderir.
3. Ayrı bir adım, varsa YouTube'da olup TikTok'ta olmayan en eski **bir** videoyu
   daha inbox'a gönderir. Backlog bitince yalnızca bugünün videosu gider.
4. Telefonundaki TikTok bildirimine dokunur, açıklamayı görür, **Post**'a basarsın.
5. Her iki gönderim de bağımsız duplicate korumasından geçer. TikTok init'ten
   dönen `publishId`, durum sorgusundan önce `icerik/tiktok.json` içine yazılır;
   kesilen bir workflow bile aynı slug'ı ikinci kez gönderemez.

Sağlık kontrolü TikTok'u da izler; jeton bozulursa ya da bitmesine 30 gün kalırsa
GitHub bildirimi gelir. TikTok sorunu YouTube yayınını **durdurmaz**.

## Açıklama ve etiketler

`tiktok-yukle.js` her video için TikTok'a uygun bir metin üretir. YouTube açıklamasından
ayrıdır: bağlantı yok, kaynakça yok, kısa.

```
<Başlık — akışta görünen tek satır>

The cause: <mekanizma, tek cümle>

<Tartışma sorusu — yorum getiren kısım>

Synthetic narration. Footage is real archival film or licensed stock.

#FailureReconstructed #engineering #<küme> #<küme>
```

- **`#FailureReconstructed` her videoda var:** aramada ve profilde birikim oluşturur.
- **Küme etiketleri** `KUME_ETIKET` tablosundan gelir (uzay → `#space #nasa`, havacılık →
  `#aviation #planecrash` gibi). Toplam 4 etiket; TikTok'ta fazlası fayda etmiyor.
- **`#fyp` / `#foryou` kullanılmaz:** erişim getirmiyor ve spam sinyali veriyor.
- **Konum etiketi eklenmez:** içerik yerele bağlı değil, faydası yok.
- Metin, video gelen kutusuna düştüğünde GitHub bildiriminde **kopyalanmaya hazır** olarak
  gelir; telefondan kopyalayıp yapıştırırsın.

## Tam otomatik yayın (Direct Post) — şartları

Şu an video taslak olarak düşüyor, yayınlamak için bir dokunuş gerekiyor. Bunu kaldırmak
için TikTok'un `video.publish` kapsamı ve **uygulama onayı** gerekir:

1. Production tarafında eksik alanlar doldurulur (App icon 1024×1024 dahil).
2. Çalışan entegrasyonun demo videosu çekilir (artık elimizde var).
3. **Submit for review** → TikTok inceler.
4. Onaylanırsa `video.publish` açılır ve kod Direct Post'a çevrilir.

Onay gelmeden Direct Post açılırsa gönderiler **yalnızca gizli** olur — yani kimse görmez.
Bu yüzden onay gelene kadar gelen kutusu yolu daha iyidir.

## Bilmen gerekenler

- **TikTok açıklaması YouTube'unkinden farklı:** kısa, bağlantısız, en fazla 4 etiket.
  Her gönderide "Narration uses a synthetic voice" ibaresi var.
- **Yapay zekâ etiketi:** yayınlarken TikTok uygulamasındaki "AI-generated content"
  anahtarını **aç**. Seslendirme sentetik; bunu gizlemiyoruz.
- **TikTok'tan doğrudan gelir beklemeyelim:** Creator Rewards programı 1 dakikadan uzun
  videolar istiyor; bizimkiler ~28 saniye. TikTok'un faydası kitle ve takipçi.
- **Video boyutu:** tek parça gönderim sınırı 128 MB. Bizim videolar 10–40 MB.

## Hesap ve teslimat teşhisi

Actions → **Failure Reconstructed production** → operation `tiktok-diagnose` yeni video göndermeden tokenı yeniler, `video.upload` kapsamını doğrular, yetkilendirilmiş görünen hesap adını ve yalnızca SHA-256 hesap parmak izini gösterir, sonra kayıtlı her `publishId` için uzak durumu sorgular. Ham `open_id` ve tokenlar gösterilmez.

`TT_EXPECTED_OPEN_ID_SHA256` repo variable'ı yetkili Failure Reconstructed hesabına sabitlenmiştir. Token başka bir hesaba dönerse her yeni gönderim `TT_ACCOUNT_MISMATCH` ile upload init'ten önce durur.

28 Eylül canlı kontrolü: `failuredreconstructed` eşleşti; Hindenburg ve Bikini Baker `PUBLISH_COMPLETE`, Deepwater Horizon ve Tacoma Narrows `SEND_TO_USER_INBOX`. Son durum TikTok'un dosyayı taslak gelen kutusuna teslim ettiğini, herkese açık paylaşmadığını ifade eder. Uygulamada aynı hesaba geç, Inbox/Activities içindeki sistem bildirimini veya paylaşım taslağını aç ve manuel yayınla. Bildirimin görünmemesi yeniden gönderim gerekçesi değildir; kalıcı `publishId` duplicate guard ikinci kopyayı engeller.
