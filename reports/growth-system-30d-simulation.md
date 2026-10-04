# Growth system — 30-day multi-channel simulation

Generated 2026-09-30T07:15:02.344Z by `node growth.js simulate`. Start 2026-10-01, 30 days, channels: failure-reconstructed, impossible-brief, critical-thread.

**What is real and what is simulated.** Topic selection, Short planning, hooks, first-3-seconds, readiness gates, the weekly long-form lane and its quality gate, the Short→Long / Long→Long funnel, analytics checkpoints, diagnosis, learning and experiments all run the production code. Uploads (SIM-* ids), render, and every metric are simulated; metrics are deterministic pseudo-random numbers used only to exercise the analytics and learning code — they are not forecasts. All state lives in a temporary GROWTH_STATE_ROOT sandbox; production state was not touched.

A blocked weak long-form candidate is expected quality behaviour and is not counted as a production failure.

## Scenario A — current configuration (no LLM writer: ANTHROPIC_API_KEY not configured)

| Channel | Shorts published | Short quality blocks | Skipped days (no qualified topic) | Long-form cycles | Episodes | Cycle outcomes | Short→Long links | Long→Long links |
|---|---|---|---|---|---|---|---|---|
| failure-reconstructed | 30 | 0 | 0 | 5 | 0 | QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED | 0 | 0 |
| impossible-brief | 6 | 0 | 24 | 5 | 0 | QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED | 0 | 0 |
| critical-thread | 1 | 0 | 29 | 5 | 0 | QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED | 0 | 0 |

### Verification

| Check | Result | Detail |
|---|---|---|
| no credential collisions | PASS | failure-reconstructed: FR_YT_CLIENT_ID, YT_CLIENT_ID, FR_YT_CLIENT_SECRET… / impossible-brief: IB_CLIENT_ID, IB_YT_CLIENT_ID, IB_CLIENT_SECRET… / critical-thread: CT_CLIENT_ID, CT_YT_CLIENT_ID, CT_CLIENT_SECRET… |
| no state collisions (no file in one channel's sandbox carries another channel's records) | PASS | 0 foreign records |
| no learning collisions (each memory file belongs to its channel) | PASS | failure-reconstructed: Shorts n=30 (adaptive), long n=0 / impossible-brief: Shorts n=6 (observing), long n=0 / critical-thread: Shorts n=1 (heuristics-only), long n=0 |
| no analytics collisions | PASS | failure-reconstructed: 30 tracked / impossible-brief: 6 tracked / critical-thread: 1 tracked |
| no duplicate uploads (video ids and per-channel topics unique) | PASS | 37 simulated uploads |
| topic inventory health | PASS | failure-reconstructed: A/B 302 → 277, C 60, D 0 / impossible-brief: A/B 3 → 0, C 493, D 0 / critical-thread: A/B 0 → 0, C 0, D 521 |
| quality blocks recorded, not counted as failures | PASS | failure-reconstructed: 0 Short blocks, 0 skipped days, 5 long-form quality blocks / impossible-brief: 0 Short blocks, 24 skipped days, 5 long-form quality blocks / critical-thread: 0 Short blocks, 29 skipped days, 5 long-form quality blocks |
| long/short cadence | PASS | failure-reconstructed: 30 Shorts, 5 long-form cycles, 0 episodes / impossible-brief: 6 Shorts, 5 long-form cycles, 0 episodes / critical-thread: 1 Shorts, 5 long-form cycles, 0 episodes |
| experiments (one variable, per channel) | PASS | failure-reconstructed: hook_style 20/10 → INCONCLUSIVE / impossible-brief: hook_style 6/0 → INSUFFICIENT_DATA / critical-thread: hook_style 1/0 → INSUFFICIENT_DATA |
| scheduler recovery (RUNNING cycle after a crash is re-run) | PASS | impossible-brief 2026-W42: crash on 2026-10-12, re-run 2026-10-13 → QUALITY_BLOCKED |
| TikTok backlog behaviour (Failure Reconstructed only; simulation sends nothing) | PASS | TikTok enabled for: failure-reconstructed; backlog/duplicate rules covered by tests/js/reliability.test.js |
| channel-specific learning evolution | PASS | failure-reconstructed: 18 observations, 1 hypotheses, 0 adopted / impossible-brief: 12 observations, 0 hypotheses, 0 adopted / critical-thread: 0 observations, 0 hypotheses, 0 adopted |
| Shorts continue during long-form production | PASS | 15 long-form cycle days; every Short slot published or skipped only for inventory |
| long-form state isolation | PASS | each lane.json carries only its own channel |
| no schedule collisions (long-form 15:00 UTC vs Shorts slot) | PASS | per-channel long-form and Short publish times never coincide |
| no content collisions (no episode twice; Short topics unique) | PASS | episodes unique per channel |
| Short → Long relationships | PASS | failure-reconstructed: 0 links, 0 RELATED_VIDEO manual actions / impossible-brief: 0 links, 0 RELATED_VIDEO manual actions / critical-thread: 0 links, 0 RELATED_VIDEO manual actions |
| Long → Long relationships | PASS | failure-reconstructed: 0 next-episode links / impossible-brief: 0 next-episode links / critical-thread: 0 next-episode links |
| content clusters | PASS | failure-reconstructed: 11 clusters / impossible-brief: 3 clusters / critical-thread: 1 clusters |
| long-form quality blocks are expected behaviour | PASS | QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED / QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED / QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED |
| analytics separation (Shorts vs long baselines) | PASS | failure-reconstructed: short n=30, long n=0 / impossible-brief: short n=6, long n=0 / critical-thread: short n=1, long n=0 |
| learning separation (Shorts vs long-form blocks) | PASS | failure-reconstructed: long-form learning n=0 (heuristics-only) / impossible-brief: long-form learning n=0 (heuristics-only) / critical-thread: long-form learning n=0 (heuristics-only) |
| long-form does not starve Shorts (no Short slot lost to the long-form lane) | PASS | failure-reconstructed: 30/30 published, 0 skipped for inventory / impossible-brief: 6/30 published, 24 skipped for inventory / critical-thread: 1/30 published, 29 skipped for inventory |
| WARNING — Shorts inventory exhaustion (not a lane failure) | PASS | impossible-brief: 24/30 days without a qualified topic → ResearchPackage enrichment required / critical-thread: 29/30 days without a qualified topic → ResearchPackage enrichment required |
| blocked weak long-form candidates do not break scheduler health | PASS | lane status readable and next cycle schedulable for every channel |

