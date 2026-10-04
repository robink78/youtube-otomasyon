# Growth engine — four channels, Shorts + weekly long-form

The growth engine is a **shared algorithm with channel-isolated memory**. It
decides *what* each channel produces and *whether it is good enough*, then
hands rendering and upload to the existing pipelines. It never duplicates the
application, never blends channels, and never lets cadence override quality.

```
                SHARED CORE (core/growth/*)
                    │
      ┌─────────────┼─────────────┬──────────────────┐
      │             │             │                  │
 Failure Recon.  ImpossibleBrief  CriticalThread  Behind Ordinary
      │             │             │                  │
   SHORT/LONG     SHORT/LONG    SHORT/LONG         SHORT/LONG
      │             │             │                  │
  OWN ANALYTICS  OWN ANALYTICS  OWN ANALYTICS     OWN ANALYTICS
  OWN LEARNING   OWN LEARNING   OWN LEARNING      OWN LEARNING
```

Shared infrastructure: yes · shared performance memory: **no** · same-channel funnel: yes · cross-channel funnel: **no**.

## 1. Module map

| Module | Role |
|---|---|
| `config.js` | `config/growth-engine.json` defaults deep-merged with `channels/<slug>/growth-engine.json` |
| `store.js` | the only path builder: `channels/<slug>/state/{growth,longform}`, `…/memory`; `GROWTH_STATE_ROOT` sandboxes tests, dry runs and the simulation; `assertSameChannel` blocks foreign records |
| `topic-model.js` | normalises the four production inventories; exposes durable question/backlog inventories separately from production-ready records; boilerplate/template detection |
| `sources.js` | source tiers (government, investigation, academic, standards, manufacturer, encyclopedia…), numeric support, superlative checks |
| `topic-scoring.js`, `context.js` | transparent ViralPotentialScore (17 positive factors + 4 risk penalties), VideoPotentialScore and combined SelectionScore → A/B/C/D; own-channel history and duplicate detection |
| `performance.js` | age-normalized velocity/rates, channel percentiles, subscriber-weighted growth score, BREAKOUT/STRONG/NORMAL/WEAK/FAILED_TEST, explicit 1K–2K plateau and cluster statistics |
| `hooks.js` | ≥10 hooks from distinct families, 14 scored dimensions; generic, CTA and date/setup openings are **blockers** |
| `first-seconds.js` | First3SecondPlan: narration, first frame (real evidence, never a reel leader), on-screen text, motion, cut timing, sound cue |
| `script.js` | 13-component retention lint; the FR source case file stays immutable while the selected factual hook may replace line one in the production overlay |
| `titles.js`, `engagement.js` | title candidates and scoring; CTA and loop planning |
| `integrity.js`, `pacing.js` | visual source classes, disclosure labels, factual checks; pacing segments, caption chunking/SRT/ASS audit |
| `readiness.js` | ProductionReadinessScore (Shorts) and LongFormProductionReadinessScore; PUBLISH ≥ 85, REVIEW 70–84, BLOCK < 70; **hard fails override the score** |
| `index.js` | `selectShortTopic`, `orderedQueue`, `planShort` (pre-render and final-render gate) |
| `research.js` | long-form research deepening (encyclopedia sentences → sourced, rewrite-only claims; article images as visual leads; COPY_RISK detector) |
| `longform.js` | ResearchPackage → outline → cold opens → script → claim/source map → scene + asset plan → thumbnails → titles → derived Shorts → related-video mapping → end screen → cost → gate |
| `lane.js` | weekly long-form lane: one cycle per ISO week, idempotent, crash-recoverable, quality-blocked cycles are normal |
| `funnel.js` | Short→Long and Long→Long relationships, clusters, end-screen plans, `RELATED_VIDEO_MANUAL_ACTION_REQUIRED` tasks |
| `analytics.js`, `diagnosis.js`, `learning.js`, `experiments.js` | checkpoints (1 h…30 d), legacy backfill, per-content-type baselines, diagnosis, channel-isolated positive/negative learning, one-variable experiments |
| `runtime.js` | pipeline glue: `afterUpload`, run summaries, `analyticsPass` |
| `report.js` | portfolio dashboard plus evidence-led per-channel growth report (never blends baselines) |
| `dry-run.js`, `simulate.js` | PHASE 36 dry runs and PHASE 38 30-day simulation (sandbox only) |

