# Four-channel YouTube OAuth operations

## Architecture and isolation

The runtime path is one long-lived refresh token per YouTube identity → a newly refreshed short-lived access token → scope verification → `channels.list(part=id,snippet,mine=true)` → comparison with the configured channel ID → the requested API operation.

All upload and write entry points use `lib/yt.js`. `youtube-yukle.js` performs this pre-flight before it opens an upload session. A missing/revoked token, missing upload scope, missing expected ID, or identity mismatch blocks only the selected channel. The portfolio workflow continues its other channel steps.

| Channel | Client ID secret | Client secret | Refresh token secret | Expected channel ID variable |
|---|---|---|---|---|
| Failure Reconstructed | `FR_YT_CLIENT_ID` | `FR_YT_CLIENT_SECRET` | `FR_YT_REFRESH_TOKEN` | `FR_YT_CHANNEL_ID` |
| ImpossibleBrief | `IB_CLIENT_ID` | `IB_CLIENT_SECRET` | `IB_YT_REFRESH_TOKEN` | `IB_YT_CHANNEL_ID` |
| CriticalThread | `CT_CLIENT_ID` | `CT_CLIENT_SECRET` | `CT_YT_REFRESH_TOKEN` | `CT_YT_CHANNEL_ID` |
| The Hidden Logic of Things | `BTO_YT_CLIENT_ID` | `BTO_YT_CLIENT_SECRET` | `BTO_YT_REFRESH_TOKEN` | `BTO_YT_CHANNEL_ID` |

`IB_YT_CLIENT_ID`/`IB_YT_CLIENT_SECRET` and `CT_YT_CLIENT_ID`/`CT_YT_CLIENT_SECRET` remain accepted channel-local aliases. Failure Reconstructed alone accepts `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`, and `YT_CHANNEL_ID` as a migration fallback. If any preferred `FR_YT_*` OAuth credential exists, the resolver requires the complete preferred bundle and will not mix missing values from `YT_*`.

One Google OAuth client ID/secret may intentionally be shared, but each channel must still have its own refresh token and expected channel ID. Separate clients are preferred because they reduce rotation blast radius.

Required scopes are defined once in `lib/yt.js`:

- `youtube.force-ssl` for uploads, metadata, playlists, comments, and other channel writes;
- `yt-analytics.readonly` for this repository's analytics jobs.

Do not add broader scopes unless a concrete repository feature requires them.

## GitHub configuration

Put client IDs, client secrets, refresh tokens, `PEXELS_KEY`, and TikTok credentials in GitHub Actions **Secrets**. Put non-secret expected YouTube channel IDs in Actions **Variables**. `GITHUB_TOKEN` is supplied automatically.