### Long-form cycles

- 2026-10-01 failure-reconstructed 2026-W40: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: challenger-1986 BLOCK 83; columbia-2003 BLOCK 85; apollo-13-1970 BLOCK 84
- 2026-10-05 failure-reconstructed 2026-W41: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: challenger-1986 BLOCK 83; columbia-2003 BLOCK 85; apollo-13-1970 BLOCK 84
- 2026-10-12 failure-reconstructed 2026-W42: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: challenger-1986 BLOCK 83; columbia-2003 BLOCK 85; apollo-13-1970 BLOCK 84
- 2026-10-19 failure-reconstructed 2026-W43: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: challenger-1986 BLOCK 83; chernobyl-1986 BLOCK 89; columbia-2003 BLOCK 85
- 2026-10-26 failure-reconstructed 2026-W44: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: challenger-1986 BLOCK 83; chernobyl-1986 BLOCK 89; columbia-2003 BLOCK 85
- 2026-10-01 impossible-brief 2026-W40: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: would-doubling-all-ocean-plankton-help-or-harm-us BLOCK 84; what-if-all-synthetic-fertilizers-reversed-between-hemispheres BLOCK 84; what-if-the-moon-disappeared-tonight BLOCK 84
- 2026-10-05 impossible-brief 2026-W41: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: would-doubling-all-ocean-plankton-help-or-harm-us BLOCK 84; what-if-all-synthetic-fertilizers-reversed-between-hemispheres BLOCK 84; what-if-the-moon-disappeared-tonight BLOCK 84
- 2026-10-13 impossible-brief 2026-W42: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: would-doubling-all-ocean-plankton-help-or-harm-us BLOCK 84; what-if-all-synthetic-fertilizers-reversed-between-hemispheres BLOCK 84; what-if-the-moon-disappeared-tonight BLOCK 84
- 2026-10-19 impossible-brief 2026-W43: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: what-if-the-moon-disappeared-tonight BLOCK 84; if-a-long-period-comet-vanished-right-now-what-would-change-first BLOCK 84; what-breaks-first-if-mercury-suddenly-doubles-in-mass BLOCK 81
- 2026-10-26 impossible-brief 2026-W44: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: what-if-the-moon-disappeared-tonight BLOCK 84; what-breaks-first-if-a-kilometer-wide-asteroid-suddenly-doubles-in-mass BLOCK 83; if-a-long-period-comet-vanished-right-now-what-would-change-first BLOCK 84
- 2026-10-01 critical-thread 2026-W40: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: the-machine-the-entire-chip-industry-depends-on BLOCK 82
- 2026-10-05 critical-thread 2026-W41: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: the-machine-the-entire-chip-industry-depends-on BLOCK 82
- 2026-10-12 critical-thread 2026-W42: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: the-machine-the-entire-chip-industry-depends-on BLOCK 82
- 2026-10-19 critical-thread 2026-W43: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: the-machine-the-entire-chip-industry-depends-on BLOCK 82
- 2026-10-26 critical-thread 2026-W44: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: the-machine-the-entire-chip-industry-depends-on BLOCK 82

