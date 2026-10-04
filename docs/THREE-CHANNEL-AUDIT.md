# Three-channel production audit — 29 September 2026

Scope: `main` at `c105696`, the complete repository tree and current workflows, channel configuration, credential naming, YouTube writers, publication/upload/analytics/learning state, quality gates, topic inventories, scheduler recovery, TikTok integration, tests, and the live repository configuration visible through GitHub CLI. Secret values were neither read nor printed.

## Architecture found

The repository already had the correct shared-core/channel-adapter shape. This change extends it; it does not create a second automation system.

| Area | Failure Reconstructed | ImpossibleBrief | CriticalThread |
|---|---|---|---|
| Path mode | `legacy-adapter` | isolated | isolated |
| YouTube | enabled | enabled, publish flag required | enabled, publish flag required |
| TikTok | enabled | disabled | disabled |
| State | existing `icerik/`, `analytics/`, `channel/` paths | `channels/impossible-brief/` | `channels/critical-thread/` |
| Learning | channel-owned | channel-owned | channel-owned |
| OAuth | legacy `YT_*` fallback plus preferred `FR_YT_*` | `IB_*` client pair and `IB_YT_*` token/ID | `CT_*` client pair and `CT_YT_*` token/ID |

The channel registry and `core/channel-context.js` resolve all channel-specific paths and credentials. Shared code provides discovery, research, scripting, visuals, rendering, quality, publishing, analytics, retention, scheduling, simulation and notifications. Channel prompts, topics, brand, state, analytics baselines and learned data remain separate.

The deployed Cloudflare Worker is an independent trigger at `16:35 UTC`, five minutes after the `16:30 UTC` SLA. The GitHub-native `17:07 UTC` watchdog remains a secondary path. Deployment run `36483342904`, self-test run `36483450735`, and receiver run `36483466177` established live deployment and an HTTP 204 `repository_dispatch` chain without starting video production.

## CRITICAL

### Fixed — configured ImpossibleBrief client names were not consumed

The repository expected `IB_YT_CLIENT_ID` / `IB_YT_CLIENT_SECRET`, while the live repository had `IB_CLIENT_ID` / `IB_CLIENT_SECRET`. The channel configuration now names the actual secrets first and retains the old forms only as explicit aliases. CriticalThread uses the same deliberate mapping for `CT_CLIENT_ID` / `CT_CLIENT_SECRET`.

### Fixed — OAuth logic was duplicated across write scripts

Upload, metadata update, playlist and comment code had separate token-refresh implementations. All YouTube writers now call the shared `lib/yt.js` layer. It refreshes access tokens, retries transient failures, reads the authenticated identity and compares it with the selected channel's configured ID before any write.

### Fixed — not every write path enforced the same channel invariant

The invariant is now:

```text
authenticatedChannelId === expectedChannelId
```

A missing expected ID or any mismatch blocks upload-session creation, metadata, playlists, comments and state mutation. Tests cover all six cross-channel directions: FR→IB, FR→CT, IB→FR, IB→CT, CT→FR and CT→IB.

### Fixed — SLA recovery could treat OAuth/API ambiguity as absence

ImpossibleBrief recovery previously keyed off a broad not-ready condition. All channel watchdog recovery now requires `safe_to_recover == true`, which is emitted only after YouTube positively verifies that today's video is absent. An auth/API failure fails closed and opens the channel-specific notification path instead of risking a duplicate.

## HIGH

### Fixed in code; one-time owner action remains — ImpossibleBrief OAuth

`IB_CLIENT_ID` and `IB_CLIENT_SECRET` exist in GitHub. `IB_YT_REFRESH_TOKEN`, `IB_YT_CHANNEL_ID` and `IB_PUBLISH=1` do not. The authorization helper is ready and saves the refresh token directly to GitHub without printing it, but Google consent must be completed once by the channel owner.

### Fixed in code; one-time owner action remains — CriticalThread OAuth

`CT_CLIENT_ID` and `CT_CLIENT_SECRET` exist in GitHub. `CT_YT_REFRESH_TOKEN`, `CT_YT_CHANNEL_ID` and `CT_PUBLISH=1` do not. The channel is deliberately dormant until its one-time consent and identity check pass.

### Fixed — Testing-mode tokens were treated as an operational norm

