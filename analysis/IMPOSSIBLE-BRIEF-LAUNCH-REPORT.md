# ImpossibleBrief launch report

Report date: 2026-09-27

## Architecture changes

- Added a registry-driven channel context and isolated path/credential resolution.
- Preserved Failure Reconstructed through a legacy-path adapter; its original growth config remains authoritative.
- Added isolated ImpossibleBrief config, brand, prompts, topics, analytics, state, memory, production, and reports.
- Made the major CLI workflows accept `--channel`, defaulting safely to Failure Reconstructed.
- Added a pre-upload authenticated YouTube channel-ID guard. Missing or mismatched identity blocks before any remote/local publish mutation.
- Added shared discovery, research, scripting, visual planning, rendering, publishing, analytics, retention, experimentation, quality, scheduling, notification, and simulation modules.
- Added sequential portfolio scheduling, one-render/one-upload resource limits, channel-scoped notifications, portfolio dashboard data, and independent retention memory.
- Replaced scheduled single-channel production with a failure-isolated two-channel workflow; retained the old workflow as manual rollback.

## Files created

Major additions include `config/channels.json`; both `channels/<slug>/` trees; `core/channel-context.js`; the `core/` stage modules; `library-health.js`; `portfolio-scheduler.js`; `portfolio-dashboard.js`; `e2e-impossible-brief.js`; `simulate-portfolio.js`; topic/voice generation scripts; `.github/workflows/portfolio-production.yml`; multi-channel tests; and the three requested documents.

## Files modified

Channel awareness and safety were added to the settings/library/YouTube clients, Shorts queue, uploader, OAuth helper, health check, notifications, quality gate, schedule, analyzer, dashboard, channel plan, package scripts, environment example, README, gitignore, and existing Actions workflows.

## Regression results

- JavaScript: **54/54 passed**, including the original Failure Reconstructed suite, real FFmpeg overflow test, and 11 new multi-channel tests.
- Python: **24/24 passed** using the bundled Python runtime.
- Syntax/JSON: all JavaScript/CommonJS files compile and all configuration/channel JSON parses.
- The system `python3` shim is blocked locally by an unaccepted Xcode license; this is environmental. The bundled Python runtime passed all tests.
- The installed Homebrew FFmpeg is linked to a missing x265 dylib. Verification used a working local static FFmpeg/FFprobe pair; GitHub Actions installs fresh Ubuntu FFmpeg.

## ImpossibleBrief topic count

**500 qualified topics**: 125 space, 100 Earth, 100 physics, 50 human, 50 future technology, 50 extreme science, and 25 other. Exact duplicate count: 0.

## Ready Shorts count

**500** at launch. No topic was consumed by E2E because all three runs were explicitly dry runs.

## Days of inventory

**500 days / 16.4 months** at one Short per day. Acceptance minimum of 365 days: PASS.

## Long-form readiness

**304 topics** score at least 75 for long-form depth. ImpossibleBrief cadence is one every seven days, with 6–12 minute structure templates.

## Auth status

**Not authorized; blocked by design.** No secrets or channel IDs were supplied, read, or invented. Real upload remains disabled until the manual steps below are complete. This is the correct launch state.

## E2E results

Three no-upload Shorts passed all checks:

| Category | Topic | Duration | Media |
|---|---|---:|---|
| Space | What If the Moon Disappeared Tonight? | 19.784 s | 1080×1920, claim-timed audio/captions, scenario diagram |
| Earth | What If Earth Stopped Spinning for One Second? | 18.625 s | 1080×1920, claim-timed audio/captions, scenario diagram |
| Physics | What If Gravity Doubled Tomorrow? | 19.134 s | 1080×1920, claim-timed audio/captions, scenario diagram |

Each also passed science/claim separation, direct authoritative sources, hook, eight visual changes at no more than 3.5-second intervals, an explicit procedural-illustration label, 20 titles, scenario-specific thumbnail, description, quality gate, and channel metadata. `uploadAttempted` is false.

## 30-day simulation result

**PASS.** Output was 30 FR Shorts, 30 IB Shorts, 6 FR long-form slots, and 5 IB long-form slots. Injected failures covered expired channel token, network, render, upload, quality block, state conflict, and API outage. Every failure recovered without blocking the other channel. Checks passed for no wrong-channel upload, no duplicate upload, no topic loss, no state collision, and concurrency limits.

## Remaining manual steps

1. Create or select the ImpossibleBrief YouTube channel and copy its `UC...` channel ID.
2. In Google Cloud, configure/publish the OAuth consent app and enable YouTube Data API v3 plus YouTube Analytics API.
3. Authorize each channel separately:
   - `node youtube-yetki.js --channel failure-reconstructed`
   - `node youtube-yetki.js --channel impossible-brief`
4. Add GitHub secrets `FR_YT_CLIENT_ID`, `FR_YT_CLIENT_SECRET`, `FR_YT_REFRESH_TOKEN`, `IB_YT_CLIENT_ID`, `IB_YT_CLIENT_SECRET`, and `IB_YT_REFRESH_TOKEN`.
5. Add GitHub variables `FR_YT_CHANNEL_ID` and `IB_YT_CHANNEL_ID`. Keep `IB_PUBLISH` unset/`0` initially.
6. Upload/confirm the ImpossibleBrief profile image, banner, handle, description, and channel-level defaults manually in YouTube Studio.
7. Run the portfolio workflow with `dry_run=true`; confirm its printed authenticated channel identity and preview artifact.
8. Only then set `IB_PUBLISH=1`. Set/migrate `FR_PUBLISH=1` and namespaced FR secrets when ready; unscoped FR secrets remain temporarily compatible.
9. Repair local Homebrew FFmpeg before local production (`brew reinstall ffmpeg`, or otherwise restore its x265 dependency). CI is unaffected.
10. Keep Instagram/TikTok disabled until their channel-specific credentials and state are configured and separately tested.

## Acceptance decision

All code-verifiable acceptance criteria pass. External channel creation, OAuth authorization, branding upload, and enabling real publishing are intentionally pending manual owner authorization.
