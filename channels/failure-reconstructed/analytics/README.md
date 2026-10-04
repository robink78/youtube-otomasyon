# Analytics adapter

Failure Reconstructed keeps its existing root `analytics/` directory during the compatibility phase. `core/channel-context.js` maps this channel to that exclusive legacy path; other channels cannot resolve it.

Migration and reporting:

```bash
npm run growth:backfill
npm run growth:report:failure-reconstructed
```

Backfill is idempotent and imports only real files under `analytics/<video-id>/`.
`1d.json`, `3d.json` and `7d.json` map to `24h`, `72h` and `7d`; absent
historical checkpoints remain absent. Legacy subscriber values marked “net” are
stored as net change and are never presented as gross subscribers gained.
Generated normalized state stays channel-scoped under
`channels/failure-reconstructed/state/growth/`; the human/JSON report is in
`reports/failure_reconstructed/`.
