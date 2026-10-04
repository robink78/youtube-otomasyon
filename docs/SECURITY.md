# Security model

## Secret boundaries

Secrets belong only in local `.env`, GitHub Actions encrypted secrets, or Cloudflare Worker secrets. Never commit or print OAuth client secrets, refresh/access tokens, TikTok tokens, API keys, or repository dispatch tokens. Generated diagnostic artifacts contain booleans/status/hashed account identity, not token values.

Channel secret namespaces are `FR_YT_*`, `IB_*`/`IB_YT_*`, and `CT_*`/`CT_YT_*`. ImpossibleBrief and CriticalThread cannot inherit legacy `YT_*`. Failure Reconstructed's legacy fallback is temporary, complete-bundle migration compatibility; partial preferred credentials are never mixed with legacy values.

## Write guards

- YouTube: OAuth refresh → upload-scope verification → `channels?mine=true` (exactly one identity) → exact expected channel-ID comparison → duplicate lookup → upload session. A missing scope/ID or mismatch blocks all writes for that channel only.
- TikTok: refresh → scope check → `user/info` → SHA-256 open-ID pin comparison → duplicate-registry check → upload init. The raw open ID is never stored or logged.
- Quality: only `PUBLISH` may upload or receive `publishAt`; REVIEW/BLOCK are rejected in both orchestration and uploader layers.

## Logs and artifacts

Upload results may contain public video IDs, slugs, timestamps, file hashes, quality decisions, and platform status. They must not contain Authorization headers or token values. `youtube-yetki.js` no longer prints a refresh token when local persistence fails.

## Repository scan

The current tracked tree and Git history were searched for common Google/GitHub token patterns and private key headers without printing matched values. No credential value was found. `.env` is ignored; `.env.ornek` contains placeholders only. If a future scan flags a real secret, report only its name/path, revoke it at the provider, rotate the relevant channel only, and purge history with a reviewed procedure.

## Least privilege and rotation

- GitHub workflow permissions are declared per workflow. Production uses contents/issues write only where state/notifications require it.
- The external watchdog uses a fine-grained repository token stored only as a Worker secret.
- Rotate one platform/channel at a time, disable its publish variable during rotation, verify identity, and then re-enable.
- Never weaken an identity guard to recover from a mismatch.
