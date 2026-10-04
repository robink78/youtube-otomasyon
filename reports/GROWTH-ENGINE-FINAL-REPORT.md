# Growth engine — final report (2026-09-30)

Scope: turn the three-channel automation (Failure Reconstructed, ImpossibleBrief, CriticalThread) into a growth system — better selection, stronger hooks and first 3 seconds, retention-shaped Shorts, a quality gate, a weekly long-form lane, a same-channel Short→Long funnel, and channel-isolated analytics and learning — without duplicating the application, breaking Shorts or TikTok, or blending channels. Nothing in this report has been committed or pushed.

## 1. CURRENT ARCHITECTURE

One Node.js code base, channel registry (`config/channels.json`, `core/channel-context.js`), per-channel config, credentials (`FR_`, `IB_`, `CT_` prefixes), paths and state. Failure Reconstructed runs through `shorts-sira.js` with legacy paths (`icerik/…`) behind an adapter; ImpossibleBrief and CriticalThread run through `core/pipeline/impossible-brief.js` with isolated `channels/<slug>/…` roots. Rendering (`shorts-yap.js`, `core/rendering`), upload (`youtube-yukle.js --channel`), TikTok inbox (Failure Reconstructed only), analytics (`post-publish-analyzer.js`, `lib/analitik`) and one serialized GitHub Actions portfolio lane (`portfolio-production.yml`, render/upload concurrency 1) are shared. The new growth engine (`core/growth/*`) sits between selection and rendering, and alongside it as the weekly long-form lane; all of its state goes through one path builder (`core/growth/store.js`).

## 2. MAIN PROBLEMS FOUND

1. Topic choice was priority/queue-based. There was no measure of video potential, hook strength or source quality before render cost was spent.
2. **ImpossibleBrief (499) and CriticalThread (522) inventories are largely templated.** The same sentence skeletons repeat across hundreds of topics with few topic-specific facts. Measured: IB 3 B + 496 C; CT 1 C + 521 D.
3. Failure Reconstructed had 46 case files (about 9 publish-grade). It now has 377, of which 367 are unused. Details are in the library report.
4. Long-form existed only as local components. There was no weekly lane, no depth measure, no gate and no funnel.
5. The analytics code did not state which metrics the API cannot provide. Shorts Related Video, end screens, impressions/CTR and viewed-vs-swiped are Studio-only.
6. Found and fixed during this work:
   - date openings ("In 1944…") were only penalised, not blocked;
   - opening subscribe CTAs were not caught;
   - long-form cadence used 24-hour blocks, which skipped a week;
   - cluster integrity flagged a topic's Short and its long-form episode as a "duplicate";
   - long-form visuals cycled 8 stills across about 80 scenes;
   - the old LLM call used the wrong server-side-fallback header/form for Opus 5 and did not stream a 16k+ output;
   - the Commons still selector accepted namesake images (Civil-War soldiers for "Hinton", carnival photos for "Viareggio", 1779 battle prints for USS *Bonhomme Richard*, an adult-expo photo for "Hitomi").

## 3. SHARED CORE CHANGES

New `core/growth/` has 27 modules and about 4,470 lines: `config`, `store`, `topic-model`, `sources`, `topic-scoring`, `context`, `hooks`, `first-seconds`, `script`, `titles`, `engagement`, `integrity`, `pacing`, `readiness`, `index`, `research`, `longform`, `lane`, `funnel`, `analytics`, `diagnosis`, `learning`, `experiments`, `runtime`, `report`, `dry-run` and `simulate`. The CLI is `growth.js`. Defaults live in `config/growth-engine.json`, with per-channel overrides in `channels/<slug>/growth-engine.json`. All state goes through `Store`, which blocks cross-channel writes at every writer. `GROWTH_STATE_ROOT` sandboxes tests, dry runs and simulation. `GROWTH_GATE_MODE=shadow` is the rollback switch.

## 4. FAILURE RECONSTRUCTED CHANGES

