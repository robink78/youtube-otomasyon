# Üretim kuyruğu

Zamanlanmış çalışma (3 günde bir, GitHub Actions) buradaki işleri sırayla üretir.
Her `.json` **senin onayladığın** bir iştir — araç kendi başına konu seçmez.

## İş dosyası biçimi

`kuyruk/<ad>.json`:

```json
{
  "slug": "concorde-neden-coktu",
  "title": "Why Concorde Crashed",
  "brief": "Doğrulanmış olgular ve kaynaklar; anlatı gereksinimleri.",
  "narration": "kuyruk/concorde.txt"
}
```

- `slug` — küçük harf, rakam ve tire. Çıktı `uretim/<slug>/` altında durur.
- `title` — YouTube başlığı (yükleme metni ayrıca `uretim/<slug>/YUKLEME.json` ile geçilebilir).
- `brief` — konunun kısa özeti / kaynak notu.
- `narration` — **isteğe bağlı** yerel anlatı metni. Verilirse senaryo bundan
  kurulur (ücretsiz). Verilmezse ücretli senaryo üretimi gerekir
  (`ANTHROPIC_API_KEY` + `ANTHROPIC_MODEL`).

## Nasıl işlenir

- En eski `.json` alınır, uçtan uca üretilir (senaryo → ses → görsel → render).
- Yükleme yalnızca iki koşul birden sağlanırsa yapılır: repo değişkeni
  `PUBLISH=1` **ve** `YT_*` kimlik bilgileri tanımlı. Yükleme her zaman
  **private** olur; herkese açmayı sen YouTube Studio'dan yaparsın.
- İşlenen `.json`, `kuyruk/islenen/` altına taşınır.

## Elle çalıştırma

```bash
python3 -m shortslab.kuyruk          # sadece en eski işi üret
python3 -m shortslab.kuyruk --hepsi  # kuyruğun tamamını üret
```