The repository now distinguishes normal hourly access-token renewal from exceptional refresh-token invalidation. Documentation requires each External OAuth app used unattended to be moved out of Testing. Google's current documentation says a Testing refresh token for an External app generally expires after seven days; daily token replacement is therefore not an acceptable production design.

### Fixed — CriticalThread was absent

CriticalThread now has its own configuration, brand, prompt, 522-topic qualified inventory, analytics baseline, learning/retention memory, publication/upload/scheduler/notification/health state, research standard, quality gate, title system, five-concept thumbnail plan, long-form outline and long-to-short package.

### Open — long-form is package-ready, not production-render/upload ready

All three channel configs model long cadence, and CriticalThread produces an 8–18 minute evidence/visual/title/thumbnail outline plus four standalone Short angles. The daily Actions workflow still consumes only Short work. There is no honest premium 8–18 minute, source-checked long-form renderer/upload job yet; enabling one would overstate current capability. This does not block daily Shorts autonomy but prevents describing the complete portfolio as fully autonomous.

## MEDIUM

- Failure Reconstructed still accepts unscoped legacy `YT_*` credentials for migration. Its preferred namespace is `FR_YT_*`; remove fallback only after the preferred secrets pass the health workflow.
- The portfolio workflow serializes renders/uploads to avoid shared-runner races. A long render can delay a later channel, but one channel failure is marked `continue-on-error` and does not cancel the others.
- YouTube Analytics exposes many requested metrics, but some YouTube Studio-only dimensions can remain unavailable. Missing values remain unavailable; the system does not synthesize them.
- `SEND_TO_USER_INBOX` keeps Failure Reconstructed's TikTok handoff working but does not itself make a public TikTok post. TikTok remains disabled for ImpossibleBrief and CriticalThread.
- CriticalThread inventory demand/competition scores are qualified seed estimates until channel-specific search/Analytics observations exist. They are labeled as such and are not presented as measured Google demand.

## LOW

- Older documentation described a two-channel system and undeployed watchdog. This branch replaces those statements in the primary runbooks; historical audit files remain historical evidence.
- The user referred to the IB account as InformationBrief, while the attached canonical definition and existing repository slug are `ImpossibleBrief` / `impossible-brief`. Code preserves the repository's canonical identity; the channel-ID check is authoritative for the actual destination.
- The local Homebrew FFmpeg symlink on the audit machine had a missing dynamic library. The dry run used an isolated static FFmpeg binary; GitHub Actions installs Ubuntu FFmpeg on every render job.

## Implemented controls and evidence

- Shared automatic access-token refresh with three bounded attempts for transient failures.
- Safe error classes: `MISSING_SECRET`, `INVALID_GRANT`, `TOKEN_REVOKED`, `CLIENT_MISMATCH`, `CHANNEL_MISMATCH`, `API_DISABLED`, `INSUFFICIENT_SCOPE`, `QUOTA_ERROR`, `TRANSIENT_AUTH_ERROR`, `UNKNOWN_AUTH_ERROR`.
- `oauth-health.js` plus a channel-isolated scheduled/manual Actions health workflow.
- No token value in health output, error messages, authorization output or test fixtures.
- CriticalThread dry render: 26.209 seconds, 1080×1920, audio present, captions burned, eight visual changes, quality decision `PUBLISH`, upload disabled.
- 30-day simulation: 30 Shorts per channel; FR/IB/CT long cadence modeled as 6/5/5; 11 injected failures; all six channel mismatches blocked; no duplicate uploads or state collisions; TikTok backlog 3→0.
- JavaScript suite: 77 tests, 76 passed and one environment-dependent render test skipped before the explicit render; the explicit CriticalThread render passed. All 24 Python tests passed.

## Security scan

A high-confidence filename-only scan covered the current tree and the most recent 300 commits for Google API keys, Google client secrets, Google refresh/access tokens, GitHub tokens and private-key headers. It found zero files in every category. GitHub's repository secret-scanning API reported zero open alerts. `.env`, generated media and local secret paths remain ignored. No `ROTATION_REQUIRED` finding was produced.

## Readiness decision

Shorts code is ready for three independent YouTube identities. Failure Reconstructed remains active. ImpossibleBrief and CriticalThread must remain disabled until their refresh tokens and channel IDs pass `youtube-oauth-health.yml`. External watchdog recovery is deployed and independently tested. Long-form production remains a separately visible gap rather than a false capability claim.
