# ShortsLab v0.1

Bu klasor, video motorunun ustune eklenecek arastirma ve deney katmaninin ilk
dikey dilimidir. Ilk arac, niche adaylarini ayni karar modeliyle siralar.

## Niche scoring

Her sinyal `0-100` araligindadir. Varsayilan agirliklar:

| Sinyal | Agirlik |
|---|---:|
| Trend velocity | 25% |
| Low competition | 20% |
| Global audience | 15% |
| Shorts suitability | 15% |
| Monetization potential | 10% |
| Content supply | 10% |
| Production efficiency | 5% |

`competition` ve `production_cost` girdileri ters cevrilir. `confidence`, ham
firsat puanini degistirmez; eksik veya zayif veriyi adjusted score uzerinden
cezalandirir. Boylece tahmin ile canli veriyi birbirine karistirmayiz.

Demo:

```bash
python3 -m shortslab rank \
  --input shortslab/data/demo-niches.json \
  --output shortslab/output/niche-ranking.json \
  --markdown shortslab/output/niche-ranking.md \
  --top 3
```

Test:

```bash
python3 -m unittest discover -s tests -v
```

`demo-niches.json` icindeki degerler sadece calisan ornektir; canli pazar
arastirmasi degildir ve kanal seciminde nihai veri olarak kullanilmamalidir.

## Sonraki adim

`trend-ara.js` ve `viral-analiz.js` ciktisini ortak JSON olay semasina almak;
ardindan sinyalleri son 30/90 gunluk gercek veriden hesaplayip bu scorer'a
beslemek.

## Canli Shorts kesfi (Python 3.10+)

VIDIQ_KEY ortam degiskeni gereklidir. Anahtari sohbet, CLI argumani veya git
icerisine yazmayin. Mevcut panelin .env dosyasi bu Python araci tarafindan
otomatik okunmaz. Ek Python paketi gerekmez.

```bash
python3 -m shortslab.discovery \
  --query 'engineering facts' --query 'AI infrastructure' \
  --language en --limit 12 --output shortslab/output/discovery-001.json
```

Her sorgu icin kaynak, UTC toplama zamani, tekillestirilmis video kayitlari,
provider VPH ortancasi ve veri eksikleri kaydedilir. Bos sonuc ile servis hatasi
ayridir. Bir sorgu hata verirse digerleri korunur ve komut exit code 1 doner.
Mevcut raporun uzerine yazilmaz. Her istek en fazla 60 saniye bekler.

Bu rapor `rank` girdisi **degildir**. Trend listesindeki 12 video tum pazari
ve rekabeti temsil etmez. Gelir, retention ve izleyici ulkesi bu servisten
olculmus sayilmaz. Canli raporu demo puanlara otomatik donusturmuyoruz.
Nis karari icin farkli zamanlarda tekrar olcum ve insan degerlendirmesi gerekir.
# Production runner

See [PRODUCTION.md](PRODUCTION.md) for the resumable local pipeline, prerequisites,
commands and current limitations (archival stills; no 3D or YouTube upload yet).
