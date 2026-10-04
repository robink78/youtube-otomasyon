# Requirements checklist — growth platform iteration (started 2026-10-03)

Source: the "production-grade, multi-channel, analytics-driven, self-improving
YouTube growth platform" specification (phases 0–27). Every requirement has an
ID and a status: TODO · IN PROGRESS · DONE · BLOCKED. DONE items record files,
tests and evidence. Re-read before every phase; update after every phase.

Runtime: Node.js 20 (CommonJS) + Python unittest; state is JSON files under
`channels/<slug>/{state,memory,analytics}` (legacy Failure Reconstructed paths
under `icerik/`, `analytics/`); GitHub Actions is the scheduler/runtime.

## Gap matrix (Phase 0 audit)

| Requirement | Current implementation | Quality | Gap | Action |
|---|---|---|---|---|
| Shared platform, isolated channel state | `core/channel-context.js`, `core/growth/store.js` (all paths derived from one slug), per-channel configs | Good | — | KEEP |
| Canonical UC… channel ID per channel | `<PREFIX>_YT_CHANNEL_ID` variables; `lib/yt.verifyChannelIdentity` before writes | Good | publish job's own channel not compared with the credential | EXTEND |
| OAuth isolation / health | `lib/yt.js`, `oauth-health.js`, `youtube-oauth-health.yml` (PR #90) | Good | — | KEEP |
| Idempotent upload | title-only duplicate check in `youtube-yukle.js`; fail-open when the check errors; new session on every retry; `upload-state.json` unused | **Weak** | key, intent journal, resumable-session reconciliation, publishAt match, fail-closed | ADD |
| Retry classification | 3 tries, fixed 10/20 s waits, only `>=500` retried | Weak | 429/quota/auth/validation classes, exp backoff + jitter | ADD |
| Dry-run / shadow / staging | `--dogrula`, `PUBLISH=0`, `dry_run`, `YT_PRIVACY` | Partial | explicit shadow mode, pre-flight report | EXTEND |
| Analytics per video | `lib/analitik.js`, `core/growth/analytics.js` checkpoints 1h…28d with `collectedAt` | Good | — | KEEP |
| channel_daily / video_daily / traffic_daily | none | Missing | incremental warehouse + 12-month backfill | ADD |
| Derived metrics | `core/growth/performance.derive` (velocity, conversion, rates) | Good | net subscribers, watch-minutes/view, engagement/1k | EXTEND |
| Shorts vs long baselines | `performance`, `diagnosis` split by contentType | Good | — | KEEP |
| Diagnosis | `core/growth/diagnosis.js` (+ plateau/breakout in performance) | Good | spec codes (STRONG_TOPIC_AUDIENCE_FIT, SEARCH_DEPENDENT, STRONG_DISCOVERY, CADENCE_QUALITY_RISK, aliases) | EXTEND |
| Topic intelligence | topic-model/topic-scoring, explore buckets, popularity (PR #94) | Good | predicted-vs-actual topic/cluster ledger, fatigue signal | EXTEND |
| Hooks / titles | `hooks.js`, `titles.js` candidates + scores in growth-plan.json; pattern freshness (PR #95) | Good | prediction-vs-outcome ledger | EXTEND |
| Thumbnails | `thumbnail-strategy.js`, long-form concepts | Partial | versioned asset metadata ledger | EXTEND |
| Experiments | `core/growth/experiments.js` single-variable, idempotent | Good | — | KEEP |
| Learning loop | `core/growth/learning.js` (observation→hypothesis→adopted), weekly summary | Good | predictions ledger feeding inspection | EXTEND |
| Series | `core/series.js`, funnel/relationships | Good | — | KEEP |
| Quota | ad-hoc QUOTA_ERROR classification only | Missing | central cost policy + per-channel ledger | ADD |
| Observability | `GrowthRuntime.alert`, issues, health | Partial | structured per-channel ops event log + metrics summary | ADD |
| Provenance | `visual-attribution.json`, FR source ledger, description credits | Partial | unified per-video provenance manifest | EXTEND |
| Reporting | growth dashboard, daily ops report, weekly learning | Good | analytics freshness / ops / quota sections | EXTEND |
| TikTok | retired by owner on 2026-10-02 (PR #93); code dormant | — | spec says "preserve TikTok" — conflicts with the owner's decision | BLOCKED (owner decision) |

## Reconciliation (2026-10-03)

Every non-blocked item below is DONE with files, tests and evidence. Full suite: JS 253 (252 pass, 1 environment skip), Python 24/24, actionlint clean. Real render on GitHub Actions (quality-preview run 37100161888, no upload): FR / IB / CT PASS with the new render-path code. Spec phases with no separate ID map as follows: hook ≥10 / title ≥20 candidates already met (FR 13/23, IB 19/24, CT 11/22 per plan); script/retention structure (story configs + storyStructure in every record); long-form → Shorts factory and parent/child links (existing lane, short-factory, funnel); experiments (existing single-variable engine); fatigue (title pattern freshness, topic similarity, family fatigue). One item is BLOCKED by an owner decision: TIKTOK-01.

## Checklist

### Architecture / audit
- ARCH-01 Phase 0 audit + gap matrix — **DONE** (this file).
- ARCH-02 Single shared platform, channel-isolated state — **DONE** (existing; `tests/js/multi-channel.test.js`, `tests/js/growth.test.js` isolation tests).

### Identity / security
- ID-01 Canonical UC… ID per channel — **DONE** (existing `<PREFIX>_YT_CHANNEL_ID`; `oauth-health` verifies all three).
- ID-02 publish_job.channel == credential channel == authenticated channel, fail closed — **DONE**. `Safety.jobChannelCheck` (job tag + expected UC ID) before auth; `getYouTubeClient` verifies the authenticated channel. Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- SEC-01 Channel-specific credentials, no mixing — **DONE** (PR #90; `tests/js/oauth.test.js` partial-migration test).
- SEC-02 No secrets in logs/reports — **DONE**. Ops log drops credential-like keys and masks token-like values; upload logs print classified codes only. Test: quota-ops.test.js (OBS-01 / SEC-02).
- SEC-03 No secrets committed (history scan) — **DONE** (268 commits scanned 2026-10-02, none found).

### Publishing
- PUBLISH-01 Idempotency key SHA256(channel_id, media_hash, normalized_title, publish_at) — **DONE**. `idempotencyKey()` uses the authenticated UC ID. Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- PUBLISH-02 Intent journal written before the upload session — **DONE**. `upload-state.json` intents (IN_FLIGHT/COMPLETED/FAILED); session URLs in git-ignored `.upload-sessions.json` (repo is public). Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- PUBLISH-03 Reconcile before upload/retry — **DONE**. Order: completed journal intent → open session status → uploads playlist matched by normalized title OR identical scheduled publishAt. Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- PUBLISH-04 Fail closed when reconciliation is impossible — **DONE**. `recentUploads` throws → exit 9, no session opened (old fail-open path removed). Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- PUBLISH-05 Retry classes + bounded exp backoff + full jitter — **DONE**. `classifyFailure` (NETWORK/RATE_LIMIT/SERVER retried; QUOTA/AUTH/VALIDATION/PERMANENT not), `backoffDelay`. Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- PUBLISH-06 Resume an interrupted session — **DONE**. `runUpload` queries the session after every retryable failure: COMPLETE → that video, INCOMPLETE → resume from the received byte, never a second session unless YouTube says EXPIRED. Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- PUBLISH-07 Publish modes — **DONE**. `PUBLISH_MODE=live|shadow|dry-run` (`--dogrula` = dry-run); private/unlisted via existing `YT_PRIVACY`/flags. Default unchanged (live). Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.
- PUBLISH-08 Pre-flight — **DONE**. `PUBLISH-PREFLIGHT.json`: channel + authenticated ID, media SHA-256 + bytes, title, schedule, privacy, quality gate, idempotency key, duplicate state, quota. Existing metadata validation + quality gate kept. Files: lib/publish-safety.js, youtube-yukle.js, core/channel-context.js (allChannels), .gitignore. Tests: tests/js/publish-safety.test.js (14 pass), npm test 225 pass.

### Analytics
- ANALYTICS-01 Warehouse tables per channel — **DONE**. core/analytics/warehouse.js: channel_daily, channel_type_daily (creatorContentType: Shorts vs long), traffic_daily, video_daily under `<channel analytics>/warehouse/`. analytics-sync.js (identity-verified, read-only) runs in portfolio-production's daily analytics loop. Tests: tests/js/warehouse.test.js.
- ANALYTICS-02 Incremental load + 12-month backfill + freshness — **DONE**. First run 365 days in ≤90-day chunks; later runs re-read 3 trailing days and upsert; state.json freshness; at most one sync per 20 h. Tests: warehouse.test.js.
- ANALYTICS-03 Only real API metrics — **DONE**. CORE_METRICS from the Analytics API v2; impressions / impression CTR recorded as unavailable (Studio-only), optional dimension failures recorded, never estimated. Test: warehouse.test.js.
- ANALYTICS-04 Publish-relative windows 1h…28d with actual observation time — **DONE** (existing checkpoints + `collectedAt`).
- ANALYTICS-05 Derived metrics — **DONE**. net subscribers, subscriber conversion, engagement/1k, watch-minutes/view in warehouse rows and core/growth/performance.derive (velocity existed). Tests: warehouse.test.js.
- ANALYTICS-06 Shorts vs long separate baselines — **DONE** (existing `performance`/`diagnosis`).

### Growth intelligence
- DIAG-01 Diagnosis codes from the spec — **DONE**. core/growth/diagnosis.js: existing codes keep their names and carry `specCode` (HOOK_WEAK, RETENTION_WEAK, PACKAGING_WEAK, SUBSCRIBER_CONVERSION_WEAK, TOPIC_REACH_LIMITED, POTENTIAL_BREAKOUT, EARLY_DISTRIBUTION_PLATEAU); new SEARCH_DEPENDENT, STRONG_TOPIC_AUDIENCE_FIT, STRONG_DISCOVERY, PROMISE_CONTENT_MISMATCH (manual CTR only), CADENCE_QUALITY_RISK (warehouse); all relative to the channel's format median with a minimum baseline sample (config/growth-engine.json). RETURNING_VIEWER_WEAK not emitted: returning viewers are not exposed per video by the API (documented). Tests: tests/js/learning-loop.test.js (6 pass).
- TOPIC-01 Topic/cluster ledger — **DONE**. core/growth/predictions.topicPerformance → `state/growth/topic-performance.json`: publications, predicted vs actual, views, retention, conversion, confidence, explore/exploit/deprioritise, fatigue. Tests: tests/js/learning-loop.test.js (6 pass).
- TOPIC-02 Topic performance feeds decisions — **DONE**. Existing learning cluster bonus (sample/significance-gated) + measured Wikipedia popularity (PR #94) in topic scoring; family ledger + calibration in the Monday report for inspection. Tests: tests/js/learning-loop.test.js (6 pass).
- HOOK-01 Hook traceability — **DONE**. Candidates/scores/winner in the plan file (`state/growth/shorts/<slug>.json`); hookScore, hookCandidates, selectedHook in the video record; outcome joined in predictions.json. Tests: tests/js/learning-loop.test.js (6 pass).
- TITLE-01 Title traceability — **DONE**. Candidates/scores/patterns in the plan file; titleScore, titleCandidates, titlePattern, selectedTitle recorded (core/growth/index.js growthMeta); outcome joined in predictions.json. Tests: tests/js/learning-loop.test.js (6 pass).
- THUMB-01 Thumbnail variant ledger — **DONE**. core/growth/thumbnails.js → `state/growth/thumbnails.json` (sha256, concept, layout, text/textLength, template version, human, experiment, selected, videoId); IB/CT render and FR long-form concepts recorded, uploaded concept marked selected; evaluate() judges on retention/watch/conversion, CTR only when entered from Studio (no thumbnail A/B API). Tests: provenance-thumbnails.test.js.
- CONV-01 Subscriber conversion by dimension — **DONE**. Existing core/growth/analytics.conversionBreakdown (topic cluster, hook, duration, structure, CTA, title pattern, format) + popularityBand, publishSlot, openingVisual; series = channel; weekly report shows best/worst title pattern with n≥3. Tests: tests/js/learning-loop.test.js (6 pass).
- FATIGUE-01 Near-duplicate / repeated-pattern penalties — **DONE** (title pattern freshness PR #95; topic similarity in topic-scoring).
- EXP-01 Single-hypothesis experiment records — **DONE** (existing `experiments.js`).
- LEARN-01 Prediction vs outcome persisted and inspectable — **DONE**. core/growth/predictions.js → `state/growth/predictions.json` with per-predictor Spearman calibration (INSUFFICIENT_SAMPLE under 5); refreshed after every analytics run (core/growth/runtime.js); summarised in the Monday report. Tests: tests/js/learning-loop.test.js (6 pass).
- SERIES-01 Series identity, playlists, related links — **DONE** (`core/series.js`, funnel).
- MONET-01 Monetization readiness from real data — **DONE**. core/analytics/monetization.js: subscribers (Data API snapshot), long-form watch hours 365 d and Shorts views 90 d (warehouse channel_type_daily); labelled estimate, nulls never extrapolated. Tests: platform-invariants.test.js.

### Operations
- QUOTA-01 Central configurable cost policy — **DONE**. config/quota.json + lib/quota.js; no call-site constants. Tests: tests/js/quota-ops.test.js.
- QUOTA-02 Per-channel ledger + graceful exhaustion — **DONE**. `<state>/quota-ledger.json` per channel, budget summed per Google project, Pacific-day reset; every lib/yt Data API call charged; upload deferred (exit 10) when the budget is short. Tests: tests/js/quota-ops.test.js.
- OBS-01 Structured per-channel ops event log — **DONE**. lib/ops-log.js events: publish.success/failure/retry/blocked/shadow/duplicate_prevented/public (+ publish delay)/unexpected_public, quota.exhausted, oauth.failure, analytics.load/partial/failure, growth.decision; daily report adds scheduler queue depth + oldest job age (stale tasks now settled done/missed — previously every task stayed queued forever). Tests: quota-ops.test.js, platform-invariants.test.js.
- PROV-01 Per-video provenance manifest — **DONE**. lib/provenance.js → `<package>/provenance.json` (source, URL, licence, licence evidence, attribution duty, allowedChannels, expiry, generated voice/music/graphics); IB/CT from visual-attribution data, FR from source-ledger credit lines (licence never guessed); opt-in pre-flight gate PROVENANCE_REQUIRED=1 (exit 12). Tests: provenance-thumbnails.test.js.
- REPORT-01 Report sections — **DONE**. daily-operations-report: analytics warehouse freshness, ops events (24 h), API quota today per project, YPP readiness; Monday issue: calibration, topic families, conversion, cadence (Phase 3). Tests: platform-invariants.test.js.

### Tests / docs
- TEST-01 Wrong channel/token fails closed — **DONE** (existing oauth.test.js) + publish-job check (publish-safety.test.js ID-02).
- TEST-02 Upload retry never duplicates — **DONE**. publish-safety.test.js: network drop after full receipt, unknown session state, expired session.
- TEST-03 Analytics + learned weights isolated per channel — **DONE**. warehouse partition test (warehouse.test.js); learned weights/state isolation existing (growth.test.js, multi-channel.test.js).
- TEST-04 Scheduler timezone — **DONE** (`calendar-scheduling.test.js`).
- TEST-05 Partial failure resumes — **DONE**. publish-safety.test.js: resume from received byte; journal-completed intent re-committed without upload.
- TEST-06 No secrets in logs — **DONE** (ops log redaction test; journal excludes session URLs).
- TEST-07 Three-channel workflow intact; production behaviour unchanged by default — **DONE**. platform-invariants.test.js: live publish mode default, all three channels still produced with their PUBLISH vars, new gates opt-in, privacy/slot logic unchanged; full suite 250 pass.
- TIKTOK-01 Preserve TikTok — **BLOCKED**: retired by the owner on 2026-10-02 (PR #93). Code kept dormant and untouched; re-enable needs the owner's decision.
- DOC-01 Documentation of the real implementation — **DONE**. docs/GROWTH-PLATFORM.md (architecture, isolation, OAuth, scheduler, upload lifecycle + exit codes, quota, analytics + unavailable metrics, growth/learning loop, diagnosis codes, provenance, observability, troubleshooting/recovery, TikTok status); README link. Existing OAuth/onboarding/TikTok docs referenced, not duplicated.
