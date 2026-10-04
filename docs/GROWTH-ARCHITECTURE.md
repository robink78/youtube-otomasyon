# Growth architecture

> The four-channel growth engine (topic buckets, hooks, first 3 s, readiness gates, weekly long-form lane, Short→Long funnel, channel-isolated analytics and learning) is described in [GROWTH-ENGINE.md](GROWTH-ENGINE.md). This page covers the Failure Reconstructed packaging engines.

Failure Reconstructed is a **data-driven forensic engineering documentary production and growth system**. Automation handles the tedious parts (footage, voice, render, packaging, measurement). Quality and editorial value decide what gets published.

## 1. Two production formats, one packaging and quality layer

```
                    icerik/konular/<slug>.json  (script + CASE FILE "vaka")
                                   │
        ┌──────────────────────────┴───────────────────────────┐
   SHORTS (daily, GitHub Actions)                     LONG-FORM (every 5 days, local / ShortsLab)
   shorts-sira.js                                      python -m shortslab run <job>
     ├─ yayin-plani.js      cadence due?                 script  senaryo-claude.js  (+ story-structure brief)
   ├─ quality-gate.js     PRE gate  ── BLOCK ─▶ skip   voice   seslendir.js       (+ pronunciation dict, ## chapters)
     ├─ arsiv-bul / stok-bul footage + source metadata   visuals gorsel-bul.js      (evidence-first tiers + metadata)
     ├─ shorts-yap.js       render                          └─ engineering-visuals.js (4–8 diagrams into scenes)
     │     pacing · overlays · stamps · music profile     render  video-yap.js       (pacing plan, cold open, chapters,
     ├─ quality-gate.js     FINAL gate ── BLOCK ─▶ skip                                 disclosure labels, next-episode outro)
     └─ youtube-yukle.js    PUBLISH-only upload        publish thumbnail-strategy --render → quality-gate --final
                                                                → youtube-yukle.js (BLOCK stops it)
```

Short production is live. The long-form column describes the local components; the unattended, channel-aware **weekly long-form lane** (selection, research, script, quality gate, funnel; render/upload behind a per-channel switch) is documented in [GROWTH-ENGINE.md](GROWTH-ENGINE.md).

## 2. Packaging engines (per video → `icerik/paket/<slug>/`)

| Engine | Output | Purpose |
|---|---|---|
| `title-engine.js` | `titles.json` | ≥20 structurally distinct candidates, 11 scored criteria, support/clickbait check, channel-wide pattern penalty |
| `thumbnail-strategy.js` | `thumbnails.json`, `uretim/<slug>/thumbnails/*.jpg` | 3 Short concepts / 5 long-form concepts (≤4 words, mobile check), rotating primary layout, rendered from real frames |
| `hook-engine.js` | `hook.json` | first-30-second scoring (0–5 / 5–12 / 12–20 / 20–30 s), forbidden openers, draft hook from the case file |
| `scene-pacing.js` | `pacing.json` | role per scene → shot length, motion, transition, overlay |
| `story-structure.js` | `story.json` | adaptive sections, open loops that must resolve later, CTA placement (`ctaStrategy`) |
| `pronunciation-check.js` | `pronunciation-report.md` | dictionary matches, risky words, AI clichés |
| `description-engine.js` | `description.txt`, `tags.json` | summary, failure chain, credits, references, related episode, series, chapters, disclosure, ≤3 hashtags |
| `pinned-comment.js` | `pinned-comment.txt` | technical debate prompt + next-case request |
| `originality-check.js` | `originality.json` | 10 similarity measures vs the channel → PASS/REVIEW/BLOCK |
| `quality-gate.js` | `quality-gate.json/.md` | 9 components /100 → PUBLISH (≥85) / REVIEW (70–84) / BLOCK (<70) |

## 3. Channel structure & session growth

- **Clusters** (`lib/kutuphane.js`, `channel-plan.js`): 11 topic families. Each video gets previous/next, an end-screen/related video, a pinned-comment video, a description link and a playlist.
- **Playlists** (`youtube-playlist.js`): format series (existing), plus a cluster playlist once a cluster has ≥3 published videos. Playlist IDs are stored in `icerik/playlistler.json`.
- **Manual Studio actions** (the API cannot do these): pin the posted comment, set the Shorts "related video", and add long-form end screens. `channel/internal-linking-plan.md` lists them.

## 4. Measurement loop