### Learning after 30 days (channel-isolated)

- failure-reconstructed: Shorts n=30 (adaptive, 18 observations; hypotheses: experimentVariant=failure-reconstructed-short-hook_style-2026-10-01:variant lift -0.103); long-form n=0 (heuristics-only). Experiment hook_style: 20/10 → INCONCLUSIVE
- impossible-brief: Shorts n=6 (observing, 12 observations); long-form n=0 (heuristics-only). Experiment hook_style: 6/0 → INSUFFICIENT_DATA
- critical-thread: Shorts n=1 (heuristics-only, 0 observations); long-form n=0 (heuristics-only). Experiment hook_style: 1/0 → INSUFFICIENT_DATA

### Episodes (scenario B only publishes simulated episodes)


### Inventory

- failure-reconstructed: before A63/B239/C65/D0 → after A38/B239/C60/D0
- impossible-brief: before A0/B3/C496/D0 → after A0/B0/C493/D0
- critical-thread: before A0/B0/C1/D521 → after A0/B0/C0/D521

## Scenario B — LLM long-form writer enabled (simulated writer paraphrasing the deep ResearchPackage)

| Channel | Shorts published | Short quality blocks | Skipped days (no qualified topic) | Long-form cycles | Episodes | Cycle outcomes | Short→Long links | Long→Long links |
|---|---|---|---|---|---|---|---|---|
| failure-reconstructed | 30 | 0 | 0 | 5 | 5 | READY_FOR_RENDER, READY_FOR_RENDER, READY_FOR_RENDER, READY_FOR_RENDER, READY_FOR_RENDER | 10 | 4 |
| impossible-brief | 6 | 0 | 24 | 5 | 1 | READY_FOR_RENDER, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED, QUALITY_BLOCKED | 0 | 0 |
| critical-thread | 0 | 1 | 29 | 5 | 1 | READY_FOR_RENDER, NO_CANDIDATE, NO_CANDIDATE, NO_CANDIDATE, NO_CANDIDATE | 0 | 0 |

### Verification

