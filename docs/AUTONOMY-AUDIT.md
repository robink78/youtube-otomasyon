# Autonomy audit — 28 September 2026

Scope: current `main` at `97f948f`, the following remediation branch, all workflow definitions, the latest seven days of GitHub Actions visible through the API, channel configs/state/registries, quality and upload code, OAuth handling, analytics, scheduling, documentation, and live TikTok API status. Secret values were not inspected or printed.

## Evidence snapshot

- 92 Actions runs were visible for 21–27 September: 57/58 test runs succeeded; all five scheduled daily-control runs succeeded; the only portfolio schedule succeeded; six legacy `Shorts uretim` scheduled runs appeared, but the expected 27 September 14:29/14:53 production opportunities did not run on time. Later scheduled jobs ran at 18:34, 19:48, and 19:52 UTC. GitHub cron is therefore demonstrably delayed/missed, not an independent SLA guarantee.
- PR #31 (`97f948f`) added repository-side production SLA recovery, exact-MP4 TikTok handoff, duplicate guards, and an undeployed Cloudflare Worker trigger.
- Failure Reconstructed has seven YouTube registry entries. The 27 September video `aScjSrwqeRk` was uploaded with a `PUBLISH` gate and scheduled for 18:00 UTC.
- ImpossibleBrief has 500 qualified topics and one local dry-run generation, but no YouTube publication. Its required `IB_YT_*` credentials/channel variable and `IB_PUBLISH=1` are absent.
- Live TikTok diagnostics in Actions runs `36351122901` and `36351160363` refreshed the token, verified `user.info.basic,video.upload`, identified the authorized display name as `failuredreconstructed`, and matched the newly pinned account fingerprint. Hindenburg and Bikini Baker are `PUBLISH_COMPLETE`; Deepwater Horizon and Tacoma Narrows are `SEND_TO_USER_INBOX`.

## CRITICAL

### Fixed — REVIEW content could auto-publish

`config/growth.json` scheduled both `PUBLISH` and `REVIEW`; `how-avalanches-start` demonstrates that a REVIEW item was uploaded and scheduled. The schedule now accepts only `PUBLISH`. `shorts-sira.js` quarantines REVIEW by spec hash and continues to the next topic; `youtube-yukle.js` independently rejects direct REVIEW/BLOCK uploads.

### Fixed — refresh token could be printed

If `.env` writing failed, `youtube-yetki.js` printed the entire Google refresh token. It now prints only the secret name and requires a safe re-authorization retry. No credential value is committed.

### Fixed — TikTok destination account was not verified

A valid token previously proved scope but not destination identity. Uploads now fetch the authorized creator identity, compare a SHA-256 fingerprint with `TT_EXPECTED_OPEN_ID_SHA256`, and fail closed on mismatch. The repository variable is pinned to the live authorized Failure Reconstructed account.

## HIGH

### Open/manual — ImpossibleBrief production authorization

Code isolation and pre-write channel-ID validation are present and tested, but `IB_YT_CLIENT_ID`, `IB_YT_CLIENT_SECRET`, `IB_YT_REFRESH_TOKEN`, `IB_YT_CHANNEL_ID`, and `IB_PUBLISH=1` are not configured. Scheduled ImpossibleBrief publishing is intentionally disabled until they exist.

### Open/manual — independent scheduler is not deployed

The Cloudflare Worker and deployment workflow exist, but `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `WATCHDOG_GITHUB_TOKEN` are absent. Until deployment, every active scheduler remains in GitHub's failure domain. Repository recovery works; independent invocation does not yet exist.

### Open — long-form is planned but not production-wired

The scheduler enqueues long-form cadence, and the content engines contain outlines/thumbnails, but no channel-aware, quality-gated long-form Actions job consumes those queue items. The old `toplu-uret-uzun.cjs` is a generic Singularity Horizon batch renderer and must not be treated as production support for either current channel. Daily reports therefore show `due-not-produced` honestly.

### Open — qualified inventory targets are not met

Failure Reconstructed has 46 qualified topics / 38 unused ready Shorts, below the requested 500. ImpossibleBrief has 500 qualified / 499 ready, below the requested 1,000. The health command now reports target failure, duplicate rate, source-ready rate, visual-ready rate, and days of inventory instead of treating the shortfall as healthy. Bulk unsourced title generation was deliberately not used to inflate the numbers.

### Partially fixed — GitHub schedule reliability

The deadline checker, automatic recovery, idempotent shared concurrency, and recovery test are implemented for Failure Reconstructed. The external trigger needs the manual deployment above. ImpossibleBrief remains disabled until OAuth setup, so its SLA cannot yet become healthy.

## MEDIUM

- Failure Reconstructed still allows legacy unscoped `YT_*` credentials during migration. ImpossibleBrief never falls back. Migrate FR to `FR_YT_*`, verify one run, then disable `allowLegacyYouTubeEnv`.
- The TikTok registry records inbox submission state; TikTok's current remote state is collected as a diagnostic artifact rather than committed automatically. This avoids confusing an inbox upload with a public post.
- TikTok inbox mode is not public automation. `SEND_TO_USER_INBOX` requires opening the notification/draft in the authorized TikTok account and publishing manually.
- GitHub issue notifications depend on repository/mobile notification settings. The operational JSON/Markdown report is the durable source of truth when push/email is suppressed.
- Portfolio production serializes both channels in one job. This protects the single render/upload lane but means a very long render delays the other channel.
- YouTube Studio-only fields such as viewed-vs-swiped and some impression/CTR/returning-viewer data remain `null` unless manually exported. The dashboard does not invent them.

## LOW

- Several older comments/docs described multiple GitHub cron entries as independent and REVIEW as a private-upload path. Current documents correct those statements; historical files may still use Turkish legacy names.
- Actions warns that some `actions/*@v4` JavaScript actions are being forced from Node 20 to Node 24 by the runner image. This is upstream action/runtime maintenance, not a production failure.

## Implemented controls

- Channel-scoped credentials, state, analytics, memory, topic library, publication registry, notification state, scheduler state, and production paths.
- `authenticatedChannelId === expectedChannelId` before every YouTube write.
- YouTube title/registry duplicate guard, TikTok durable `publishId` duplicate guard, channel/date scheduling guard, and shared concurrency group.
- SLA JSON includes topic/script/assets/render/quality, `youtubeUploaded`, `youtubeScheduled`, `publishAt`, `videoId`, recovery, notification, and verification state.
- TikTok exact YouTube artifact + SHA-256 handoff, one oldest backlog item, safe account pin, and remote-status diagnostic.
- Daily human/machine operations report and expanded 30-day safety simulation.

## Honest readiness

Failure Reconstructed Shorts can run without a daily manual trigger, but independent watchdog deployment is still required for scheduler fault isolation. ImpossibleBrief cannot publish until its one-time OAuth setup. TikTok inbox delivery works, but public posting remains intentionally manual. Long-form is not automated. Current verdict: `PARTIALLY_AUTONOMOUS`.