```
 upload ──▶ icerik/yayinlananlar.json (slug ↔ videoId)
   │
   ├─ post-publish-analyzer.js --due   (daily)  → analytics/<id>/{1d,3d,7d,14d,30d}.json + report.md
   │                                             + analytics/kanal/<date>.json (subscriber growth)
   ├─ existing-video-optimizer.js --all (weekly) → analysis/<id>/optimization-report.md
   │                                             → migration/current-videos.json + EXISTING-VIDEOS-PLAN.md
   ├─ experiments.js (auto-logs title style on upload; ≥5/arm before any reading)
   └─ panel → /buyume.html (dashboard; low-confidence labels, "unavailable" never guessed)
```

- Sources: YouTube Data API (public counters), YouTube Analytics API (`yt-analytics.readonly`: watch time, % viewed, subscribers, traffic sources, retention curve) and optional manual Studio entries (impressions/CTR). The API does not expose these; manual entries are labelled as such.
- Diagnoses: `INSUFFICIENT_DATA`, `LOW_IMPRESSIONS_GOOD_RETENTION`, `HIGH_IMPRESSIONS_LOW_CTR`, `GOOD_CTR_LOW_RETENTION`, `GOOD_HOOK_WEAK_MIDDLE`, `HIGH_VIEWS_LOW_SUB_CONVERSION`, `SEARCH_DEPENDENT`, `NO_SUGGESTED_TRAFFIC`, `HIGH_SUGGESTED`, `SHORTS_FEED_NOT_PICKED_UP`, `WEAK_TOPIC_PACKAGING`, `OUTPERFORMER`, `HEALTHY`. Measured performance always outranks heuristic scores: an outperformer is never "repackaged".

### Retention rules learned from the channel (`lib/tutunma.js`)

Measured on 2026-09-25 from the YouTube Analytics audience-retention curves of the first four Shorts: the steepest drop is at 11–21 % of the video (~4–7 s), exactly the second sentence, which was a date/setting setup every time. The longest video (38 s) had the lowest average view percentage (47 %); the video with 75.6 % got the only large Shorts-feed push. Rules for every new Short, scored in the quality gate (SCRIPT −12 each) and enforced by a test for every unproduced topic:

1. **Second beat** — scene 2 is an event, escalation, countdown or casualty line, never a date/setting setup (the date stamp already shows it on screen).
2. **Length** — ≤ 80 words (~28–30 s).
3. **Archive opening** — scene 1 of an archive film has an explicit `baslangic` at the most striking moment of the film.

The production queue takes topics with real archive film first, then stock explainers.

## 5. Topic selection

`konu-puan.js` scores a topic on 11 criteria from free signals: Wikipedia pageviews and full text, Commons/NASA/archive.org counts, and YouTube search when authorised. `PRIORITY` = engineering depth ≥ 6 **and** audience appeal ≥ 6. It is used by `trend-ara.js`, `viral-analiz.js` and `node konu-puan.js --adaylar` (`icerik/aday-konular-puan.md`).

## 6. Publishing cadence

`yayin-plani.js` + `config/growth.json → publishing`: Shorts target every day. Failure Reconstructed's long-form target is five days and ImpossibleBrief's is seven days, but those long queue items are visibility signals until a production-grade long pipeline exists. Two BLOCKs in the last three real productions can stretch the interval. `REVIEW` is quarantined by spec hash and is never uploaded; the queue tries a different topic.

### Fixed publish time + notification

- Production has multiple GitHub-native attempts (`portfolio-production.yml`, `uretim.yml`, and `yayin-kontrol.yml`). They improve retry probability but are not independent of GitHub's scheduler. `production-watchdog.yml` supplies deadline recovery. True failure-domain independence begins only after the Cloudflare Worker in `ops/production-watchdog-worker` is deployed.
- If every one of them is dropped, `yayin-kontrol.yml` opens a "🚨 Bugün video üretilmedi" issue at 16:47 UTC with a one-click *Run workflow* link. It only fires when the queue is not empty and nothing was produced or scheduled for that day.
- The video is uploaded private with `status.publishAt`. YouTube makes it public at **18:00 America/New_York** (US evening; the audience was ~93 % US on 2026-09-25): 15:00 PT, and 01:00 TR during US daylight time / 02:00 TR in US winter time. `core/scheduling/calendar.js` keeps production on Istanbul days and reads the release in the publish zone (`publishTimeZone`), so a 01:00 TR release still belongs to the previous production day; DST is handled by the tz database.
- Only `PUBLISH` is uploadable/scheduled. `REVIEW` and `BLOCK` never leave the runner.
- `bildirim.js` opens a GitHub issue that @mentions the owner (email + GitHub mobile push). It gives the title, gate verdict, publish time, Studio link and how to cancel. Older "yeni-video" issues are closed automatically; blocked topics get a "kalite-engeli" issue.
- Once enough data exists, re-tune `hourUTC` from the dashboard's "Publish hour" pattern and the analytics country mix.