Optional repository variable `YOUTUBE_HEALTH_ISSUE_NUMBER` pins the persistent report to a specific issue. If absent, the updater finds the existing `saglik` issue (including the historical issue #74) and reuses it.

Never store credentials in channel config JSON, tracked state, artifacts, issue bodies, workflow inputs, screenshots, or command-line arguments.

## Google Auth Platform: Testing versus In production

In Google Cloud Console, open the project that owns the OAuth client, then **Google Auth Platform → Audience**. Check **Publishing status**:

- **Testing**: only listed test users can authorize. For non-basic scopes, refresh tokens can expire after seven days. This is unsuitable for unattended publishing.
- **In production**: refresh tokens do not have a universal weekly expiry. They can still be invalidated by revocation, prolonged non-use, client deletion/change, token limits, account security policy, or Workspace session policy.

For each client used by automation:

1. Enable YouTube Data API v3 and YouTube Analytics API.
2. Configure Branding, support email, and developer contact.
3. Use an External audience unless every operator is inside an eligible Google Workspace organization.
4. Add only the two required scopes above.
5. Move the app to **In production** for unattended automation.
6. Complete Google's verification process if the console requires it for the requested sensitive scopes. Publishing status and verification cannot be changed by this repository.
7. Use a Desktop OAuth client because the helper returns to `http://localhost:53682`.

The stored `oauth-reauth-deadline` is operational metadata, not a claim that every Google refresh token has a fixed expiry. It is derived only when the helper records `--oauth-mode=testing`, or when an explicit deadline is present. Live token refresh is always tested. Thresholds are WARNING at seven days or less, CRITICAL at 48 hours or less, and EXPIRED after the deadline.

## Failure Reconstructed migration from legacy `YT_*`

Failure Reconstructed currently authenticates in GitHub with the legacy `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, and `YT_REFRESH_TOKEN` secrets. This still works, but the health report shows `credential-isolation` as WARNING (`LEGACY_CREDENTIAL_FALLBACK`) until the channel moves to `FR_YT_*`.

Running the FR authorization command below with `--github` completes the migration in one step: it writes `FR_YT_CLIENT_ID`, `FR_YT_CLIENT_SECRET`, and `FR_YT_REFRESH_TOKEN` together (always the client pair that minted the token), so the bundle can never be partial. Never create only `FR_YT_REFRESH_TOKEN` by hand: once any `FR_YT_*` OAuth secret exists, the resolver stops reading `YT_*`, and an incomplete bundle blocks FR uploads (`PARTIAL_CREDENTIAL_MIGRATION`). After a green health run, delete the three legacy `YT_*` secrets.

## Authorize or rotate one channel

Run only on a trusted local checkout. The helper uses offline access, forces account selection and consent, verifies the authenticated YouTube channel, writes the token only to gitignored `.env` with mode `0600`, and optionally sends it to GitHub through `gh secret set` over stdin. With `--github` it also writes that channel's client ID/secret under the preferred names, so the GitHub bundle always matches the client that minted the token. It never prints the token.

Failure Reconstructed:

```bash
export FR_YT_CLIENT_ID='copy locally from Google Cloud'
read -r -s -p 'FR client secret: ' FR_YT_CLIENT_SECRET; printf '\n'
export FR_YT_CLIENT_SECRET
node youtube-yetki.js --channel failure-reconstructed --oauth-mode=production --github --repo=eyazan/youtube-otomasyon
unset FR_YT_CLIENT_ID FR_YT_CLIENT_SECRET
```

ImpossibleBrief:

```bash
export IB_CLIENT_ID='copy locally from Google Cloud'
read -r -s -p 'IB client secret: ' IB_CLIENT_SECRET; printf '\n'
export IB_CLIENT_SECRET
node youtube-yetki.js --channel impossible-brief --oauth-mode=production --github --repo=eyazan/youtube-otomasyon
unset IB_CLIENT_ID IB_CLIENT_SECRET
```

CriticalThread:

```bash
export CT_CLIENT_ID='copy locally from Google Cloud'
read -r -s -p 'CT client secret: ' CT_CLIENT_SECRET; printf '\n'
export CT_CLIENT_SECRET
node youtube-yetki.js --channel critical-thread --oauth-mode=production --github --repo=eyazan/youtube-otomasyon
unset CT_CLIENT_ID CT_CLIENT_SECRET
```

The Hidden Logic of Things (first authorization; omit `--new-channel` after its expected ID is stored):

```bash
export BTO_YT_CLIENT_ID='copy locally from Google Cloud'
read -r -s -p 'BTO client secret: ' BTO_YT_CLIENT_SECRET; printf '\n'
export BTO_YT_CLIENT_SECRET
node youtube-yetki.js --channel behind-the-ordinary --oauth-mode=production --new-channel --github --repo=eyazan/youtube-otomasyon
unset BTO_YT_CLIENT_ID BTO_YT_CLIENT_SECRET
```

The success output identifies the authenticated channel name/ID and the exact refresh-token secret/channel-ID variable that were updated. If the expected ID was already configured and does not match, the token is discarded.

If the app really remains in Testing, use `--oauth-mode=testing`; the health checker will record the seven-day re-authorization window accurately.

## Test health manually

All four channels, including inventory and channel capabilities:

```bash
node oauth-health.js --check-all
```

One channel as safe JSON:

```bash
node oauth-health.js --channel impossible-brief
```

The all-channel command completes every check even when one channel is critical. Its exit code is non-zero after the full report is written if any channel has a critical condition.

Test the real GitHub secret context:

```bash
gh workflow run youtube-oauth-health.yml -R eyazan/youtube-otomasyon
gh run list -R eyazan/youtube-otomasyon --workflow youtube-oauth-health.yml --limit 1
gh run watch RUN_ID -R eyazan/youtube-otomasyon --exit-status
```

The scheduled workflow runs every six hours (05:30, 11:30, 17:30, 23:30 UTC; the first run precedes the 06:00 UTC production slot), writes a Markdown table to the Actions job summary, uploads JSON/Markdown evidence, and updates one persistent issue. It edits the issue body every run but comments only when a status/error code changes, a warning/critical threshold is crossed, or a channel recovers. The issue stays open while anything needs attention and closes itself once every check is healthy; no issue is created while everything is healthy.

## Common errors

| Code/symptom | Meaning | Recovery |
|---|---|---|
| `INVALID_GRANT` | Refresh token expired, was revoked, belongs to another OAuth client, or can no longer be used | Keep only that channel disabled, confirm client pair, and re-authorize it |
| `TOKEN_REVOKED` / `ACCESS_DENIED` | Owner/admin/security policy revoked access | Resolve policy/consent, then re-authorize |
| `INVALID_CLIENT` | Client ID/secret is wrong or malformed | Replace that channel's client pair and rotate its refresh token |
| `UNAUTHORIZED_CLIENT` | OAuth client is not allowed to use this grant/configuration | Check client type, project, and Auth Platform configuration |
| `redirect_uri_mismatch` during consent | Desktop client/redirect configuration is wrong | Use the Desktop client expected by the helper and `http://localhost:53682` |
| `INSUFFICIENT_SCOPE` | One of the two repository-required scopes was not granted | Add the scope in Data Access, revoke old consent if necessary, and re-authorize |
| `CHANNEL_MISMATCH` | Token owns a different YouTube/Brand channel | Do not upload; repeat consent with the correct account/channel |
| `CHANNEL_ID_MISSING` | Expected `UC...` variable is absent | Set the channel-specific GitHub variable after independently confirming the ID |
| `REAUTH_DEADLINE_*` | Stored Testing-mode deadline reached a threshold | Move the app to In production and re-authorize, or rotate before the deadline |

## Emergency recovery

1. Set only the affected channel's publish variable to `0` (`FR_PUBLISH`, `IB_PUBLISH`, `CT_PUBLISH`, or `BTO_PUBLISH`; legacy FR may also use `PUBLISH`).
2. Run the single-channel health command and save only the safe code/expected/authenticated IDs.
3. In Google Auth Platform, confirm the correct project/client, Audience status, APIs, and scopes.
4. Revoke the suspect grant if compromise or cross-channel reuse is possible.
5. Run the channel-specific authorization command above.
6. Run `node oauth-health.js --check-all` locally, then dispatch the GitHub health workflow.
7. Confirm refresh, scopes, and channel ID are PASS for the affected channel; confirm the other three remained healthy.
8. Re-enable only that channel's publish variable.

If any client secret or refresh token ever entered Git history, an issue, an artifact, or a log, deleting the visible file is insufficient: revoke/rotate the credential and consider history remediation.
