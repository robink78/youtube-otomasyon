# Failure Reconstructed — channel & repository audit

Audit date: 2026-09-24. Scope: every production path in the repository (`panel.js`, `senaryo-yaz.js`, `senaryo-claude.js`, `gorsel-bul.js`, `gorsel-uret.js`, `seslendir.js`, `video-yap.js`, `baslik-analiz.js`, `trend-ara.js`, `viral-analiz.js`, the live Shorts pipeline `shorts-sira.js` → `arsiv-bul.js`/`stok-bul.js` → `shorts-yap.js` → `youtube-yukle.js`, playlists, comment replies, ShortsLab, the GitHub Actions schedule) plus the four videos that are live on the channel.

The central question was: **what makes videos feel mechanically identical, inaccurate, or low-value — and what stops the channel from growing?**

Every issue below lists the current (pre-fix) behavior, why it hurts, where it lives, the fix, and its status. "Fixed" means implemented and tested in this change set.

---

## CRITICAL

### C1 — Daily automation could not produce stock topics and would have marked them failed forever
- **Behavior:** `.github/workflows/uretim.yml` passed `YT_*` secrets but **not `PEXELS_KEY`**. `stok-bul.js` exits without it; `shorts-sira.js` then writes the slug to `icerik/basarisiz.json` permanently. 24 of 30 topics are stock topics.
- **Why it hurts:** the library would silently shrink to the archive topics; the "one year of daily content" plan would stop within days.
- **Where:** `.github/workflows/uretim.yml`
- **Fix:** secret passed to the job. Hot-fixed on `main` (commit `4e5e1a0`) one minute before the 16:00 UTC run.
- **Status:** Fixed.

### C2 — Duplicate upload risk: no record linking productions to YouTube videos
- **Behavior:** Tacoma Narrows was uploaded manually and never added to `icerik/uretilenler.json`. Once the stock topics failed (C1), the queue would reach `tacoma-narrows` and **upload the same video a second time**. Nothing in the repo knew which slug was which video ID.
- **Why it hurts:** duplicate uploads are exactly the "mass duplicate / reupload" pattern YouTube's spam and reused-content policies target. It also splits views between two copies.
- **Where:** `shorts-sira.js` (queue), `youtube-yukle.js` (no registry)
- **Fix:** new registry `icerik/yayinlananlar.json`. The uploader writes to it; `existing-video-optimizer.js --sync` back-filled all four live videos; the queue now skips any registered slug. Tacoma is also marked produced on `main`.
- **Status:** Fixed.

### C3 — Long-form visual search silently discarded every Wikimedia Commons result
- **Behavior:** `gorsel-bul.js` accepted Commons images only if the URL ended in `.jpg/.png`. Commons now appends `?utm_source=…` to every URL, so **all** archival/public-domain results were dropped. Every long-form video fell back to Pexels/Pixabay stock without any warning.
- **Why it hurts:** a forensic engineering channel turned into a generic stock-photo slideshow, which is the single biggest "faceless AI channel" signal.
- **Where:** `gorsel-bul.js` → `wikimedia()`
- **Fix:** the extension is now checked on the path without the query string, historic photos down to 640 px are accepted, and a contact-URL User-Agent is sent. Test job result: before the fix 15/15 images were stock; after it, 10 public-domain, 2 CC, 3 stock.
- **Status:** Fixed.

### C4 — Factual errors in unpublished scripts, and unhedged claims in two published ones
- **Behavior (unpublished, now corrected):**
  - *Halifax*: "thousands more are blinded by flying glass". About 9,000 were injured; permanent blindness affected far fewer.
  - *Why bridges collapse*: called the failure mechanism "resonance". That contradicts the channel's own Tacoma video: flutter is the accurate term.
  - *Floods*: "a foot of water can carry away most cars". The NWS guidance is that 12 in floats many cars and 2 ft carries most away.
  - *House fires*: "deadly in under a minute" was changed to "as little as two minutes".
  - *Explosions*: "blasts throw people in both directions" and "survivors are the ones lying flat" were unsupported and have been replaced.
- **Behavior (published):**
  - *San Francisco 1906* states that fire "did most of the killing". The sources support fire causing most of the *destruction*.
  - *Hindenburg* states the spark as fact; static discharge is the leading theory, not a proven cause.
- **Why it hurts:** a forensic channel's value is accuracy. Errors also make titles and claims "misleading" under the content-quality rules.
- **Where:** `icerik/konular/*.json`
- **Fix:** scripts corrected. Every topic now has a case file (`vaka`) with Wikipedia references (URLs checked), which the description engine turns into "Technical references". The two published videos carry a `dogrulama` note, and the migration plan marks them `REVIEW_MANUALLY`: clarify in the pinned comment and description, never re-upload.
- **Status:** Fixed (published clarifications await a human decision).