### Pre-publish visual check (every Short, before it is scheduled)

`shorts-yap.js` measures the rendered output with `lib/gorsel-denetim.js`. These are measurements, not guesses:

- **Text fit:** every on-screen text (hook, captions, question, date stamp) is sized to fit. The whole text layer is then rendered with the real font on black, and the left and right edge strips are measured frame by frame. If any text touches an edge, all text is shrunk 10 % and re-measured (up to 3 times).
- **Audio/video length:** a mismatch over 0.5 s is critical. On 2026-09-25 this caught a mux bug that produced 57 s of video with 19 s of audio.
- **Black frames and frozen picture:** blackdetect / freezedetect.
- **Loudness:** measured at the final gate. The mix is normalised to −14 LUFS; it was −22 before.
- **Preview:** an 8-frame contact sheet (`icerik/paket/<slug>/onizleme.jpg`) is embedded in the GitHub notification, so you can check the video from your phone before the US-evening publish.

Any critical finding (text still overflowing, A/V mismatch, >1.5 s of black) makes the final gate **BLOCK**. The video is not uploaded and you get a "kalite-engeli" notification. Stock footage gets the channel's **strong documentary grade** (`config/growth.json → renk.stok`: colour halved, cool steel shadows). It sits with the archival films but stays clearly colour: modern stock is never disguised as historical black-and-white film. Archival film keeps its original tone.

## 7. Configuration & state

| File | Role |
|---|---|
| `config/growth.json` | brand, `ctaStrategy`, disclosure, gate thresholds and weights, cadence, originality thresholds, analytics checkpoints |
| `config/pronunciation.json` | pronunciation dictionary, known words, banned clichés |
| `icerik/konular/*.json` | scripts + case files (`vaka`: cluster, mechanism, chain, timeline, misconception, debate, editorial titles, thumbnail text, references) |
| `icerik/yayinlananlar.json`, `kaynak-defteri.json`, `kalite-kayitlari.json`, `engellenen.json`, `playlistler.json`, `sabit-yorumlar.json` | durable state (committed back by Actions) |
| `icerik/tiktok.json` | which videos were sent to the TikTok inbox (no video is sent twice) |
| `config/yetki.json` | when YouTube/TikTok were authorised, so the health check can warn before expiry |
| `.env` | secrets only (never committed) |

## 8. Daily GitHub Actions run (`.github/workflows/uretim.yml`)

1. `saglik.js` (per-channel upload gate): live YouTube refresh, exact scopes and expected identity, recorded Testing-mode re-authorization deadline (warning ≤7 days, critical ≤48 hours, expired after deadline), channel-appropriate services, and channel-specific inventory. `oauth-health.js --check-all` is the aggregate report; a production OAuth app has no invented fixed deadline.
2. `shorts-sira.js`: cadence → health gate → pre gate → footage (licence-checked) → render → final gate → private upload with `publishAt`.
   - If the upload is impossible (token expired), **no topic is consumed**.
   - A failed upload leaves the topic in the queue and writes `YUKLEME-HATASI.json`.
3. `bildirim.js`: notifications (see §9).
4. `tiktok-yukle.js` (optional): sends the same MP4 to the TikTok inbox. Without TikTok credentials the step is silently skipped, and a TikTok failure never breaks the day — YouTube is already published. See `docs/TIKTOK.md`.
5. `post-publish-analyzer.js --due`, `pinned-comment.js --post-pending`, `channel-plan.js`, `experiments.js degerlendir`, and on Mondays `existing-video-optimizer.js --all`. Comment replies are decoupled from production and run every four hours through `.github/workflows/yorum-yanitla.yml`.
6. State is committed back with a 5-attempt pull/rebase/push loop.
7. On failure, a "🚨" issue is opened.

**Queue order** (`lib/kutuphane.kuyruk()`): real archive film before stock explainers, then the editorial `oncelik` (higher first), then alphabetical.

**Scheduling safety:**
- `lib/zamanlama.sonrakiSlot` never puts two videos on the same day. A delayed run that already filled tomorrow's 18:00 slot pushes the next video on.
- `yayin-plani` counts `publishAt` as the publish moment.

**Duplicate guard:** before uploading, `youtube-yukle.js` looks for the same title among the channel's uploads. If it finds one, it records it and skips the upload.

