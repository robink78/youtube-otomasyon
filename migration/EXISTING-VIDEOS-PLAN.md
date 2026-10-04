# Existing videos — migration plan

Generated 2026-09-24 by `node existing-video-optimizer.js --all`. Per-video detail: `analysis/<videoId>/optimization-report.md`.

Rules: never delete, never re-upload, never replace automatically. Change one packaging element at a time and log it in `experiments/experiments.json` so the effect can be measured.

Priority key: **P1** high impressions + low CTR · **P2** good views + low subscriber conversion · **P3** good retention + weak Suggested traffic · **P4** low-data videos.

## P1

_none_

## P2

_none_

## P3

_none_

## P4

### The Disaster That Ended the Age of the Airship
https://youtu.be/PGOKZhPYo7c · 981 views · diagnosis: OUTPERFORMER

- `KEEP` — outperforming the channel — keep title and thumbnail; only fix objective gaps below
- `REVIEW_MANUALLY` — Published narration states a spark ignited leaking gas as fact; it is the leading theory (static discharge), not proven. The pinned comment/description should say "most likely".

### Why the Tacoma Narrows Bridge Tore Itself Apart
https://youtu.be/qkzRUqlEy5I · 178 views · diagnosis: HEALTHY

- `KEEP` — no action needed with the data available
- Title to test later (as a logged experiment): "Filmed as It Fell: The Tacoma Narrows Collapse"

### Why San Francisco Burned for Three Days
https://youtu.be/X0jw78mIGdk · 110 views · diagnosis: INSUFFICIENT_DATA, WEAK_TOPIC_PACKAGING

- `REVIEW_MANUALLY` — Published narration says the fire, not the quake, did most of the killing. Sources agree fire caused most of the DESTRUCTION; the split of deaths is uncertain. Clarify in the pinned comment/description rather than re-uploading.
- Title to test later (as a logged experiment): "No Water, Three Days of Fire: San Francisco 1906"

### The Nuclear Test That Poisoned a Paradise Forever
https://youtu.be/DLYpmaQ-EVw · 88 views · diagnosis: INSUFFICIENT_DATA, WEAK_TOPIC_PACKAGING

- `KEEP` — no action needed with the data available

## Order of work

1. **REDESCRIBE / ADD_INTERNAL_LINKS** first — objective gaps (sources, references, related links, disclosure), zero risk to CTR.
2. **PLAYLIST_MOVE** when a cluster reaches 3 published videos (`node channel-plan.js` shows status).
3. **RETITLE / RETHUMBNAIL** only after ~7 days of data, one video at a time, logged as an experiment.
4. **REPACKAGE** is reserved for videos with measured weak packaging (P1), never on day-one guesses.

## Local productions (not on YouTube)

| Slug | State | Class | Why |
|---|---|---|---|
| halifax-explosion | not rendered | REVIEW_MANUALLY | production previously failed — rerun after checking sources |
| mount-st-helens | not rendered | REVIEW_MANUALLY | local test/legacy job with no production spec — not part of the channel queue |
| sample-tacoma | rendered, not uploaded | REVIEW_MANUALLY | local test/legacy job with no production spec — not part of the channel queue |
| spread-test | rendered, not uploaded | REVIEW_MANUALLY | local test/legacy job with no production spec — not part of the channel queue |
| tacoma-short | rendered, not uploaded | REVIEW_MANUALLY | local test/legacy job with no production spec — not part of the channel queue |
| test-uzun-tacoma | rendered, not uploaded | REVIEW_MANUALLY | local test/legacy job with no production spec — not part of the channel queue |
| vesuvius-1944 | not rendered | KEEP | queued for normal production |
| why-bridges-collapse | rendered, not uploaded | KEEP | queued for normal production |