- `shorts-sira.js` now uses the growth pre-render gate and the final-render gate. The final gate maps the existing `quality-gate.js` components in, so nothing is measured twice.
- `Growth.orderedQueue` is used for topic order, and `afterUpload` registers growth metadata.
- Editorial narration is mapped and linted, never rewritten.
- **Library:** 46 → 377 case files (367 unused, about a year of daily Shorts). Every file passes numeric fact checks against Wikipedia, has authoritative-source ranking, 3–7 licence-clean (PD/CC0/CC BY) stills checked for relevance by a library-wide Commons metadata audit, and has originality PASS (377/377).
  - The seed-to-spec tooling is in `scripts/fr-library/`: build, probe and resolve.
  - It gained a Wikimedia 429 retry, `excludeStills`, `strictStills` (namesake-prone cases) and a permanent unsafe-content filter.
  - 12 topics were dropped because no correct licence-clean stills exist.
- TikTok is unchanged. It stays Failure Reconstructed only, with the same steps and duplicate guards.

## 5. IMPOSSIBLEBRIEF CHANGES

- `core/pipeline/impossible-brief.js` now does these steps:
  - `chooseTopic` → `Growth.selectShortTopic` (A/B first, C on experiment days only, D never);
  - pre and final readiness;
  - alerts;
  - growth summary;
  - `afterUpload`.
- Rendering (`core/rendering/index.js`) accepts the growth plan: dynamic pacing segments, growth captions and a readiness check.
- Effect: the templated inventory alone yielded about 6 qualified Shorts per 30 days; other days are skipped (`NO_QUALIFIED_TOPIC`) instead of publishing weak content.
- **Update (2026-09-30):** 141 researched records (seed batches 01–09, `scripts/ib-ct-library/build.js`) now give A 45 / B 97 — about five months of daily Shorts. Each record carries editorial narration with KNOWN SCIENCE / ESTIMATED CONSEQUENCE / SPECULATIVE SCENARIO layers and ≥ 4 number-verified facts.
- The long-form lane selects question topics and deepens them from the matching encyclopedia article (e.g. "Plankton", "Moon").

## 6. CRITICALTHREAD CHANGES

Same pipeline integration as ImpossibleBrief (shared pipeline). The original inventory was 521 D (templated) and 1 C. **Update (2026-09-30):** 149 researched records (seed batches 01–10) now give A 26 / B 123, about five months of daily Shorts; the remaining 373 templated entries stay D and are never published. Long-form deepens "EUV lithography" via exact/redirect title match.

## 7. SHORTS PIPELINE CHANGES

- **Selection:** topic buckets A/B/C/D from VideoPotentialScore (14 factors, `inventory-signal` vs `derived` basis labelled).
- **Hooks:** at least 10 hook candidates across 15 families with 8 scores each. Forbidden openings, opening CTAs and date/setup openings are blockers. Unsupported numbers and superlatives are blocked.
- **First 3 seconds:** a First3SecondPlan with a real evidence frame, on-screen text, motion, cut timing and sound cue.
- **Script:** retention lint; CTA and loop planning.
- **Integrity:** source classes and disclosure labels; factual number checks.
- **Pacing and captions:** pacing segments; captions of at most 4 words and 2 lines.
- **Gate:** ProductionReadinessScore with PUBLISH ≥ 85 / REVIEW 70–84 / BLOCK < 70, and hard fails override the score.
- **Output:** the per-run summary block from PHASE 33.
- Cadence, the TikTok steps and upload code are untouched.

## 8. LONG-FORM PIPELINE CHANGES

`longform.js` builds the full package:

- ResearchPackage (reused and cached);
- outline following channel structures;
- at least 5 cold opens;
- script with a claim/source map;
- scene and asset plan;
- at least 5 thumbnail concepts;
- titles;
- 3–7 derived Short plans;
- related-video mapping;
- end-screen plan;
- cost estimate;
- LongFormProductionReadinessScore.

**New: `research.js` deep research.**
- Takes up to 160 sourced sentence claims and the article's image leads from the cited or exact-match encyclopedia article.
- These claims are CC BY-SA rewrite-only: the deterministic writer never narrates them.
- The LLM writer must paraphrase, and 9+ copied words is a `COPY_RISK` hard fail.

**Writer:** Claude (`claude-opus-5` default; `ANTHROPIC_MODEL` / `LONGFORM_MODEL`), streamed, `fallbacks: "default"`, only when `LONGFORM_LLM=1` and `ANTHROPIC_API_KEY` are set.

**Gate hard fails:**
- fewer than 2 sources, or no primary source (3 preferred);
- unsupported number;
- `COPY_RISK`;
- `INSUFFICIENT_DEPTH`, which is never padded;
- duplicate episode;
- no truthful thumbnail;
- integrity or render failure.

