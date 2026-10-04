# Scheduler and recovery

## Architecture and clocks

1. `uretim.yml` (`14:53 UTC`) and `portfolio-production.yml` are GitHub-scheduled producers.
2. `production-watchdog.yml` is the GitHub-native backup (`17:07 UTC`) and the receiver for the independent dispatch.
3. `ops/production-watchdog-worker` is the independent Cloudflare clock. Its Cron Trigger is `35 16 * * *`: `16:35 UTC`, exactly five minutes after the `16:30 UTC` SLA deadline.
4. `yayin-kontrol.yml` remains a GitHub-native publication/empty-day observer. It does not replace the independent clock.

Cloudflare sends `repository_dispatch: production-sla-watchdog`. The receiver authenticates to the expected Failure Reconstructed YouTube channel, scans its recent uploads, and authorizes recovery only when no Short has today's `status.publishAt`/`snippet.publishedAt`. An API, OAuth or channel-identity error fails closed and creates an issue instead of risking a duplicate.

ImpossibleBrief jobs remain dormant unless repository variable `IB_PUBLISH=1`; the Worker does not bypass this gate.

## Current deployment status (28 September 2026 audit)

Repository/Actions evidence at audit time showed:

- no run had ever been created for `deploy-watchdog.yml`;
- `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, and `WATCHDOG_GITHUB_TOKEN` were absent from Actions secrets;
- therefore no live Worker deployment, Cron Trigger or `/health` endpoint could be verified.

Code being present in the repository is not deployment evidence. A successful deploy run now produces the `watchdog-deployment-evidence` artifact containing `deployments.json`, `schedules.json`, `script-subdomain.json`, `health.json`, and `summary.json`.

## Required configuration

Cloudflare:

- a Workers-enabled account with a `workers.dev` subdomain;
- an API token limited to that account with `Workers Scripts: Edit`;
- Cron Trigger capability (included with Workers; plan limits still apply).

GitHub Actions repository secrets:

```text
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
WATCHDOG_GITHUB_TOKEN
```

`WATCHDOG_GITHUB_TOKEN` should be a fine-grained PAT with:

- resource owner: the repository owner;
- repository access: only `eyazan/youtube-otomasyon`;
- repository permission: **Contents: Read and write**.

That is the permission required by GitHub's `Create a repository dispatch event` endpoint. A classic PAT must have `repo`. Actions write permission is not required for the dispatch call. Use an expiry date and rotate the token; never place it in Wrangler vars or source.

Repository variable:

```text
PRODUCTION_DEADLINE_UTC=16:30
```

The deploy workflow independently asserts that Worker cron `35 16 * * *` is exactly five minutes later. Configuration drift fails deployment.

## Exact deployment steps

1. Create the scoped Cloudflare API token and GitHub PAT described above.
2. Add the three secrets without putting values on the command line (each command prompts for its value):

   ```bash
   gh secret set CLOUDFLARE_ACCOUNT_ID -R eyazan/youtube-otomasyon
   gh secret set CLOUDFLARE_API_TOKEN -R eyazan/youtube-otomasyon
   gh secret set WATCHDOG_GITHUB_TOKEN -R eyazan/youtube-otomasyon
   gh secret list -R eyazan/youtube-otomasyon
   ```

3. Deploy from the default branch:

   ```bash
   gh workflow run deploy-watchdog.yml -R eyazan/youtube-otomasyon --ref main
   gh run list -R eyazan/youtube-otomasyon --workflow deploy-watchdog.yml --limit 1
   gh run watch RUN_ID -R eyazan/youtube-otomasyon --exit-status
   ```

4. Download and inspect durable evidence:

   ```bash
   gh run download RUN_ID -R eyazan/youtube-otomasyon -n watchdog-deployment-evidence
   jq . watchdog-deployment-evidence/summary.json
   jq '{tokenConfigured,repository,cron,deadlineUtc,version,commit}' watchdog-deployment-evidence/health.json
   jq . watchdog-deployment-evidence/schedules.json
   ```

The deploy must fail before mutation if any required secret is absent. After deployment it must fail unless Cloudflare reports the cron and the live health endpoint reports the exact deployed commit with `tokenConfigured:true`.

Cloudflare documents that Cron Trigger changes can take up to 15 minutes to propagate globally. The deploy evidence proves the control-plane schedule immediately; allow that propagation window before treating the absence of a first Cron event as an incident.

## Exact verification steps

### 1. Health and deployed commit

Copy `healthUrl` from the deployment summary/artifact:

```bash
curl -fsS 'https://youtube-production-watchdog.CLOUDFLARE_SUBDOMAIN.workers.dev/health' | jq .
```

Expected shape:

```json
{
  "ok": true,
  "scheduler": "cloudflare-cron",
  "eventType": "production-sla-watchdog",
  "tokenConfigured": true,
  "repository": "eyazan/youtube-otomasyon",
  "cron": "35 16 * * *",
  "deadlineUtc": "16:30",
  "version": "github-actions-RUN.ATTEMPT",
  "commit": "FULL_GIT_SHA"
}
```

### 2. Safe repository_dispatch self-test

This uses the same `WATCHDOG_GITHUB_TOKEN`, requires GitHub HTTP `204`, waits for the real `production-watchdog.yml` receiver and proves that its special event never starts production:

```bash
gh workflow run watchdog-self-test.yml -R eyazan/youtube-otomasyon --ref main
gh run list -R eyazan/youtube-otomasyon --workflow watchdog-self-test.yml --limit 1
gh run watch RUN_ID -R eyazan/youtube-otomasyon --exit-status
gh run download RUN_ID -R eyazan/youtube-otomasyon -n watchdog-self-test
jq . watchdog-self-test/watchdog-self-test.json
```

Expected: `ok:true`, `httpStatus:204`, a receiver run ID, and `videoProductionStarted:false`.

### 3. No-upload recovery simulation

```bash
gh workflow run production-watchdog.yml -R eyazan/youtube-otomasyon --ref main -f simulate_missing=true
gh run list -R eyazan/youtube-otomasyon --workflow production-watchdog.yml --limit 1
gh run watch RUN_ID -R eyazan/youtube-otomasyon --exit-status
```

This exercises the SLA/reusable recovery chain with `kuru:true`; it renders/tests but cannot upload, notify or commit.

### 4. Real recovery verification

Sending `production-sla-watchdog` can produce a real video if today's slot is absent. Use only for a deliberate production test:

```bash
gh api --method POST -H 'Accept: application/vnd.github+json' \
  /repos/eyazan/youtube-otomasyon/dispatches \
  -f event_type=production-sla-watchdog \
  -F 'client_payload[source]=manual-production-verification'