| Check | Result | Detail |
|---|---|---|
| no credential collisions | PASS | failure-reconstructed: FR_YT_CLIENT_ID, YT_CLIENT_ID, FR_YT_CLIENT_SECRET… / impossible-brief: IB_CLIENT_ID, IB_YT_CLIENT_ID, IB_CLIENT_SECRET… / critical-thread: CT_CLIENT_ID, CT_YT_CLIENT_ID, CT_CLIENT_SECRET… |
| no state collisions (no file in one channel's sandbox carries another channel's records) | PASS | 0 foreign records |
| no learning collisions (each memory file belongs to its channel) | PASS | failure-reconstructed: Shorts n=30 (adaptive), long n=5 / impossible-brief: Shorts n=6 (observing), long n=1 / critical-thread: Shorts n=0 (heuristics-only), long n=1 |
| no analytics collisions | PASS | failure-reconstructed: 35 tracked / impossible-brief: 7 tracked / critical-thread: 1 tracked |
| no duplicate uploads (video ids and per-channel topics unique) | PASS | 43 simulated uploads |
| topic inventory health | PASS | failure-reconstructed: A/B 302 → 277, C 60, D 0 / impossible-brief: A/B 3 → 0, C 493, D 0 / critical-thread: A/B 0 → 0, C 0, D 521 |
| quality blocks recorded, not counted as failures | PASS | failure-reconstructed: 0 Short blocks, 0 skipped days, 0 long-form quality blocks / impossible-brief: 0 Short blocks, 24 skipped days, 4 long-form quality blocks / critical-thread: 1 Short blocks, 29 skipped days, 4 long-form quality blocks |
| long/short cadence | PASS | failure-reconstructed: 30 Shorts, 5 long-form cycles, 5 episodes / impossible-brief: 6 Shorts, 5 long-form cycles, 1 episodes / critical-thread: 0 Shorts, 5 long-form cycles, 1 episodes |
| experiments (one variable, per channel) | PASS | failure-reconstructed: hook_style 20/10 → INCONCLUSIVE / impossible-brief: hook_style 6/0 → INSUFFICIENT_DATA / critical-thread: hook_style 1/0 → INSUFFICIENT_DATA |
| scheduler recovery (RUNNING cycle after a crash is re-run) | PASS | impossible-brief 2026-W42: crash on 2026-10-12, re-run 2026-10-13 → QUALITY_BLOCKED |
| TikTok backlog behaviour (Failure Reconstructed only; simulation sends nothing) | PASS | TikTok enabled for: failure-reconstructed; backlog/duplicate rules covered by tests/js/reliability.test.js |
| channel-specific learning evolution | PASS | failure-reconstructed: 18 observations, 1 hypotheses, 0 adopted / impossible-brief: 12 observations, 0 hypotheses, 0 adopted / critical-thread: 0 observations, 0 hypotheses, 0 adopted |
| Shorts continue during long-form production | PASS | 15 long-form cycle days; every Short slot published or skipped only for inventory |
| long-form state isolation | PASS | each lane.json carries only its own channel |
| no schedule collisions (long-form 15:00 UTC vs Shorts slot) | PASS | per-channel long-form and Short publish times never coincide |
| no content collisions (no episode twice; Short topics unique) | PASS | episodes unique per channel |
| Short → Long relationships | PASS | failure-reconstructed: 10 links, 10 RELATED_VIDEO manual actions / impossible-brief: 0 links, 0 RELATED_VIDEO manual actions / critical-thread: 0 links, 0 RELATED_VIDEO manual actions |
| Long → Long relationships | PASS | failure-reconstructed: 4 next-episode links / impossible-brief: 0 next-episode links / critical-thread: 0 next-episode links |
| content clusters | PASS | failure-reconstructed: 11 clusters / impossible-brief: 4 clusters / critical-thread: 1 clusters |
| long-form quality blocks are expected behaviour | PASS | READY_FOR_RENDER,READY_FOR_RENDER,READY_FOR_RENDER,READY_FOR_RENDER,READY_FOR_RENDER / READY_FOR_RENDER,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED,QUALITY_BLOCKED / READY_FOR_RENDER,NO_CANDIDATE,NO_CANDIDATE,NO_CANDIDATE,NO_CANDIDATE |
| analytics separation (Shorts vs long baselines) | PASS | failure-reconstructed: short n=30, long n=5 / impossible-brief: short n=6, long n=1 / critical-thread: short n=0, long n=1 |
| learning separation (Shorts vs long-form blocks) | PASS | failure-reconstructed: long-form learning n=5 (observing) / impossible-brief: long-form learning n=1 (heuristics-only) / critical-thread: long-form learning n=1 (heuristics-only) |
| long-form does not starve Shorts (no Short slot lost to the long-form lane) | PASS | failure-reconstructed: 30/30 published, 0 skipped for inventory / impossible-brief: 6/30 published, 24 skipped for inventory / critical-thread: 0/30 published, 29 skipped for inventory |
| WARNING — Shorts inventory exhaustion (not a lane failure) | PASS | impossible-brief: 24/30 days without a qualified topic → ResearchPackage enrichment required / critical-thread: 29/30 days without a qualified topic → ResearchPackage enrichment required |
| blocked weak long-form candidates do not break scheduler health | PASS | lane status readable and next cycle schedulable for every channel |

### Long-form cycles