### C5 — No quality gate: whatever rendered was uploaded
- **Behavior:** `shorts-sira.js` rendered and uploaded the next topic on schedule, regardless of quality.
- **Why it hurts:** the schedule took priority over quality, which is the opposite of the channel's goal.
- **Fix:**
  - `quality-gate.js` scores nine components and returns PUBLISH / REVIEW / BLOCK. It runs before render (script level) and after render (with measured loudness, resolution and duration).
  - A BLOCK result is never uploaded. It is logged to `icerik/engellenen.json` and retried automatically when the spec changes.
  - `yayin-plani.js` enforces the cadence and stretches it after repeated real BLOCKs.
- **Status:** Fixed.

---

## HIGH

| # | Current behavior | Why it hurts | Where | Fix | Status |
|---|---|---|---|---|---|
| H1 | Long-form: every image got the same duration (`TOTAL/N`), and images were spread over the whole voice track without regard to which paragraph they belonged to | rigid "image → wait 8 s → transition" rhythm; visuals drift away from the narration | `video-yap.js` §3 | scene folder N = narration scene N (shared rule in `lib/sahne.js`). Scene times are measured from the voice parts; shot length, motion and transition come from `scene-pacing.js` (event 2–3 s, technical 7–10 s, diagrams 10–15 s, cut-like 0.15 s vs 0.8 s dissolves) | Fixed |
| H2 | Long-form opened with a 5 s film-leader countdown, an 8 s logo animation and a topic card, i.e. 13–15 s before the story | viewers decide in the first 5 s; a logo intro is the classic retention killer | `video-yap.js` defaults | cold open by default (intro/countdown/topic card = 0 unless requested in `konu.json`) | Fixed |
| H3 | Every long video ended on the same "SUBSCRIBE / TURN ON NOTIFICATIONS / New documentaries every week" card | identical CTA in an identical position; generic | `video-yap.js` outro | outro shows **Next reconstruction: \<cluster episode\>** plus the brand line, with room for end-screen elements. The subscribe ask is contextual and spoken after the payoff (`story-structure.js`, `ctaStrategy`) | Fixed |
| H4 | Music: long-form always played the same Am-F-C-G bed; Shorts had only 6 root notes, and everything else was identical | recognisably repetitive audio across the channel | `video-yap.js`, `shorts-yap.js` | `lib/muzik.js`: the Shorts profile varies by cluster mood and slug (interval, tremolo, noise colour, echo, low-pass). Long-form is transposed −3…+3 semitones per video. `originality-check.js` measures music similarity | Fixed |
| H5 | All 4 live videos have one-line descriptions with 5 hashtags and no sources, references, related episode or synthetic-voice disclosure | weak attribution, no session growth, no transparency | `youtube-yukle.js` (took `konu.aciklama` verbatim) | `description-engine.js`: summary, failure chain, footage credits with licences, technical references, related episode, series, chapters (long-form), disclosure line, ≤3 hashtags, relevant tags only. The uploader uses it; `youtube-guncelle.js` can apply it to live videos (dry-run first, keeps the live title, backs up the old snippet) | Fixed for new uploads; live videos pending your approval |
| H6 | No performance data anywhere: no analytics, no registry, OAuth scope lacked `yt-analytics.readonly` | growth decisions were guesses | — | `lib/yt.js`, `lib/analitik.js`, `existing-video-optimizer.js`, `post-publish-analyzer.js` (24 h/72 h/7 d/14 d/30 d), channel snapshots, dashboard. The scope was added to `youtube-yetki.js` and takes effect at the next re-authorisation. Unavailable metrics are always marked unavailable | Fixed (needs re-auth for Analytics) |
| H7 | Shorts shared one template: on-screen hook → 9 equal-rhythm scenes → amber question; the Hindenburg and Vesuvius role sequences are identical | "mass-produced" feel | `shorts-yap.js` | role-based sub-shot cuts with punch-in/push/drift, a failure-chain overlay on the technical scene, a date/location stamp on case videos, cluster music; `originality-check.js` flags structure repeats (it currently flags Hindenburg ↔ Vesuvius) | Fixed / monitored |
| H8 | No engineering visuals at all | stock slideshow instead of an investigation | — | `engineering-visuals.js`: failure chain, timeline, root cause, myth vs evidence, key number, what changed, critical decision, warning signs. All are drawn from case-file data only. 4 per case in long-form, placed in the matching scene; overlay in Shorts | Fixed |
| H9 | Titles were hand-written or keyword-SEO (vidIQ), with no scoring and no check for repetition | "X Explained" titles; similar patterns across the channel | `baslik-analiz.js` | `title-engine.js`: ≥10 candidates, 11 criteria, a support check against the script (clickbait risk), a channel-wide pattern penalty; only human-written candidates are auto-selected | Fixed |
| H10 | The script writer prompt was a generic "faceless documentary" with no structure, no open loops, no CTA rules and no ban on clichés; the default voice was Christopher (rejected as robotic) | AI-sounding narration | `senaryo-claude.js`, `seslendir.js`, `shortslab/production.py` | the documentary brief from `story-structure.js` (adaptive sections, open loops that must resolve, CTA placement, banned phrases, `## SECTION` headings that become chapters). The default voice is now Andrew | Fixed |

---

## MEDIUM