**Upload validation:** `metaDogrula` checks YouTube's limits before sending (title ≤ 100, description ≤ 5000 bytes, tags ≤ 500, no `<>`, `publishAt` only on private and in the future).

**Archival photographs:** public-domain disaster *film* is scarce (roughly 30-40 events),
but *photographs* are plentiful — Titanic, Texas City, the Hartford circus fire, the Empire
State Building B-25 crash. A source whose filename ends in `.jpg/.jpeg/.png/.webp` is treated
as a still: `shorts-yap.js` feeds it with `-loop 1` and applies a slow zoom plus a small pan
(Ken Burns), alternating direction per shot so consecutive stills never move the same way.
The licence guard is identical to film, and the retention rule that demands an explicit
opening timestamp does not apply to stills (they have none). This is how the library scales
without falling back on generic stock footage. Example: `boston-molasses-1919`.

**Finding candidates at scale (`aday-gorsel.js`):** the bottleneck in growing the library
was research — searching Commons per case, opening each file to read its licence, checking
resolution. This script does that mechanical part and prints a verdict per event
(`node aday-gorsel.js --liste olaylar.txt`). It rejects anything that is not Public
domain / CC0 / CC BY (the same rule as `arsiv-bul.js`, asserted identical by a test),
anything under 800 px, and anything that is not the event itself: memorials, markers, maps,
collages, portraits — and images of the dead or injured, which this channel does not show.
Editorial judgement stays human: whether the case suits the channel, and which frame opens it.
A scan of 40 historical failures found 31 with six or more usable public-domain images.

**Stereographs:** most 1900s photographs in the Library of Congress are stereo cards — two
near-identical frames side by side on a grey mount with a white scan border. Dropped into a
vertical Short they look like two small pictures. `arsiv-bul.js` compares the two halves with
SSIM (measured: a card scores 0.45-0.55, a single photograph 0.17) and, above 0.35, crops out
the left photograph. Set `"stereo": false` on a source to skip it. This matters because the
LoC holds thousands of usable public-domain disaster stereographs.

**Licence guard:** `arsiv-bul.js` only accepts Public domain / CC0 / CC BY. It rejects SA, NC, ND and unknown licences. With `"kalite": "480p"` on a source, it downloads Commons' ready-made transcoded copy instead of a multi-hundred-MB original. Check the size first, because a transcoded copy can be larger than a low-resolution original.

**Tags:** tags never contain `,`, `<` or `>`, since a comma would make YouTube reject the upload; a test covers every topic.

**Captions:** captions keep decimal points and thousands separators inside numbers (`1.4`, `2,500`).

**Dry run on the real infrastructure:** Actions → *Shorts uretim* → Run workflow → `kuru: true` (optional `slug`). This runs the full production with the real secrets and real downloads, then `e2e-kontrol.js`. Nothing is uploaded, committed or notified.

`.github/workflows/yayin-kontrol.yml` runs at 16:47, 18:27 and 19:53 UTC. It raises the empty-day alarm and confirms that the scheduled video actually went Public.

## 9. Notifications (`bildirim.js`, GitHub issues → e-mail + GitHub mobile app)

Each video has **one** issue that follows its whole life:

| When | What |
|---|---|
| Produced + scheduled | issue 🎬: preview contact sheet, pre-publish check, quality gate, publish time |
| Went Public | comment ✅ with first views (`--yayin-kontrol`); separate ❌ issue if it did not go public within 1 h |
| 24 h / 3 d / 7 d / 14 d / 30 d | comment 📈: views, likes, comments, average % viewed, net subs, Shorts-feed share, **the second where most viewers leave** (retention curve), diagnosis |

Other notifications:

- ❌ upload failed, with step-by-step re-authorisation instructions when the token expired
- ⛔ quality-gate block
- 🩺 **system health**: a single issue that is updated when the state changes and closed automatically when resolved
- 🚨 workflow crash
- 📊 weekly summary every Monday: subscriber/view change, the week's videos, the next 7 topics, health

`icerik/bildirim-durum.json` prevents duplicates.

## 10. Tests

- `test.yml`, on every push/PR: JS + Python unit tests. These include the retention rules for every unproduced topic, scheduling, upload validation, health and notification text.
- `test.yml`, on every PR: **end-to-end production in parallel** for two fixed samples (archive + stock) and **every topic added or changed in the PR**. It runs `shorts-sira.js` with no upload, then `e2e-kontrol.js`, which checks 26 items: video/audio format, loudness, overflow/black/freeze, stamp/panel overlap, final gate, retention rules, description/tags/pinned comment, upload metadata, notification text.