## 2. Daily Short (unchanged pipelines, new decisions)

`shorts-sira.js` (Failure Reconstructed) and `core/pipeline/impossible-brief.js`
(ImpossibleBrief, CriticalThread, The Hidden Logic of Things) call the engine:

1. **Select** — rank a logged pool of 20–50 source-backed, unused production topics. A deterministic 75/25 exploit/explore allocator chooses the highest SelectionScore or an under-sampled cluster. C remains channel-policy fallback only; **D is never produced**. The complete pool, factor breakdowns, chosen mode, rejected rows and reason are stored in `latest-decision.json` / `decisions.json`.
2. **Pre-render gate** — `planShort`: ≥10 competing hooks, ≥20 competing titles, first 3 s, 13-part retention lint, CTA, integrity, factual and pacing checks → ProductionReadinessScore. BLOCK stops the topic before any render cost.
3. **Final gate** — the same plan with the measured render (audio, captions, duration, resolution, legacy quality-gate components). Only PUBLISH uploads.
4. **After upload** — `runtime.afterUpload` registers growth metadata (hook type, bucket, cluster, experiment arm…) for analytics and learning.

`GROWTH_GATE_MODE=shadow` logs decisions without blocking (rollback switch).

## 3. Weekly long-form lane

```
node growth.js longform --channel <slug> [--dry-run] [--force]
```

- Runs after every Short step in `portfolio-production.yml`; most hourly runs print "not due". One cycle per ISO week (`channels/<slug>/state/longform/lane.json`); due on the channel's preferred days once 7 calendar days have passed since the last episode (or immediately when none exists); overdue after 9 days.
- Terminal states: `PUBLISHED`, `READY_FOR_RENDER`, `REVIEW_REQUIRED`, `QUALITY_BLOCKED`, `NO_CANDIDATE`. A cycle left `RUNNING` by a crash is re-run on the next invocation.
- **Quality over cadence**: `QUALITY_BLOCKED` is expected behaviour and exits 0. The gate never relaxes because seven days passed.
- **Research deepening** (`research.js`): the topic's cited Wikipedia article (or an exact/redirect title match on the subject — never a fuzzy search) becomes up to 160 sentence-level claims with section, role, URL and licence, plus the article's images as visual-lead candidates. Wikipedia text is **CC BY-SA**: these claims are `verbatim:false` — the deterministic writer never narrates them, the LLM writer must rewrite them, and any paragraph that repeats 9+ consecutive source words is a hard `COPY_RISK` block.
- **Writer**: deterministic evidence preview by default. `LONGFORM_LLM_PROVIDER=groq` + `GROQ_API_KEY` selects Groq's OpenAI-compatible endpoint; `GROQ_MODEL` defaults to `openai/gpt-oss-120b`. The existing Anthropic path remains compatible when explicitly selected (the legacy `LONGFORM_LLM=1` behavior is retained). `LONGFORM_LLM_FALLBACK_PROVIDER` is the only way to allow fallback; there is no silent paid switch. The structured writer checkpoints fact pack, angle/blueprint and each section, cites claim IDs, and resumes after a bounded 429 deferral.
- **Gate hard fails**: bucket D, fewer than 2 sources or no primary/authoritative source (3 preferred), unsupported number, `COPY_RISK`, `INSUFFICIENT_DEPTH` (evidence < 85 % of the 8-minute minimum — never padded), duplicate episode, no truthful thumbnail, visual-integrity failures, render failure.
- **Render/upload** only when the channel's `growth-engine.json` sets `longform.render.enabled: true` **and** the repository variable `<PREFIX>_LONGFORM_PUBLISH=1` (`FR_`, `IB_`, `CT_`, `BTO_`). Otherwise an approved package stops at `READY_FOR_RENDER`. Rendering reuses `seslendir.js → gorsel-bul.js → video-yap.js`, upload reuses `youtube-yukle.js --channel`.

### Enabling long-form for a channel

