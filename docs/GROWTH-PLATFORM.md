# Growth platform — how the automation measures, learns and publishes safely

This document describes what is implemented today. Requirement-level status and evidence live in [`REQUIREMENTS_CHECKLIST.md`](../REQUIREMENTS_CHECKLIST.md).

## Architecture: one shared platform, isolated channel state

| Shared (one copy) | Per channel (never shared) |
|---|---|
| `core/` pipeline, rendering, scheduling, growth engine, analytics warehouse | `channels/<slug>/config.json`: UC… channel ID variable, credential names, timezone, cadence, voice, platforms |
| `lib/yt.js` OAuth + API client, `lib/publish-safety.js`, `lib/quota.js`, `lib/ops-log.js`, `lib/provenance.js` | Topic inventory, growth-engine overrides (`channels/<slug>/growth-engine.json`: weights, hooks, captions) |
| GitHub Actions workflows | State: `channels/<slug>/state/` (Failure Reconstructed: `icerik/`), learning `channels/<slug>/memory/`, analytics `channels/<slug>/analytics/` (FR: `analytics/`) |

Every state path is derived from one channel slug (`core/channel-context.js`, `core/growth/store.js`). Channels: Failure Reconstructed (`failure-reconstructed`, legacy paths), ImpossibleBrief (`impossible-brief`), CriticalThread (`critical-thread`), and The Hidden Logic of Things (`behind-the-ordinary`). Adding a channel: [`docs/ADDING-NEW-CHANNEL.md`](ADDING-NEW-CHANNEL.md).

## Identity and OAuth

- Each channel has its own client/refresh-token secrets and a `<PREFIX>_YT_CHANNEL_ID` variable; see [`docs/OAUTH-THREE-CHANNELS.md`](OAUTH-THREE-CHANNELS.md).
- Before any write, `lib/yt.getYouTubeClient` refreshes the token, checks the upload scope and verifies that the authenticated channel equals the configured UC… ID.
- The uploader also checks that the publish job belongs to the channel whose credentials are loaded (`Safety.jobChannelCheck`). Any mismatch fails closed.
- `youtube-oauth-health.yml` validates all four identities every 6 hours.

## Scheduling

- Production runs on Europe/Istanbul calendar days.
- Shorts go public at 18:00 America/New_York (`publishTimeZone`). This is 01:00 Istanbul in US summer time and 02:00 in winter.
- `core/scheduling/calendar.js` reads each release in its publish zone, so a 01:00 Istanbul release still belongs to the previous production day.
- UTC instants are stored; DST is handled by the tz database.

## Upload lifecycle (`youtube-yukle.js` + `lib/publish-safety.js`)

1. **Local checks:** metadata validation and the quality gate (`PUBLISH` only).
2. **Job ownership:** the job must belong to this channel (exit 11).
3. **Identity:** OAuth refresh and authenticated channel identity (exit 7).
4. **Idempotency key:** `SHA256(channel_id | media_sha256 | normalized_title | publish_at)`.
5. **Reconciliation, before any upload:**
   - a COMPLETED journal intent is re-committed locally, with no upload;
   - an open resumable session is queried: if complete, that video is used; if incomplete, the upload resumes from the received byte;
   - the channel's recent uploads are matched by normalized title or by an identical scheduled `publishAt`.
   - If the uploads cannot be read, nothing is uploaded (**fail closed**, exit 9).
