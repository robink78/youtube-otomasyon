# Independent production watchdog

This Cloudflare Worker is the independent daily clock. At 16:35 UTC it sends
`repository_dispatch: production-sla-watchdog` to GitHub. The receiving workflow
runs `production-sla-check.js` and starts production automatically when the
day's scheduled video is missing. GitHub's own 17:07 UTC watchdog cron remains a
secondary fallback, but it is not counted as independent.

Deployment requires a free Cloudflare Workers account and three repository
secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` scoped to edit Workers
- `WATCHDOG_GITHUB_TOKEN`, a fine-grained GitHub token scoped only to this
  repository with **Contents: Read and write** (required by GitHub's
  `Create a repository dispatch event` endpoint). A classic PAT needs `repo`.

Run the `Deploy independent production watchdog` workflow once. It deploys the
Worker, stores `WATCHDOG_GITHUB_TOKEN` as an encrypted Worker secret, and applies
the Cron Trigger. It then verifies the Cloudflare deployment list, configured
schedule and live `/health` response, and retains these as a 90-day Actions
artifact. Neither token is printed. `/health` reports only safe metadata:
`tokenConfigured`, `repository`, `cron`, `deadlineUtc`, `version`, and `commit`.

The Worker requires GitHub to return HTTP `204` for every dispatch. Any other
status is logged with status text, GitHub request ID and a bounded response body;
the credential itself is never logged. Run `Watchdog repository_dispatch
self-test` after every token rotation to verify the actual token without making
a video. Change the deadline by editing `wrangler.toml`, the deploy workflow
cron constant, and the `PRODUCTION_DEADLINE_UTC` repository variable together;
deployment refuses any combination that is not exactly five minutes apart.

Full commands and recovery verification are in `README.md` and
`docs/SCHEDULER-RECOVERY.md`.