| # | Issue | Where | Fix / status |
|---|---|---|---|
| M1 | No thumbnail generator; long-form would ship auto-frames | — | `thumbnail-strategy.js`: 3 concepts per video (≤4 words, mobile check, layout rotated channel-wide) rendered from the video's own frames. The long-form upload sets concept 1 via `thumbnails.set`. **Fixed** |
| M2 | No pronunciation control (O-ring, RBMK, Vajont, Puget…) | `seslendir.js`, `shorts-yap.js` | `config/pronunciation.json` + `pronunciation-check.js`. The report is written before TTS; the dictionary is applied to the voice only, captions keep the original spelling. **Fixed** |
| M3 | Playlists were two format series; no topic clusters or internal links | `youtube-playlist.js` | 11 clusters. `channel/topic-clusters.json` and `channel/internal-linking-plan.md` give previous/next/end-screen/pinned/description links. A cluster playlist opens at 3 published videos. **Fixed** |
| M4 | Comment replies are template pools | `yorum-yanitla.js` | Kept (8/day cap, categories). Added technical-debate **pinned comments** per video (`pinned-comment.js`). The API cannot pin, so pinning is one click in Studio. **Partially addressed** — replies remain templated (see risks) |
| M5 | The on-screen question always appears in the same place at the end | `shorts-yap.js` | Kept as the conversion device; variety now comes from overlays and stamps. The CTA-position experiment is defined in `experiments.js`. **Monitored** |
| M6 | Weak source attribution: only non-CC0 images were listed; no relevance or search-term record | `gorsel-bul.js`, `stok-bul.js`, `arsiv-bul.js` | Per-scene/per-image metadata: URL, organisation, licence, search term, relevance, priority tier, synthetic flag. Pexels clips used in other videos are excluded channel-wide. **Fixed** |
| M7 | Topic discovery optimised for viral outliers only; `viral-analiz.js` exited without a vidIQ key | `trend-ara.js`, `viral-analiz.js` | `konu-puan.js`: 11-criterion score from free signals (Wikipedia pageviews + full text, Commons/NASA/archive.org counts, YouTube search when authorised). Both reports now include it. `icerik/aday-konular-puan.md` ranks the 14 flagship cases. **Fixed** |
| M8 | Repeated sentence pattern: 8 scripts use "That is why …" (6 as their closing beat) | `icerik/konular/*.json` | Flagged here for editorial variation in future scripts. The story brief now counts the repeat and asks for a different closing beat. **Open (editorial, existing scripts)** |
| M9 | `ff-yol.js` treated a slow first launch of a static ffmpeg (macOS scan) as "not installed" | `ff-yol.js` | Explicit `FFMPEG_YOL` paths get 45 s. **Fixed** |
| M10 | The Shorts scene cut timing used `-t` seconds per clip, so rounding drift accumulated against the voice | `shorts-yap.js` | Frame-accurate boundaries (`-frames:v`). **Fixed** |

---

## LOW

| # | Issue | Where | Status |
|---|---|---|---|
| L1 | Dead constant `ENDCARD` after the end card was removed | `shorts-yap.js` | Removed |
| L2 | `marka-yap.js` hard-codes Windows font paths | `marka-yap.js` | Open. Branding was produced separately; use `VIDEO_FONT*` if it is re-run |
| L3 | The panel's "open folder" uses `explorer.exe` (Windows only) | `panel.js` | Open (local convenience only) |
| L4 | `icerik/basarisiz.json` blocks a topic forever after one failure (Halifax) | `shorts-sira.js` | Open. Remove the slug from the list to retry; quality-gate BLOCKs now retry automatically when the spec changes |
| L5 | `baslik-analiz.js` and `senaryo-yaz.js` depend on a paid vidIQ key | — | Kept optional; nothing in the daily pipeline depends on them |

---

## Mechanical-sameness checklist (Phase 1 items)

| Pattern | Before | Now |
|---|---|---|
| Fixed scene durations | yes (long-form) | role-based, narration-synced |
| Repeated intro | 13–15 s logo/countdown | cold open |
| Repeated outro | identical SUBSCRIBE card | next episode per cluster |
| Repeated transitions | one fade length everywhere | cut-like vs dissolve by role |
| Repeated sentence patterns | "That is why…" in 8 scripts | measured (originality), flagged |
| Repeated hooks | not measured | hook engine + originality hook similarity |
| Generic stock footage | long-form 100 % stock (C3) | evidence-first tiers, channel-wide clip dedupe |
| Repetitive music | fixed progression | cluster/slug profiles, transposition |
| Identical CTA positions | end card on every video | adaptive CTA; Shorts none spoken |
| Similar titles | unmeasured | title pattern penalty + similarity |
| Similar thumbnails | none generated | layout rotation + similarity |
| Duplicated descriptions | one-liners | structured, per-video |
| Overused keywords | 5 generic hashtags | ≤3 hashtags, relevant tags only |
| Repetitive visual layouts | same | overlays/stamps/diagrams vary with the case |
| AI-like narration / TTS pronunciation | unchecked | cliché scan + pronunciation dictionary |
| Weak attribution | partial | full per-scene metadata + description credits |
| No engineering visuals | none | 4–8 per long-form, 1 overlay per Short |