gh run list -R eyazan/youtube-otomasyon --workflow production-watchdog.yml --event repository_dispatch --limit 1
gh run watch RUN_ID -R eyazan/youtube-otomasyon --exit-status
```

Download `production-sla-before` and `production-sla-after`. A successful recovery has `youtubeVerified:true`, a valid `videoId`, same-day `publishAt`, `productionReady:true`, and `healthy:true`. If a video already exists, `youtubeTodayExists:true`, `safeToRecover:false`, and recovery is skipped.

## Duplicate-prevention guarantee

The guarantee is layered:

- every producer and watchdog uses the same `concurrency: portfolio-production` with `cancel-in-progress:false`;
- the watchdog can start recovery only after authenticated YouTube API verification returns `safe_to_recover=true`;
- the recovery reusable workflow re-runs the publication calendar check while it owns that concurrency lane;
- a late primary scheduler therefore runs after recovery and sees the filled date;
- if upload succeeded but the state commit failed, `youtube-yukle.js` searches the authenticated channel for the normalized title before creating an upload session and records the existing video instead;
- the YouTube uploader also validates the expected channel identity before all duplicate lookup/write operations.

No distributed system can promise availability, but this design fails closed on ambiguous remote state: it prefers a visible issue and a missed upload over a duplicate upload.

## Rotation and incident checks

Rotate `WATCHDOG_GITHUB_TOKEN` by replacing the GitHub secret, rerunning deploy, and running the self-test. Rotate the Cloudflare token independently. Worker logs emit structured `watchdog_dispatch_started`, `watchdog_dispatch_succeeded`, or `watchdog_dispatch_failed` records. Non-204 failures include HTTP status, status text, GitHub request ID and at most 1,000 response characters; tokens are never logged.

GitHub's `17:07 UTC` scheduled watchdog remains active even if Cloudflare is unavailable. It is a useful backup but not an independent failure domain.