6. **Pre-flight report:** written to `<job>/PUBLISH-PREFLIGHT.json` (channel, media hash, schedule, quota, provenance, duplicate state).
7. **Publish mode:** `PUBLISH_MODE=shadow` stops here. `--dogrula` is a local dry run. The default is `live`.
8. **Gates:** licensing gate (opt-in, `PROVENANCE_REQUIRED=1`, exit 12); quota check (exit 10 when the project's daily budget is short).
9. **Journaled upload:** the intent is journaled, then `runUpload` sends the body.
   - Only NETWORK, RATE_LIMIT and SERVER failures are retried, with bounded exponential backoff and full jitter.
   - After every failure the session is asked first. A second session is opened only when YouTube reports the first one EXPIRED.
10. **Success:** the journal is marked COMPLETED before the local registry is written, so a crash in between is reconciled on the next run.

The journal is `<state>/upload-state.json` (committed). Resumable session URLs carry an `upload_id`, so they live only in the git-ignored `<state>/.upload-sessions.json`.

### Exit codes

| Code | Meaning |
|---|---|
| 6 | Metadata invalid |
| 7 | Auth or identity failure |
| 8 | Not quality-publishable |
| 9 | Reconciliation unavailable |
| 10 | Quota |
| 11 | Job/channel mismatch |
| 12 | Provenance incomplete |
| 1 | Upload failed (classified in `YUKLEME-HATASI.json`) |

## Quota (`config/quota.json`, `lib/quota.js`)

- One cost table covers every Data API operation; no call site carries a constant.
- Every call through `lib/yt` is charged to `<state>/quota-ledger.json`.
- The budget is per Google Cloud project, derived from the OAuth client ID prefix, and summed across channels on that project. It resets at midnight Pacific.
- The Analytics API has its own quota and is not counted here.

## Analytics

- **Per-video checkpoints** (`core/growth/analytics.js`, `lib/analitik.js`): measured at 1h, 6h, 12h, 24h, 48h, 7d and 28d after publication. Each checkpoint stores when it was actually observed.
- **Warehouse** (`core/analytics/warehouse.js`, `analytics-sync.js`): per channel, under `<analytics>/warehouse/`:
  - tables: `channel_daily`, `channel_type_daily` (Shorts vs long), `traffic_daily`, `video_daily`;
  - the first run backfills 365 days, later runs re-read the trailing 3 days, and sync runs at most once per 20 hours;
  - identity is verified before rows are written.
- **Unavailable metrics:** impressions and impression CTR are not exposed by the Analytics API (Studio only). They are stored as unavailable and never estimated. Returning viewers are not available per video.
- **Derived metrics:** net subscribers, subscriber conversion, engagement per 1k views, watch minutes per view, view velocity.
- **Separate baselines:** Shorts and long-form are always judged against their own format's baseline.

## Growth engine and learning loop

```
topic candidates (topic-model, topic-scoring, Wikipedia popularity, explore/exploit buckets)
 → hook candidates (hooks.js) → title candidates (titles.js, pattern freshness)
 → plan file state/growth/shorts/<slug>.json (all candidates + scores) + growthMeta predictions
 → render → quality gates → publish (above)
 → checkpoints → performance (age-normalised, percentiles, plateau/breakout)
 → diagnosis (diagnosis.js; spec codes, channel/format-relative, sample-aware)
 → experiments (experiments.js; single variable)
 → learning (learning.js: observation → hypothesis → adopted, significance-gated, per channel)
 → predictions.js: prediction vs outcome, per-predictor Spearman calibration, topic-family ledger
 → next topic/hook/title decisions use adopted bonuses
```

Inspect a channel's learning in `state/growth/predictions.json`, `state/growth/topic-performance.json` and `memory/growth-learning.json`. The Monday "Haftalık özet" issue summarises it in plain language: prediction accuracy, topic families, conversion, cadence risk, and the publish-slot comparison.

Diagnosis codes keep their original names and carry the spec name (`specCode`):

| Original code | Spec name |
|---|---|
| HOOK_FAILURE | HOOK_WEAK |
| RETENTION_FAILURE | RETENTION_WEAK |
| *_PACKAGING_FAILURE | PACKAGING_WEAK |
| LOW_SUBSCRIBER_CONVERSION | SUBSCRIBER_CONVERSION_WEAK |
| GOOD_CONTENT_LOW_DISTRIBUTION | TOPIC_REACH_LIMITED |
| BREAKOUT | POTENTIAL_BREAKOUT |

New codes:
- SEARCH_DEPENDENT
- STRONG_TOPIC_AUDIENCE_FIT
- STRONG_DISCOVERY
- PROMISE_CONTENT_MISMATCH (only with a manually entered CTR)
- CADENCE_QUALITY_RISK (warehouse-based)

## Assets and provenance

- **Provenance manifest:** every video gets `<package>/provenance.json` (`lib/provenance.js`). It lists each external and generated asset with its source, URL, licence, evidence, attribution duty and allowed channel. Licences are copied from the source records, never guessed.
- **Thumbnail ledger:** thumbnail variants are recorded in `state/growth/thumbnails.json` (`core/growth/thumbnails.js`).
- **Thumbnail testing:** there is no thumbnail A/B API, so tests use YouTube Studio's native "Test & compare" and are logged as experiments.

## Observability and reporting

- **Ops log:** `lib/ops-log.js` writes per-channel structured events to `<state>/ops/events.jsonl` and prints `OPS {...}` log lines. Credentials are redacted. Event types:
  - publish: success, failure, retry, blocked, shadow, duplicate_prevented
  - quota.exhausted, oauth.failure
  - analytics: load, partial, failure
- **`reports/daily-operations.md`:** per channel production status plus warehouse freshness, ops (24 h), API quota today and monetization readiness. Readiness is an estimate of YPP thresholds from real data; YouTube decides eligibility.
- **Health issue:** `youtube-oauth-health.yml` maintains the persistent health issue.

## Troubleshooting and recovery

| Symptom | Where to look | Action |
|---|---|---|
| Upload exit 9 | Ops `publish.blocked` RECONCILE_UNAVAILABLE | API outage; the next run retries. No duplicate risk. |
| Upload exit 10 | `quota-ledger.json` | Wait for the Pacific reset, or reduce non-upload API calls |
| Duplicate suspected | `upload-state.json` intents + ops `publish.duplicate_prevented` | The journal and slot matching prevent re-uploads; never delete the journal |
| Analytics stale | `warehouse/state.json` lastError | `node analytics-sync.js --channel <slug> --force` |
| Wrong channel | `youtube-oauth-health.yml` report | Re-authorize with `youtube-yetki.js` (refuses a mismatched channel) |

Manual test without upload: `PUBLISH_MODE=shadow node youtube-yukle.js --channel <slug> <job>`. Render preview without upload: the `Shorts quality preview` workflow.

## TikTok

Retired by the owner on 2026-10-02. The code is dormant and intact (`tiktok-yukle.js`, `lib/tiktok.js`), and `platforms.tiktok.enabled` is false for every channel. See [`docs/TIKTOK.md`](TIKTOK.md).
