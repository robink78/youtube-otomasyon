# Implementation report — forensic documentary growth system

Date: 2026-09-24 · Branch: `feat/forensic-growth-system` · Hot-fix on `main`: `4e5e1a0`

## Architectural decisions

1. **Keep the live daily Shorts automation and build around it.** The channel's live format is daily Shorts, while the brief targets long-form documentaries every 5 days. Both are supported: the Shorts pipeline (`shorts-sira.js` → `shorts-yap.js`) and the long-form pipeline (ShortsLab → `video-yap.js`) share one packaging, quality and analytics layer.
2. **A case file per topic (`vaka`).** Titles, thumbnails, hooks, diagrams, descriptions, pinned comments and originality all need structured facts. Each topic JSON now has mechanism, failure chain, timeline, misconception, debate question, editorial titles, thumbnail text and verified references. Every engine draws only from this data, so nothing is invented.
3. **Heuristics guide, measurements decide.** Title/hook/gate scores are transparent heuristics stored in full. Measured performance (e.g. `OUTPERFORMER`) overrides them. Unavailable metrics stay unavailable.
4. **No SaaS added.** The system uses Node built-ins, local ffmpeg, free public APIs (Wikipedia, Commons, NASA, archive.org) and the existing YouTube OAuth client. vidIQ stays optional.
5. **Recommend, don't mutate.** Nothing deletes, re-uploads or silently retitles. Uploads stay private.

## Files created

| File | Purpose |
|---|---|
| `lib/ortak.js`, `lib/metin.js`, `lib/ayar.js`, `lib/kutuphane.js`, `lib/yt.js`, `lib/analitik.js`, `lib/muzik.js`, `lib/sahne.js` | shared helpers: env/JSON, text similarity, config defaults, topics/clusters/registry, YouTube Data + Analytics client, metrics + diagnoses, music profiles, scene/chapter rule |
| `config/growth.json`, `config/pronunciation.json` | growth/quality settings; pronunciation dictionary + cliché list |
| `title-engine.js` | documentary title engine (Phase 3) |
| `thumbnail-strategy.js` | thumbnail concepts + rendering (Phase 4) |
| `hook-engine.js` | first-30-seconds engine (Phase 5) |
| `scene-pacing.js` | narrative-driven pacing (Phase 6) |
| `engineering-visuals.js` | forensic visual layer (Phase 7) |
| `pronunciation-check.js` | pronunciation validation + TTS substitution (Phase 10) |
| `story-structure.js` | adaptive structure, open loops, `ctaStrategy` (Phases 11–12) |
| `channel-plan.js` | clusters + internal linking (Phase 13) |
| `pinned-comment.js` | debate pinned comments (Phase 14) |
| `description-engine.js` | descriptions (Phase 15) |
| `originality-check.js` | originality score (Phase 16) |
| `konu-puan.js` | topic scoring (Phase 17) |
| `yayin-plani.js`, `quality-gate.js` | adaptive cadence + quality gate (Phases 18, 25) |
| `post-publish-analyzer.js` | checkpoint analysis (Phase 19) |
| `dashboard-veri.js`, `panel-public/buyume.html` | growth dashboard (Phase 20) |
| `experiments.js` | experiment framework (Phase 21) |
| `existing-video-optimizer.js` | existing-video analysis + migration plan (Phases 2, 23) |
| `docs/CHANNEL-AUDIT.md`, `docs/YOUTUBE-CONTENT-QUALITY.md`, `docs/GROWTH-ARCHITECTURE.md`, `docs/IMPLEMENTATION-REPORT.md`, `channel/BRAND.md` | documentation (Phases 1, 22, 24, final) |
| `tests/js/engines.test.js`, `tests/js/syntax.test.js`, `.github/workflows/test.yml` | tests + CI |
| Generated from real data: `icerik/yayinlananlar.json`, `icerik/paket/*`, `channel/topic-clusters.json`, `channel/internal-linking-plan.md`, `analysis/*/optimization-report.md`, `analytics/*`, `migration/current-videos.json`, `migration/EXISTING-VIDEOS-PLAN.md`, `experiments/*`, `icerik/aday-konular.json`, `icerik/aday-konular-puan.md` | outputs |

## Files modified