- 2026-10-01 failure-reconstructed 2026-W40: **READY_FOR_RENDER** (challenger-1986) — dry run; evaluated: challenger-1986 PUBLISH 87
- 2026-10-08 failure-reconstructed 2026-W41: **READY_FOR_RENDER** (columbia-2003) — dry run; evaluated: columbia-2003 PUBLISH 88
- 2026-10-15 failure-reconstructed 2026-W42: **READY_FOR_RENDER** (apollo-13-1970) — dry run; evaluated: apollo-13-1970 PUBLISH 88
- 2026-10-22 failure-reconstructed 2026-W43: **READY_FOR_RENDER** (chernobyl-1986) — dry run; evaluated: chernobyl-1986 PUBLISH 92
- 2026-10-29 failure-reconstructed 2026-W44: **READY_FOR_RENDER** (air-france-447-2009) — dry run; evaluated: air-france-447-2009 PUBLISH 88
- 2026-10-01 impossible-brief 2026-W40: **READY_FOR_RENDER** (what-if-all-synthetic-fertilizers-reversed-between-hemispheres) — dry run; evaluated: would-doubling-all-ocean-plankton-help-or-harm-us BLOCK 87; what-if-all-synthetic-fertilizers-reversed-between-hemispheres PUBLISH 89
- 2026-10-08 impossible-brief 2026-W41: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: what-would-a-one-meter-zone-with-zero-the-weak-nuclear-force-do BLOCK 83; would-doubling-all-ocean-plankton-help-or-harm-us BLOCK 87; what-if-the-moon-disappeared-tonight BLOCK 87
- 2026-10-13 impossible-brief 2026-W42: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: would-doubling-all-ocean-plankton-help-or-harm-us BLOCK 87; what-if-the-moon-disappeared-tonight BLOCK 87; if-a-long-period-comet-vanished-right-now-what-would-change-first BLOCK 87
- 2026-10-19 impossible-brief 2026-W43: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: what-if-the-moon-disappeared-tonight BLOCK 87; if-a-long-period-comet-vanished-right-now-what-would-change-first BLOCK 87; what-breaks-first-if-mercury-suddenly-doubles-in-mass BLOCK 82
- 2026-10-26 impossible-brief 2026-W44: **QUALITY_BLOCKED** — no candidate passed the long-form quality gate; cadence does not override quality; evaluated: what-if-the-moon-disappeared-tonight BLOCK 87; what-breaks-first-if-a-kilometer-wide-asteroid-suddenly-doubles-in-mass BLOCK 86; if-a-long-period-comet-vanished-right-now-what-would-change-first BLOCK 87
- 2026-10-01 critical-thread 2026-W40: **READY_FOR_RENDER** (the-machine-the-entire-chip-industry-depends-on) — dry run; evaluated: the-machine-the-entire-chip-industry-depends-on PUBLISH 85
- 2026-10-08 critical-thread 2026-W41: **NO_CANDIDATE** — no long-form candidate above bucket D — needs ResearchPackage enrichment; evaluated: —
- 2026-10-12 critical-thread 2026-W42: **NO_CANDIDATE** — no long-form candidate above bucket D — needs ResearchPackage enrichment; evaluated: —
- 2026-10-19 critical-thread 2026-W43: **NO_CANDIDATE** — no long-form candidate above bucket D — needs ResearchPackage enrichment; evaluated: —
- 2026-10-26 critical-thread 2026-W44: **NO_CANDIDATE** — no long-form candidate above bucket D — needs ResearchPackage enrichment; evaluated: —

### Learning after 30 days (channel-isolated)

- failure-reconstructed: Shorts n=30 (adaptive, 18 observations; hypotheses: experimentVariant=failure-reconstructed-short-hook_style-2026-10-01:variant lift -0.103); long-form n=5 (observing). Experiment hook_style: 20/10 → INCONCLUSIVE
- impossible-brief: Shorts n=6 (observing, 12 observations); long-form n=1 (heuristics-only). Experiment hook_style: 6/0 → INSUFFICIENT_DATA
- critical-thread: Shorts n=0 (heuristics-only, 0 observations); long-form n=1 (heuristics-only). Experiment hook_style: 1/0 → INSUFFICIENT_DATA

### Episodes (scenario B only publishes simulated episodes)

- 2026-10-01 failure-reconstructed: challenger-1986 (SIM-FA-L1) · 5 derived Short plans · 2 related published Shorts · next: taurus-xl-fairing-oco-2009
- 2026-10-08 failure-reconstructed: columbia-2003 (SIM-FA-L2) · 6 derived Short plans · 2 related published Shorts · next: challenger-1986
- 2026-10-15 failure-reconstructed: apollo-13-1970 (SIM-FA-L3) · 6 derived Short plans · 2 related published Shorts · next: apollo-1-1967
- 2026-10-22 failure-reconstructed: chernobyl-1986 (SIM-FA-L4) · 6 derived Short plans · 1 related published Shorts · next: sl-1-reactor-1961
- 2026-10-29 failure-reconstructed: air-france-447-2009 (SIM-FA-L5) · 5 derived Short plans · 1 related published Shorts · next: colgan-3407-2009
- 2026-10-01 impossible-brief: what-if-all-synthetic-fertilizers-reversed-between-hemispheres (SIM-IM-L1) · 4 derived Short plans · 0 related published Shorts · next: what-happens-if-all-synthetic-fertilizers-stops-for-one-day
- 2026-10-01 critical-thread: the-machine-the-entire-chip-industry-depends-on (SIM-CR-L1) · 3 derived Short plans · 0 related published Shorts · next: when-euv-pellicle-becomes-the-bottleneck

### Inventory

- failure-reconstructed: before A63/B239/C65/D0 → after A38/B239/C60/D0
- impossible-brief: before A0/B3/C496/D0 → after A0/B0/C493/D0
- critical-thread: before A0/B0/C1/D521 → after A0/B0/C0/D521

