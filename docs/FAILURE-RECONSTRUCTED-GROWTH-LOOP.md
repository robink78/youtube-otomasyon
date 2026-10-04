# Failure Reconstructed measurable growth loop

## Operating loop

The live path is now:

`500-topic durable inventory → 20–50 production candidates → factual/source filter → ViralPotentialScore + VideoPotentialScore → 75/25 exploit/explore → 10+ hook competition → 20+ title competition → selected opening production overlay → retention/factual/visual/readiness gates → render → final gate → upload → 1h/6h/12h/24h/48h/7d checkpoints → age normalization → performance/plato/breakout classification → isolated learning → next decision`.

The 377 existing JSON case files remain the production inventory. The durable
universe adds 123 real Wikipedia-API-verified events as research backlog. This
separation prevents a page-existence check from being mistaken for production
research.

## Decision records

- `channels/failure-reconstructed/state/growth/latest-decision.json`: latest complete 20–50 candidate pool, score components, risks, chosen mode and reason.
- `channels/failure-reconstructed/state/growth/decisions.json`: bounded decision history.
- `icerik/paket/<slug>/growth-plan.json`: hook/title/script/readiness plan consumed by the existing renderer and uploader.
- `channels/failure-reconstructed/state/growth/performance.json`: raw checkpoints plus normalized metrics, percentiles and classification.
- `channels/failure-reconstructed/state/growth/clusters.json`: median views, 24h/48h views, retention, engagement, subscriber conversion and breakout frequency by cluster.
- `channels/failure-reconstructed/memory/growth-learning.json`: channel-only observations, hypotheses, adopted and suppressed patterns.

## Initial real-data result (2026-09-30)

`npm run growth:backfill` imported 19 real snapshot files for 9 historical
videos with zero skips and enriched the current registry to 10 tracked Shorts.
The latest channel snapshot contains 6,910 total views and 19 subscribers. Five
videos satisfy the configured `EARLY_DISTRIBUTION_PLATEAU` rule: 1,000–2,000
latest views, at least 12 hours old, and post-early-window velocity/growth below
the configured limits. No video satisfies breakout evidence yet. These are
correlations, not claims about YouTube's internal recommendation causes.

Historical files contain net subscriber changes. Gross `subscribersGained` and
`subscribersLost` are unavailable for those snapshots, so the report shows net
conversion and deliberately leaves gross conversion blank. Future authorized
Analytics API collection requests both gross fields and `engagedViews`.

## Safe migration

```bash
npm install
npm run library:failure-reconstructed:inventory
npm run growth:backfill
npm run growth:report:failure-reconstructed
npm run test:growth
npm test
```

The inventory rebuild uses the English Wikipedia public API and writes only
when all 500 records have an explicit source URL and unique id. Backfill is
idempotent. No database migration exists: versioned JSON remains the repository
state model.

## Configuration and environment

All important weights/thresholds are in `config/growth-engine.json`; channel
overrides remain in `channels/failure-reconstructed/growth-engine.json`.
Relevant runtime variables:

- `FR_YT_CLIENT_ID`, `FR_YT_CLIENT_SECRET`, `FR_YT_REFRESH_TOKEN`, `FR_YT_CHANNEL_ID` (legacy `YT_*` fallback remains enabled only for FR).
- `GROWTH_GATE_MODE=enforce|shadow`; default is `enforce`.
- `PUBLISH=1` enables the existing Short upload path.
- `LONGFORM_LLM=1`, `ANTHROPIC_API_KEY`, optional `ANTHROPIC_MODEL` enable evidence expansion for the weekly script.
- `FR_LONGFORM_PUBLISH=1` plus `longform.render.enabled=true` are both required for long-form render/upload.

No new secret is required for offline backfill/reporting. The analytics token
must include `yt-analytics.readonly` for future account-dependent measurements.

## Honest API and statistical limits

- The public APIs do not expose per-video Studio impressions CTR, returning viewers, Viewed vs Swiped Away or Stayed to Watch in the implemented reports. Manual values remain explicitly labelled.
- The Data API has no supported write field for a Short's Related Video or end-screen elements; tasks remain manual.
- Analytics can lag and YouTube can revise counts downward, so negative interval velocity is retained as measured rather than clamped or invented.
- Ten videos support observations, not causal inference. Adaptive weights require the configured sample and confidence floors.
- The weekly lane exists and is workflow-wired, but a package can correctly stop at `QUALITY_BLOCKED` or `READY_FOR_RENDER`; cadence never overrides evidence depth or the explicit publish switches.
