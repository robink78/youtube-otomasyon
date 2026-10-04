# Google OAuth production setup (legacy two-channel notes)

> The authoritative three-channel procedure and current secret names are in [OAUTH-THREE-CHANNELS.md](OAUTH-THREE-CHANNELS.md). This file is retained for the existing ImpossibleBrief domain/branding deployment details.

The repository is code-ready for two isolated OAuth identities. Google Cloud configuration, domain deployment, and one interactive authorization per channel remain manual because consent must be granted by the channel owner.

## 1. Verify domain ownership

Verify the DNS property `yazansoft.com.tr` in Google Search Console with the DNS TXT record supplied by Google. Keep the record in DNS. Confirm ownership using the same Google account that manages the Cloud project.

## 2. Authorized domain

In Google Auth Platform → Branding → Authorized domains, add exactly:

```text
yazansoft.com.tr
```

Do not enter the subdomain or a URL in this field.

## 3–5. Deploy and register the public URLs

Deploy `oauth-site/` as the Vercel project root and map `impossiblebrief.yazansoft.com.tr` to it. Verify all three return HTTP 200 without authentication:

```text
Homepage: https://impossiblebrief.yazansoft.com.tr/
Privacy:  https://impossiblebrief.yazansoft.com.tr/privacy/
Terms:    https://impossiblebrief.yazansoft.com.tr/terms/
```

The homepage visibly shows `ImpossibleBrief`, `Impossible questions. Scientific answers.`, API purpose, owner/contact, privacy, and terms links.

## 6. OAuth branding

Set app name `ImpossibleBrief`, a support email controlled by the owner, the homepage/privacy/terms URLs above, and an authorized developer-contact email. Use a consistent app logo if Google requests it. The statements on the consent screen must match the deployed policy and actual code.

## 7. Publish the app

In Google Auth Platform → Audience, move the app from Testing to Production. Complete Google's verification process if required for the requested sensitive scopes. Testing-mode refresh tokens can expire after seven days; do not call the system unattended while the project remains in Testing.

## 8. Required scopes

The authorization code requests only:

```text
https://www.googleapis.com/auth/youtube.force-ssl
https://www.googleapis.com/auth/yt-analytics.readonly
```

`youtube.force-ssl` covers upload and metadata/comment/playlist management. `yt-analytics.readonly` covers aggregate performance, traffic, and retention analysis. Do not add broader Google scopes.

## 9. Authorize each channel separately

Create an OAuth Desktop client (the callback is local) and add its ID/secret locally under the correct prefix. Then run each flow independently:

```bash
node youtube-yetki.js --channel failure-reconstructed
node youtube-yetki.js --channel impossible-brief
```

For each consent screen, select the Google/Brand account owning the named YouTube channel. The callback fetches `channels?mine=true`; if the actual ID differs from the configured expected ID, it discards the token.

## 10. Generate refresh tokens safely

The command uses `access_type=offline` and `prompt=consent`. On success it writes the prefixed refresh token to local `.env`; it never prints the value. If writing fails, fix file permissions and repeat. Do not paste tokens into issues, chat, commits, screenshots, or workflow logs.

## 11. GitHub secrets and variables

Actions secrets:

```text
FR_YT_CLIENT_ID
FR_YT_CLIENT_SECRET
FR_YT_REFRESH_TOKEN
IB_YT_CLIENT_ID
IB_YT_CLIENT_SECRET
IB_YT_REFRESH_TOKEN
```

Actions variables:

```text
FR_YT_CHANNEL_ID
IB_YT_CHANNEL_ID
FR_PUBLISH=1
IB_PUBLISH=1
PRODUCTION_DEADLINE_UTC=16:30
```

Keep `IB_PUBLISH` absent or `0` until its credentials and expected channel ID all pass `node saglik.js --channel impossible-brief`. Failure Reconstructed currently supports legacy `YT_*` only for migration; copy those values to `FR_YT_*`, validate, then remove the legacy secrets.

## 12. Rotation and revocation

1. Set the affected channel's publish variable to `0`.
2. Revoke the app at Google Account → Security → Third-party connections.
3. Run the channel-specific `youtube-yetki.js` flow again.
4. Replace only that channel's GitHub refresh-token secret.
5. Run `node saglik.js --channel <slug>` and an Actions dry run.
6. Confirm the channel-ID guard, then restore the publish variable to `1`.
7. Delete obsolete local token values and never retain them in support artifacts.

Rotating one channel must not change the other channel's secrets.
