# YouTube content quality & policy rules

Failure Reconstructed grows because the videos are better — not because the system tries to game or evade YouTube's enforcement. These rules are part of the project, and the code enforces them where it can.

## Hard rules

| Rule | What it means here | How the system enforces it |
|---|---|---|
| **No fake engagement** | No bots, no scripted likes, no coordinated views, no engagement pods. | Nothing in the repo generates views, likes or subscriptions. |
| **No buying views or subscribers** | No paid view services, sub packages or "promotion" that delivers non-genuine viewers. | Not supported and never will be. |
| **No sub4sub** | No subscription exchanges, in comments or elsewhere. | Comment replies (`yorum-yanitla.js`) never ask anyone to subscribe or exchange subscriptions. |
| **No comment spam** | Replies are limited and relevant. Nothing is posted on other channels. | Max 8 replies per run, only on our own videos, skipping short/troll comments and threads that already have replies. One pinned comment per video (`pinned-comment.js`). |
| **No misleading thumbnails** | The thumbnail shows something that actually happens in the video. | `thumbnail-strategy.js` renders thumbnails from the video's own frames. AI imagery is only an explicit fallback and must be labelled. |
| **No misleading titles** | Every claim in the title is supported by the documentary. | `title-engine.js` scores *support* (title words present in the script or case file). Candidates with clickbait risk ≥ 4 are never auto-selected. Hype words are penalised. |
| **No mass duplicate uploads** | Each topic is produced and uploaded once. | Registry `icerik/yayinlananlar.json`. The queue skips anything already uploaded. `originality-check.js` BLOCKs near-duplicate scripts and titles. |
| **No deceptive metadata** | Tags and hashtags are about the video; no unrelated trending tags. | `description-engine.js`: ≤ 12 relevant tags, ≤ 3 hashtags; `viral/fyp/trending`-style tags are dropped. |
| **No repeated re-uploads to reset performance** | A weak video is repackaged (title/thumbnail/description), never deleted and re-uploaded. | No code path deletes or re-uploads. `existing-video-optimizer.js` and `post-publish-analyzer.js` only recommend. Title changes are logged as experiments. |
| **No copyright violations** | Only public domain, commercially usable CC (no NC/ND) and licensed stock. | `arsiv-bul.js` (Wikimedia/archive.org), `gorsel-bul.js` (licence filters and tiers, archive.org only if public domain or pre-1929), `stok-bul.js` (Pexels licence). Every file is logged with its source URL and licence in `GORSEL-KAYNAKLARI.txt` and `Visuals/kaynaklar.json`, and credited in the description. |
| **Disclose realistic synthetic content** | If an image reconstructs an event that was never photographed that way, it is labelled on screen, and the upload declares synthetic media. | `config/growth.json → disclosure`: on-screen "AI RECONSTRUCTION" label (`shorts-yap.js`, `video-yap.js`). `status.containsSyntheticMedia = true` on upload when any scene is synthetic. The description carries a synthetic-voice note. Diagrams are not labelled (they are obviously graphics). |
| **Add meaningful editorial & educational value** | Every video explains *why* a system failed: the mechanism, the chain and what changed. | Case file (`vaka`) required. `quality-gate.js` scores ENGINEERING DEPTH (mechanism named, failure chain, numbers, references) and SCRIPT (clichés, pronunciation, open loops). |
| **Avoid mechanically repeated mass-produced content** | Structure, visuals, music, titles and thumbnails vary with the story. | `scene-pacing.js` (role-based pacing), `lib/muzik.js` (per-video music profile), title and thumbnail pattern penalties, and `originality-check.js` (10 similarity measures) → REVIEW/BLOCK. |

## Accuracy standard

- Every factual claim must be supported by the case file's references (`vaka.kaynakca`). Contested causes are worded as such ("most likely", "the leading theory").
- Published inaccuracies are corrected in the **pinned comment and description**, never by deleting or re-uploading (see `migration/EXISTING-VIDEOS-PLAN.md`, `REVIEW_MANUALLY`).
- No invented quotes, people, studies or numbers.

## Analytics honesty

- Metrics that the API does not provide (impressions, CTR, returning viewers per video) are shown as **unavailable**. They can be entered manually from Studio in `analytics/<videoId>/studio-manual.json` and are then labelled as manual.
- Patterns from small samples are labelled **low confidence**. Experiments never claim causality below 5 videos per arm, and even then are reported as correlational.

## Automation boundaries

- Uploads are **private by default**; a human publishes them.
- BLOCK verdicts are never uploaded. The publishing cadence stretches rather than lowering the bar.
- The system never deletes, replaces or re-uploads a video, and never changes a live title automatically. `youtube-guncelle.js` keeps the live title unless `--baslik` is passed explicitly, supports `--dogrula` (dry run), and backs up the previous snippet.
