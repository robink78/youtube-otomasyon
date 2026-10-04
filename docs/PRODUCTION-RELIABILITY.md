# Production reliability

## Daily invariant

The Failure Reconstructed deadline is `PRODUCTION_DEADLINE_UTC` (currently
16:30 UTC). After that deadline, the system must establish one of these states:

```text
TODAY_VIDEO_SCHEDULED = true
OR
AUTOMATIC_RECOVERY_STARTED = true
```

`production-sla-check.js` emits JSON and exits 0 only when today's Short was
produced, uploaded, assigned `publishAt`, found through the YouTube API, passed
the final quality gate and has its normal notification record. An unhealthy
report exits 2, so workflows can act on it without parsing prose.

## Independent clocks and recovery

1. Primary: `uretim.yml` runs at 14:53 UTC. Portfolio cron slots provide
   additional GitHub-native retries.
2. Independent watchdog: the Cloudflare Worker in
   `ops/production-watchdog-worker/` fires at 16:35 UTC and sends a
   `repository_dispatch` event. It does not depend on GitHub's scheduler or a
   personal computer.
3. Recovery: `production-watchdog.yml` runs the SLA check and calls the real
   reusable production workflow with `force: true` when today's scheduled video
   is missing.
4. Verification: after recovery it checks the SLA again. Only a second failure
   opens a human-facing GitHub issue.
5. Secondary check: GitHub runs the same watchdog at 17:07 UTC. This is useful
   redundancy but is deliberately not counted as independent.

The Worker is not active until the three secrets listed in its README are added
and the deployment workflow succeeds. Until then the correct status is
`AUTONOMOUS_BUT_GITHUB_SCHEDULER_RISK_REMAINS` or `NOT_RELIABLE_YET`, never
`FULLY_AUTONOMOUS`.

## Failure simulation

Run `Production SLA watchdog and automatic recovery` manually with
`simulate_missing=true`. The first SLA is forced to missing, and the exact
recovery job starts a full no-upload production render. The resulting
`production-sla-before` and `production-sla-after` artifacts prove the decision
and recovery job outcome without creating a duplicate YouTube or TikTok item.