1. Configure an explicit writer, normally `LONGFORM_LLM_PROVIDER=groq`, `GROQ_API_KEY`, and `GROQ_MODEL=openai/gpt-oss-120b`. Configure a fallback only when its cost is intentionally accepted.
2. Watch a few weekly cycles in dry-run mode (`workflow_dispatch` with `dry_run: true`) and review `channels/<slug>/state/longform/packages/*.json`.
3. Set `longform.render.enabled: true` in `channels/<slug>/growth-engine.json` and `<PREFIX>_LONGFORM_PUBLISH=1`.
4. After each episode: do the listed `RELATED_VIDEO_MANUAL_ACTION_REQUIRED` tasks and the end-screen plan in YouTube Studio (no API exists for either).

## 4. Funnel (same channel only)

- **Short → Long**: `relate()` classifies SOURCE_LONGFORM / SAME_EVENT / SAME_SYSTEM / TOPIC_EXPANSION / SAME_SERIES; below `funnel.minimumRelationshipScore` there is no link. Every link creates a `RELATED_VIDEO_MANUAL_ACTION_REQUIRED` task because the Data API has no Shorts Related Video field. `setRelatedVideo()` is the single place to change if YouTube ships one.
- **Long → Long**: `nextVideos()` picks a primary and secondary next episode from the same channel; `endScreenPlan()` fixes the final-20-second element set and the spoken transition.
- Cross-channel links, clusters and relationship files are rejected at write time (`CROSS_CHANNEL_LINK_BLOCKED`, `FUNNEL_ISOLATION_VIOLATION`).

## 5. Analytics support matrix

| Metric / capability | Status | Source |
|---|---|---|
| views | SUPPORTED | Data API viewCount / Analytics views |
| engaged_views | ACCOUNT-DEPENDENT | Analytics API engagedViews (requested in future video-filtered reports) |
| likes, comments | SUPPORTED | Data API statistics |
| shares | ACCOUNT-DEPENDENT | Analytics API shares |
| subscribers_gained / lost | ACCOUNT-DEPENDENT | distinct Analytics API subscribersGained and subscribersLost; net is derived, never relabelled as gross |
| average_view_duration, average_percentage_viewed, watch_time | ACCOUNT-DEPENDENT | Analytics API |
| traffic_source | ACCOUNT-DEPENDENT | insightTrafficSourceType |
| retention_curve | ACCOUNT-DEPENDENT | audienceWatchRatio / relativeRetentionPerformance |
| impressions, CTR, returning viewers | UNAVAILABLE | Studio only (manual entries are labelled manual) |
| viewed vs swiped away, stayed to watch | UNAVAILABLE | Studio-only Shorts metrics |
| end-screen clicks | UNAVAILABLE | no end-screen element metric in the Analytics API |
| card clicks, playlist metrics | ACCOUNT-DEPENDENT | cardClicks; playlistStarts / viewsPerPlaylistStart / averageTimeInPlaylist |
| Shorts Related Video write | UNAVAILABLE | manual Studio action |
| end-screen write | UNAVAILABLE | manual Studio action |
| thumbnail update, scheduled publishing, synthetic-media disclosure | SUPPORTED | thumbnails.set, status.publishAt, status.containsSyntheticMedia |
| Short → Long conversion | INFERRED | long-form traffic from SHORTS / RELATED_VIDEO around linked Short dates |
| Long → Long session | INFERRED | RELATED_VIDEO / END_SCREEN traffic share on the next episode |

Missing metrics are stored as `UNAVAILABLE` / `NOT_COLLECTED`, never as zero; diagnosis emits `INSUFFICIENT_DATA` instead of guessing.

Historical FR migration is idempotent: `npm run growth:backfill` imports only snapshot files that exist. It never fabricates missing 1h/6h/12h/48h values. Older files that labelled net subscriber change as `subscribersGained` are migrated to `net_subscribers`; gross conversion stays unavailable.

## 6. Learning and experiments