**Weekly lane (`lane.js`):**
- ISO-week cycles, idempotent;
- calendar-day cadence with preferred days and a 9-day overdue rule;
- crash recovery for RUNNING cycles;
- `QUALITY_BLOCKED` exits 0;
- render/upload reuses `seslendir.js → gorsel-bul.js → video-yap.js → youtube-yukle.js` and only runs with `longform.render.enabled` + `<PREFIX>_LONGFORM_PUBLISH=1`.

**Workflow:** a new step in `portfolio-production.yml` runs after all Short and TikTok steps with `continue-on-error`.

## 9. SHORT → LONG FUNNEL IMPLEMENTATION

- `Funnel.relate` classifies SOURCE_LONGFORM, SAME_EVENT, SAME_SYSTEM, TOPIC_EXPANSION and SAME_SERIES. There is a relationship score floor, and links are same-channel only (`CROSS_CHANNEL_LINK_BLOCKED`).
- `planShort` attaches the related published long-form and a CTA (`relatedLongVideo`).
- `registerEpisode` links related published Shorts to the new episode.
- Every link produces a `RELATED_VIDEO_MANUAL_ACTION_REQUIRED` task, because there is no API field for it; `setRelatedVideo()` is the single switch point.
- Clusters are kept in `clusters.json` with an integrity check.
- In simulation scenario B: 10 Short→Long links and 10 manual-action tasks for Failure Reconstructed.

## 10. LONG → LONG SESSION IMPLEMENTATION

`Funnel.nextVideos` picks a primary and secondary same-channel next episode. `endScreenPlan` sets the final 20 s, the elements (next video, playlist, subscribe) and the spoken transition line. `linkLongToLong` records the path. End screens are applied manually in Studio. Simulation B: 4 Long→Long links.

## 11. FILES MODIFIED

**Modified:**
- `.github/workflows/portfolio-production.yml`
- `README.md`
- `channels/{failure-reconstructed,impossible-brief,critical-thread}/config.json`
- `config/growth.json`
- `core/pipeline/impossible-brief.js`
- `core/rendering/index.js`
- `description-engine.js`
- `docs/GROWTH-ARCHITECTURE.md`
- `docs/OPERATIONS.md`
- `lib/kutuphane.js`
- `originality-check.js`
- `package.json`
- `post-publish-analyzer.js`
- `shorts-sira.js`

These 16 files total +243 / −33.

**New:**
- `core/growth/` (27 files)
- `growth.js`
- `config/growth-engine.json`
- `channels/*/growth-engine.json`
- `tests/js/growth.test.js`
- `scripts/fr-library/{build,probe,resolve}.js`
- `docs/GROWTH-ENGINE.md`
- `reports/dry-runs/*`
- `reports/growth-dashboard.{md,json}`
- `reports/growth-system-30d-simulation.md`
- this report
- `icerik/kutuphane-tohum/` (22 seed batches + candidate/probe files)
- 331 new `icerik/konular/*.json` case files

## 12. NEW CONFIGURATION OPTIONS

**`config/growth-engine.json` sections:** `topic`, `scheduler`, `hooks`, `firstSeconds`, `script`, `titles`, `engagement`, `pacing`, `captions`, `readiness`, `longform`, `funnel`, `analytics`, `diagnosis`, `learning`, `experiments`, `cost`.

Key options:
- **Topics:** `topic.buckets` (A 80 / B 68 / C 55).
- **Short scheduler:**
  - `scheduler.shorts.primaryBuckets`;
  - `experimentRatio` (0.15);
  - `fallbackToC` (false);
  - `skipDayWhenNoQualifiedTopic`.
- **Readiness:** `readiness.*.publish/review`.
- **Long-form cadence and length:**
  - `longform.enabled`;
  - `cadenceDays` (7);
  - `publishDayPreference`;
  - `targetMinutes` [8, 12].
- **Long-form sources:**
  - `minimumSources` (3, preferred);
  - **`minimumSourcesHard` (2)** (new);
  - **`minimumPrimarySources` (1)** (new).
- **Long-form rendering:** `longform.render.enabled` (false).
- **Learning:** `learning.minimumSample*`, `maxWeightShift`.
- **Experiments:** `experiments.maxActivePerContentType`, `minimumPerArm`.

