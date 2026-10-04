# Multi-channel operations

The source of truth is `config/channels.json`; path and credential resolution is in `core/channel-context.js`.

| Channel | Credentials | YouTube state | Analytics/learning | TikTok |
|---|---|---|---|---|
| Failure Reconstructed | `FR_YT_*` (legacy `YT_*` fallback during migration) | legacy adapter: `icerik/` | `analytics/`, channel memory | enabled, inbox only, registry `icerik/tiktok.json` |
| ImpossibleBrief | `IB_YT_*`, no fallback | `channels/impossible-brief/state/` | `channels/impossible-brief/analytics/` and `memory/` | disabled |

Before any YouTube mutation, the access token is used to fetch the authenticated channel and compare it with `<PREFIX>_YT_CHANNEL_ID`. Missing or mismatched identity blocks before an upload session or state mutation.

Shared code is intentional; credentials, upload/publication state, production output, analytics, learning, notification, retry/scheduler state, experiments, and topic usage are channel-scoped. The current single render/upload lane is serialized because GitHub-hosted production shares finite CPU and state commit operations.

Commands:

```bash
node shorts-sira.js --channel failure-reconstructed
node shorts-sira.js --channel impossible-brief
node production-sla-check.js --channel failure-reconstructed --verify-youtube
node production-sla-check.js --channel impossible-brief --verify-youtube
node daily-operations-report.js
```

Current enablement: Failure Reconstructed Shorts publish automatically when the workflow runs. ImpossibleBrief code and dry-run rendering work, but publication is disabled until its OAuth setup. Neither channel currently has a production-wired long-form workflow.

Detailed invariants and layout remain in [MULTI-CHANNEL-ARCHITECTURE.md](MULTI-CHANNEL-ARCHITECTURE.md).
