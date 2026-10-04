# Operations runbook

## Daily source of truth

Run `node daily-operations-report.js`. It writes:

- `reports/daily-operations.json` for machines;
- `reports/daily-operations.md` for the owner.

For each channel it shows today's topic, Short/long status, quality, YouTube schedule/video ID, analytics availability, scheduler health, ready backlog, and errors. Failure Reconstructed also shows TikTok today/backlog status. Missing analytics remain `unavailable`/`null`.

## Normal unattended day

Failure Reconstructed requires no manual GitHub trigger. A GitHub schedule produces a Short; the video is uploaded private with `publishAt`; the exact successful MP4 goes to TikTok inbox; one oldest TikTok backlog item follows while backlog exists; analytics/checkpoints and state are committed. The SLA watchdog retries production if needed. TikTok still requires opening the authorized account's inbox item and manually posting it.

ImpossibleBrief follows the same scheduled Short path only after `IB_PUBLISH=1` and its isolated OAuth values are configured. Until then, workflow steps remain skipped by design.

CriticalThread and The Hidden Logic of Things follow the same rule through `CT_PUBLISH=1` and `BTO_PUBLISH=1`. BTO's question-only backlog must be researched before production discovery; see [BEHIND-THE-ORDINARY.md](BEHIND-THE-ORDINARY.md).

## Triage order

1. Read `reports/daily-operations.md`.
2. If YouTube is missing after 16:30 UTC, inspect the watchdog recovery run, not every cron run.
3. Run `node production-sla-check.js --channel <slug> --verify-youtube` with authorized credentials.
4. For TikTok, dispatch `Failure Reconstructed production` with operation `tiktok-diagnose`. Do not resend a slug with a durable `publishId`.
5. For OAuth `invalid_grant`, disable only the affected channel publish variable, re-authorize that channel, replace its prefixed secret, health-check, then re-enable.
6. For `CHANNEL_ID_MISMATCH` or `TT_ACCOUNT_MISMATCH`, stop. Correct the expected ID/token; never override the guard.

## Quality outcomes

- `PUBLISH`: eligible for upload and schedule.
- `REVIEW`: never uploaded; stored by spec hash in `review.json`/`inceleme.json`; the queue tries another topic. Edit the spec to make it eligible for a new evaluation.
- `BLOCK`: never uploaded; stored by spec hash in `blocked.json`/`engellenen.json`.

## Current manual duties

- Deploy the independent Cloudflare watchdog once.
- Complete ImpossibleBrief Google OAuth once.
- Review/post TikTok inbox drafts.
- Expand source-checked inventories; current targets are not met.
- Long-form: the weekly lane runs unattended (`node growth.js longform`, see [GROWTH-ENGINE.md](GROWTH-ENGINE.md)). Configure an explicit provider (`LONGFORM_LLM_PROVIDER=groq`, `GROQ_API_KEY`, default `GROQ_MODEL=openai/gpt-oss-120b`); render/upload stays off until `longform.render.enabled` + `<PREFIX>_LONGFORM_PUBLISH=1`. A 429 safely defers from its checkpoint. After each published episode, complete the `RELATED_VIDEO_MANUAL_ACTION_REQUIRED` tasks and the end-screen plan in Studio.

## Weekly growth review

1. `npm run growth:report` → `reports/growth-dashboard.md`: per-channel Shorts/long-form health, inventory buckets, backlog, funnel, learning, enrichment tasks. Baselines are never blended across channels.
2. A long-form `QUALITY_BLOCKED` cycle is normal quality behaviour, not an incident. Read its hard fails in `channels/<slug>/state/longform/lane.json`.
3. `NO_QUALIFIED_TOPIC` Short alerts mean the channel's inventory needs researched topics — do not enable `fallbackToC` to fill the calendar.