**Channel overrides:** `channels/<slug>/growth-engine.json`.

**Environment:**
- `GROWTH_GATE_MODE=shadow`
- `GROWTH_STATE_ROOT`
- `LONGFORM_LLM=1`
- `ANTHROPIC_API_KEY` (secret)
- `ANTHROPIC_MODEL`
- `LONGFORM_MODEL`
- `FR_/IB_/CT_LONGFORM_PUBLISH=1`

**Channel config:** `publishingCadence.longForm` (`everyDays` 7, `targetDurationMinutes`, `qualityOverCadence`).

## 13. ANALYTICS SUPPORT MATRIX

| Metric / capability | Status |
|---|---|
| views, likes, comments | SUPPORTED |
| engaged views | SUPPORTED (recorded when returned) |
| shares, subscribers gained, average view duration, average % viewed, watch time, traffic source, card clicks | ACCOUNT-DEPENDENT (needs `yt-analytics.readonly` on the channel token) |
| **retention metrics** (audienceWatchRatio curve) | ACCOUNT-DEPENDENT |
| **playlist metrics** (playlistStarts, viewsPerPlaylistStart, averageTimeInPlaylist) | ACCOUNT-DEPENDENT |
| impressions, CTR, returning viewers | UNAVAILABLE (Studio only; manual entries labelled manual) |
| **viewed vs swiped** / stayed to watch | UNAVAILABLE (Studio-only Shorts metrics) |
| **end-screen metrics** (element clicks) | UNAVAILABLE (no API metric; END_SCREEN appears only as a traffic source) |
| **Shorts Related Video automation** | UNAVAILABLE (no API field) → manual action tasks |
| end-screen write | UNAVAILABLE (manual in Studio) |
| thumbnail update, scheduled publishing, synthetic-media disclosure | SUPPORTED |
| **Short-to-long conversion attribution** | NOT DIRECTLY AVAILABLE — INFERRED from long-form SHORTS / RELATED_VIDEO traffic around linked Short dates |
| Long → Long session continuation | INFERRED (RELATED_VIDEO / END_SCREEN traffic share) |
| Adaptive learning from live data | NOT IMPLEMENTED on live data yet: `growth/performance.json` is empty until `post-publish-analyzer.js` checkpoints accumulate (it now calls `analyticsPass`) |

## 14. TESTS ADDED / RUN

**Added:** `tests/js/growth.test.js`, 32 tests. They cover:
- **Isolation:** multi-channel state, learning and analytics isolation; wrong-channel plan protection.
- **Short selection and gating:** duplicate production; topic scoring; hook scoring (forbidden, CTA and date openings); first-3-sec planning; quality block (hard fail and wrong-channel metadata); Shorts regression safety (editorial narration unchanged).
- **Analytics and learning:** missing analytics metrics; diagnosis thresholds; Shorts vs long-form analytics separation; Shorts vs long-form learning separation; experiment metadata.
- **Long-form scoring and gate:** LongFormPotentialScore; long-form gate for depth, COPY_RISK, source policy, and the deterministic writer never narrating CC BY-SA text; long-form gate can PUBLISH with sourced, rewritten evidence.
- **Research:** ResearchPackage reuse; research extraction/roles.
- **Planning:** thumbnail planning; long-form title engine; end-screen planning.
- **Funnel and clusters:** Short→Long mapping; cross-channel relationship blocking; content cluster integrity.
- **Long-form scheduling:** long-form state and scheduling isolation; scheduler recovery (RUNNING cycle); long-form duplicate prevention.

**Already covered by existing tests and re-run:**
- wrong-channel upload (6 directions);
- OAuth isolation;
- duplicate upload / TikTok duplicate and backlog;
- scheduler recovery (watchdog);
- Failure TikTok regression.

**Results:**
- `npm test`: JS 109 tests, 108 pass, 0 fail, 1 skipped (ffmpeg text-overflow check); Python 24 tests OK.
- `actionlint` on all workflows: clean.

## 15. SHORT DRY-RUN RESULTS

Full reports are in `reports/dry-runs/<channel>-short.md`: candidates, scores, 10 hooks, First3SecondPlan, script, scene plan, SRT captions, metadata and readiness.