| File | Change |
|---|---|
| `icerik/konular/*.json` (30) | case files (`vaka`) with verified references; 5 factual corrections; 2 published-video verification notes |
| `shorts-sira.js` | pre/final quality gates, BLOCK registry with spec-hash retry, cadence check, skip already-uploaded slugs |
| `shorts-yap.js` | pronunciation-aware TTS, role-based sub-shots with punch/push/drift, frame-accurate timing, failure-chain overlay, date/location stamp, reconstruction label, cluster music profile, scene timing + ledger output |
| `stok-bul.js`, `arsiv-bul.js` | per-scene source metadata (URL, organisation, licence, search term, relevance), channel-wide Pexels dedupe, source ledger |
| `gorsel-bul.js` | evidence-first source tiers, generic-search narrowing, Commons URL bug fix, per-image metadata (`Visuals/kaynaklar.json`), engineering visuals in the visuals stage |
| `video-yap.js` | narration-synced pacing plan, per-boundary transitions, diagram handling, reconstruction label, cold-open defaults, chapters (`Videos/bolumler.json`), next-episode outro, per-video music key |
| `seslendir.js` | `## SECTION` handling (chapters), pronunciation dictionary, default voice Andrew |
| `senaryo-claude.js` | documentary rules + story brief; keeps section headings |
| `youtube-yukle.js` | title from the title engine, description/tags from the description engine, registry write, cluster playlist, long-form thumbnail upload, `containsSyntheticMedia`, experiment auto-log |
| `youtube-guncelle.js` | description engine, keeps the live title by default, `--dogrula`, snippet backup |
| `youtube-playlist.js` | playlist-ID registry, cluster playlists at ≥3 videos |
| `youtube-yetki.js` | adds the `yt-analytics.readonly` scope |
| `trend-ara.js`, `viral-analiz.js` | Failure Reconstructed topic score section; viral-analiz works without vidIQ for scoring |
| `panel.js`, `panel-public/panel.html` | `/api/buyume` + dashboard link |
| `ff-yol.js` | longer check for explicit binaries |
| `shortslab/production.py`, `tests/test_publish.py` | chapter-aware voice count, Andrew default, thumbnails + final gate before publish (BLOCK stops it), new test |
| `.github/workflows/uretim.yml` | `PEXELS_KEY`, analysis/pinned/cluster/experiment steps, weekly optimizer, state commit-back |
| `package.json` | test/gate/optimize scripts |

## Problems found → fixes

See `docs/CHANNEL-AUDIT.md`. The most important:

- **C1** `PEXELS_KEY` was missing in Actions → hot-fixed on main.
- **C2** duplicate upload of Tacoma → registry + skip.
- **C3** every Commons image was being discarded → fixed.
- **C4** factual errors → corrected.
- **C5** no gate → quality gate + cadence.

## Verification performed

- JS tests: 18/18 (engines + `node --check` on every JS file + config/topic JSON validation).
- Python tests: 24/24 (one new: a gate BLOCK stops publishing).
- Real Shorts render (`tacoma-narrows`, 30.5 s, 1080×1920). Frames checked: hook, date stamp, failure-chain overlay (the transparent-box bug was found and fixed), lesson scene.
- Real long-form render (`test-uzun-tacoma`, 1:05). Checked: 5 chapters, 15 narration-synced shots, 4 diagrams, public-domain archive images, cold open, brand outro. Diagram/subtitle overlap was found and fixed.
- Live API (read-only): 4 videos matched to slugs, optimizer and checkpoint reports written, dashboard rendered in the browser.
- Topic scoring on 14 flagship cases with real Wikipedia/Commons/NASA/archive.org/YouTube signals.

## Remaining risks

1. **OAuth refresh token (Testing mode) expires around 2026-09-30.** Uploads and analytics stop until you re-authorise with `node youtube-yetki.js` and update the `YT_REFRESH_TOKEN` secret. The re-auth also grants the new `yt-analytics.readonly` scope; add it under Google Cloud → OAuth consent → Data access first. Moving to Production (or a fresh Cloud project) removes the 7-day expiry.
2. **Analytics are currently public counters only** (no watch time, retention or traffic) until that re-auth. Diagnoses are limited accordingly and are labelled that way.
3. **Heuristic scores** (title, hook, gate) are editorial aids, not predictions. Calibrate the thresholds in `config/growth.json` once ≥20 videos have 7-day data.
4. **Shorts thumbnails** cannot be set meaningfully via the API. The opening frame and the on-screen hook do that job.
5. **Comment replies stay template-based** and run independently every four hours (capped at 4/run). Consider reducing or switching to manual if they start to look repetitive.
6. **Manual Studio steps** remain: pinning comments, the Shorts "related video" link and long-form end screens.
7. **The long-form pipeline needs a script source**: a hand-written script or `ANTHROPIC_API_KEY` for `senaryo-claude.js` (a paid API). The daily Shorts are fully free.
8. The render adds zoompan on push/drift shots, which makes a Short take ~1m40s to render locally. This is fine on Actions (120 min timeout).

## Recommended next work

1. Re-authorise (risk 1) before 2026-09-30, then run `node existing-video-optimizer.js --all` for full analytics.
2. Review and apply the improved descriptions to the 4 live videos:
   ```bash
   node youtube-guncelle.js PGOKZhPYo7c hindenburg --dogrula
   ```
   (repeat for the others), then run without `--dogrula`. Titles stay unchanged. Pin the debate comments after `node pinned-comment.js --post-pending`.
3. Write case files and footage plans for the top-scored flagship topics (`icerik/aday-konular-puan.md`: Chernobyl, Titanic, Challenger, Fukushima). NASA Challenger/Columbia footage is public domain. Start the first long-form documentary from one of them.
4. Rewrite the 6 "That is why…" closings in the queued scripts.
5. After ~20 videos with 7-day data: read `experiments/EXPERIMENTS.md` and the dashboard patterns, then tune the title/hook weights.