- `channels/<slug>/memory/growth-learning.json` has separate `shorts` and `longform` blocks; each learns only from its own content type and its own channel. Stages: OBSERVATION → HYPOTHESIS → ADOPTED_LEARNING (sample floors and a z ≥ 2 rule); adopted weights shift topic factors by at most `learning.maxWeightShift`.
- Adopted and statistically supported suppressed patterns adjust hook family, title pattern, topic cluster, duration bucket and factor weights. Subscriber conversion is the largest configured growth-score component (0.30), so high views alone cannot dominate the learned outcome.
- `channels/<slug>/memory/growth-experiments.json`: one variable per experiment, one running experiment per channel and content type, deterministic arm assignment before production (never a second upload).

## 7. Commands

```bash
npm run growth             # status per channel
npm run growth:report      # reports/growth-dashboard.md (+ .json)
npm run growth:report:failure-reconstructed # detailed FR report
npm run growth:backfill    # import FR's real historical analytics, normalize, relearn, report
npm run library:failure-reconstructed:inventory # rebuild 500 source-verified records
npm run growth:dry-run     # reports/dry-runs/<channel>-{short,long}.md (sandbox)
npm run growth:simulate    # reports/growth-system-30d-simulation.md (sandbox)
npm run test:growth        # growth engine tests
node e2e-behind-the-ordinary.js # BTO no-upload package E2E
node growth.js longform --channel failure-reconstructed --dry-run
node growth.js research --channel impossible-brief --topic what-if-the-moon-disappeared-tonight
node scripts/ib-ct-library/build.js channels/<slug>/topics/research-seeds/batch-NN.json          # verify only
node scripts/ib-ct-library/build.js channels/<slug>/topics/research-seeds/batch-NN.json --write  # upgrade the universe
```

### Researched ImpossibleBrief / CriticalThread records

Templated universe entries are replaced by researched records written in `channels/<slug>/topics/research-seeds/batch-NN.json` and applied with `scripts/ib-ct-library/build.js`. The builder upgrades entries **in place**, so the universe keeps its size, ids and category mix (the IB 500-topic and category tests still hold). An IB seed may set `"replaces": "<slug>"` or `"auto"` (+ `category`) to swap out a weak combinatorial question.

A record is written only when all of these pass:

- 5–8 narration lines, 55–90 words, sentences ≤ 16 words, a layer and role on every line; line 1 is the spoken opening and fits the opening budget (IB ≤ 9 words, CT ≤ 8), opening + second beat ≤ 18 words.
- ≥ 4 sourced facts. Every number in a fact must appear in that fact's own source text (Wikipedia extract or primary page). Every number shown or spoken must trace to a fact (years in facts and bare "million/billion" multipliers excepted).
- Topic-level sources stay on primary hosts (legacy `core/research` audit), the legacy quality gate does not BLOCK, and the hook engine finds ≥ 10 candidates with the spoken opening selected.

After `--write` the builder runs the growth planner on each record and prints bucket and readiness.

## 8. Known limitations (2026-09-30)

- **ImpossibleBrief** has 141 researched records (A 45 / B 97) and **CriticalThread** 149 (A 26 / B 123), roughly five months of daily Shorts each (seed batches 01–09 / 01–10). The rest of each universe is still templated and rejected (IB 357 C, CT 373 D). More research-seed batches are needed to reach a year.
- **Long-form** cannot reach 8–12 minutes from a Shorts case file. With `LONGFORM_LLM` off, every cycle is honestly `QUALITY_BLOCKED` (`INSUFFICIENT_DEPTH`). With the writer on, the simulation shows Failure Reconstructed passing weekly; ImpossibleBrief question topics remain short of depth.
- Most Failure Reconstructed topics carry 2 sources (encyclopedia + one official investigation/agency). That passes the long-form hard minimum; a third independent source raises SourceCoverage.
- Shorts Related Video, end screens, impressions/CTR and viewed-vs-swiped remain manual/Studio-only.
- FR's durable inventory is 500 qualified/source-linked records: 377 full production case files plus 123 API-verified research-backlog records. Backlog records cannot render until deeper source, visual-licence, script and quality gates create a full case file.
- The historical snapshot set contains net subscriber change, not separate gross gained/lost values. The backfill therefore reports net conversion and leaves historical gross conversion unavailable; future Analytics API passes request both gross fields.
- The current measured sample is 10 Shorts. It is enough for channel-relative observations and plateau classification, not enough for statistically adopted strategy changes; the learning floor remains enforced.