| Channel | Topic | Bucket / potential | Selected hook (family, score) | First 3 s | Readiness | Decision |
|---|---|---|---|---|---|---|
| Failure Reconstructed | chernobyl-1986 | A / 90 | "Chernobyl reactor 4 exploded during a safety test." (shocking_consequence, 79; 11 candidates / 7 families) | 97 | 94 | PUBLISH (pre-render) |
| ImpossibleBrief | what-if-the-moon-disappeared-tonight | B | "Moon gone. Gravity lingers." (visual_first_reveal, 78; **9** candidates) | 93 | 90 | PUBLISH (pre-render) |
| CriticalThread | the-machine-the-entire-chip-industry-depends-on | **C** | "Without it, leading-edge chipmaking loses a qualified step." (72; **9** candidates) | 93 | 86 | **NOT SCHEDULED** (C, fallback off) |

## 16. LONG-FORM DRY-RUN RESULTS

Full reports are in `reports/dry-runs/<channel>-long.md`: candidates, research sources, ResearchPackage, outline, cold opens, script, scene/asset plan, thumbnails, titles, derived Shorts, related-video mapping, end screen and readiness. All three were run without an LLM (no key configured).

| Channel | Topic | LongFormPotential | Deep research | Script | Readiness | Decision |
|---|---|---|---|---|---|---|
| Failure Reconstructed | challenger-1986 | 83 A | 160 claims ("Space Shuttle Challenger disaster") | deterministic, 2.3 min | 83 | BLOCK — INSUFFICIENT_DEPTH (not padded) |
| ImpossibleBrief | would-doubling-all-ocean-plankton-help-or-harm-us | 71 B | 160 claims ("Plankton") | deterministic, 0.8 min | 84 | BLOCK — INSUFFICIENT_DEPTH |
| CriticalThread | the-machine-the-entire-chip-industry-depends-on | 62 C | 160 claims ("EUV lithography") | deterministic, 1.3 min | 82 | BLOCK — INSUFFICIENT_DEPTH |

With a writer that paraphrases the deep package, tests and simulation scenario B show Failure Reconstructed packages passing (87–93, PUBLISH), with no COPY_RISK and no unsupported numbers.

## 17. BEFORE / AFTER COMPARISON

| Area | Before (all three channels) | After |
|---|---|---|
| Topic selection | queue / editorial priority | VideoPotentialScore → A/B first, C on experiment days, D never; skip rather than publish weak |
| Hook selection | FR legacy hook engine; IB/CT template opening | at least 10 candidates, 15 families, 8 scores; forbidden, CTA and date openings blocked |
| Script structure | FR editorial; IB/CT templates | FR editorial (linted, never rewritten); IB/CT retention builder; channel story structures |
| First 3 s | implicit | First3SecondPlan (evidence frame, text, motion, cuts, sound) scored |
| Visual pacing | fixed per renderer | growth pacing segments + caption audit (IB/CT renderer consumes the plan) |
| Quality gate | FR `quality-gate.js`; IB/CT validations | ProductionReadiness pre and final gates, hard fails, legacy gate mapped in |
| Analytics loop | FR analyzer; others partial | checkpoints 1 h…30 d per channel and content type, diagnosis codes, UNAVAILABLE never zero |
| Learning | FR retention memory | Shorts and long-form learning per channel; OBSERVATION → HYPOTHESIS → ADOPTED |
| Cadence | Shorts only | daily Shorts + weekly long-form lane, quality over cadence |
| Short → Long funnel | none | relationship model, CTA, manual Related-Video tasks |
| Long-form analytics / learning | none | separate baselines and learning block |
| Long → Long session | none | next-episode picker, end-screen plan, link records |

## 18. 30-DAY SIMULATION RESULT

Details are in `reports/growth-system-30d-simulation.md`. The real selection, gate, lane, funnel, analytics, diagnosis, learning and experiment code ran in a sandbox. Uploads and metrics were simulated and are not forecasts. **50/50 checks PASS** across two scenarios.

**Scenario A (current configuration, no LLM):**
- Failure Reconstructed: 30/30 Shorts.
- ImpossibleBrief: 6/30 Shorts (24 days had no qualified topic).
- CriticalThread: 1/30 Shorts.
- Long-form: every cycle `QUALITY_BLOCKED`, which is expected and not a failure.
- A crash injected on 2026-10-12 (IB cycle W42 left RUNNING) was re-run on 2026-10-13.

