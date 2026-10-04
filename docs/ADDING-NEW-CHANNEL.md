# Adding another channel

Do not copy the application. Add data and registry entries around the shared core.

1. Choose a lowercase slug and a unique credential prefix.
2. Add the channel under `config/channels.json`, pointing to its config and brand files.
3. Create `channels/<slug>/config.json` with slug/name, expected YouTube channel ID, prefix, `pathMode: isolated`, timezone, publish time, Short/long cadence, voice, niche, topic rules, quality thresholds, retention rules, CTA, thumbnail/title styles, analytics, and disabled-by-default external platforms.
4. Create `brand.json`, `prompts/`, `topics/`, `analytics/`, `state/`, `memory/`, and `reports/`. Seed separate `published.json`, `generated.json`, `blocked.json`, `upload-state.json`, `analytics-state.json`, `scheduler-state.json`, and `platform-state.json`.
5. Add or import a source-based topic universe. Run its research/quality audit and `library-health.js` before enabling production.
6. If the niche needs special editorial logic, add a small channel pipeline under `core/pipeline/`; keep discovery, research, rendering, publishing, analytics, retention, scheduling, and notifications shared.
7. Create separate OAuth credentials/secrets: `<PREFIX>_YT_CLIENT_ID`, `<PREFIX>_YT_CLIENT_SECRET`, `<PREFIX>_YT_REFRESH_TOKEN`, and `<PREFIX>_YT_CHANNEL_ID`. Never enable legacy unscoped fallback for a new channel.
8. Add an isolated step to `portfolio-production.yml`. Keep it sequential if global render/upload capacity is one, and set `continue-on-error` so another channel is not blocked.
9. Extend tests for path isolation, credential isolation, authenticated-ID mismatch, independent analytics/topic/memory state, scheduling, notifications, and a no-upload E2E package.
10. Run `npm test`, a rendered dry run, and the 30-day simulation. Enable the channel's publish variable only after every check passes and a human verifies the channel identity in the dry-run output.

The upload guard and `lib/kutuphane.js` state guard require no channel-specific changes. If either rejects the new channel, fix configuration; do not bypass the guard.