**Scenario B (LLM writer simulated):**
- Failure Reconstructed: 5 weekly episodes (challenger, columbia, chernobyl, apollo-13, …), 10 Short→Long links, 4 Long→Long links, clusters intact.
- ImpossibleBrief: 1 episode, then blocked on depth.
- CriticalThread: 1 episode, then `NO_CANDIDATE`.

**Verified:**
- no credential, state, learning or analytics collisions;
- no duplicate uploads;
- no schedule or content collisions;
- Shorts are never lost to the lane;
- blocked long-form cycles do not break scheduler health;
- analytics and learning stay separated by content type.

**Warning:** IB/CT inventory exhaustion.

## 19. REMAINING RISKS

1. **ImpossibleBrief and CriticalThread have about five months of qualified Shorts** (141 and 149 researched records). The templated remainder is still rejected, so more seed batches are needed for a full year.
2. **Long-form will not publish** until the LLM writer is enabled (`ANTHROPIC_API_KEY` + `LONGFORM_LLM=1`). The Claude writer path is implemented against the documented SDK surface but was not executed here (no key in this environment); run one dry-run cycle with the key before enabling render. ImpossibleBrief question topics may still fall short of 8 minutes.
3. IB/CT Shorts produce 9 hook candidates (PHASE 5 asks for 10). The gate records it as a note, not a block. Treat it as a signal of thin topic material.
4. The long-form visual chain has not yet been exercised end-to-end on a 16:9 8–12-minute render in Actions (render is off by default). Article images are candidates, and licence checks happen in the existing chain.
5. Learning and adaptive weights are heuristics-only until real checkpoints accumulate. Short-to-long conversion stays inferred.
6. The Failure Reconstructed library is large and now audited for still relevance by metadata, but a human spot-check of a sample of new case files before they go live is still recommended.

## 20. RECOMMENDED NEXT IMPROVEMENTS

1. Research-enrich ImpossibleBrief and CriticalThread inventories the way the Failure Reconstructed library was built: sourced facts, specific numbers and real visuals per topic.
2. Enable the long-form writer in dry-run and review 2–3 packages. Then turn on render for Failure Reconstructed first.
3. Feed derived-Short plans from approved long-form packages into the Shorts queue as new case files (with editorial narration).
4. Add `engagedViews` to the `lib/analitik` request and a monthly adopted-learning review.
5. Add a third independent source to top long-form candidates to raise SourceCoverage.

## 21. EXACT COMMANDS TO RUN / TEST

```bash
npm test                       # JS + Python
npm run test:growth            # growth engine only
npm run growth                 # per-channel status
npm run growth:report          # reports/growth-dashboard.md
npm run growth:dry-run         # reports/dry-runs/ (sandbox)
npm run growth:simulate        # reports/growth-system-30d-simulation.md (sandbox)
node growth.js longform --channel failure-reconstructed --dry-run
node growth.js research --channel critical-thread --topic the-machine-the-entire-chip-industry-depends-on
GROWTH_GATE_MODE=shadow node shorts-sira.js --channel failure-reconstructed   # log-only rollback
```

## 22. GIT DIFF SUMMARY

- **Tracked files:** 16 modified, +243 / −33.
- **New code:** `core/growth/` (27 files, about 4,470 lines), `growth.js` (107), `tests/js/growth.test.js` (376), `scripts/fr-library/` (3 files, 502), growth config (547 lines of JSON).
- **New content:** 331 Failure Reconstructed case files and 22 seed batches.
- **New docs and reports:** `docs/GROWTH-ENGINE.md`, reports under `reports/`.
- Nothing is committed or pushed; production state files were not modified by tests, dry runs or the simulation (all sandboxed).

## 23. FINAL VERDICT

**PARTIALLY_IMPLEMENTED**

The shared growth engine, the Shorts gates, the weekly long-form lane, the funnel, and the channel-isolated analytics and learning are implemented, tested and simulated. Failure Reconstructed is ready for daily growth-gated Shorts. Two things keep this from "ready for three channels":

1. ImpossibleBrief and CriticalThread have about five months of qualified inventory (141 and 149), not yet a year.
2. The long-form lane will only publish once the LLM writer is enabled and a first real package is reviewed.
