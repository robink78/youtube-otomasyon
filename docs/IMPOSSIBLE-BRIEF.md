# ImpossibleBrief

**Tagline:** Impossible questions. Scientific answers.

ImpossibleBrief covers what-if science, space, physics, Earth, human biology, future technology, astronomy, extreme science, planets, black holes, gravity, time, energy, climate scenarios, and humanity.

## Editorial contract

Every material claim is separated into:

- `KNOWN SCIENCE` — established mechanism; confidence `VERIFIED`.
- `ESTIMATED CONSEQUENCE` — inference or model-based outcome; confidence `SUPPORTED` or `ESTIMATED`.
- `SPECULATIVE SCENARIO` — the impossible premise or uncertain extension; confidence `SPECULATIVE`.

Important claims require at least two primary/authoritative sources. The library uses NASA, JPL, ESA, NOAA, USGS, CERN, NIST, NIH, DOE Office of Science, and IPCC references. Wikipedia may help discovery but is not accepted by the research audit as sole evidence.

Forbidden openings include “Did you know”, “Imagine”, “Today we will”, “In this video”, “Scientists say”, a welcome, or a logo intro. A Short targets 18–35 seconds: consequence by 1.5 seconds, escalation by 5 seconds, mechanism through 18 seconds, payoff through 28 seconds, then an optional curiosity bridge.

## Brand

The brand file is `channels/impossible-brief/brand.json`: dark navy/black, electric cyan, icy blue, white, and rare warm highlights. Visuals are cinematic, clean, modern, premium, and high contrast. Avoid childish graphics, generic neon overload, cheap sci-fi, clutter, or unlabelled AI illustration.

Visual priority is official scientific media, diagrams, public-domain astronomy, procedural simulations, labelled AI illustration, then genuinely relevant stock. Illustrative scenes carry `ILLUSTRATION`; they are not presented as observations or evidence.

## Topic library

`channels/impossible-brief/topics/topic-universe.json` contains 500 qualified, unique topics:

| Category | Count | Share |
|---|---:|---:|
| Space | 125 | 25% |
| Earth | 100 | 20% |
| Physics | 100 | 20% |
| Human | 50 | 10% |
| Future technology | 50 | 10% |
| Extreme science | 50 | 10% |
| Other | 25 | 5% |

Each entry stores ID, topic, category, hook, mechanism, core question, Short/long/visual potential, evergreen and curiosity scores, competition estimate, source quality, confidence, claim framework, sources, qualification scores, and status. Regenerate deterministically with `node scripts/generate-impossible-brief-topics.js`; then run `node library-health.js --channel impossible-brief`.

Current health: 500 ready Shorts, 304 long-form candidates, 500 inventory days (16.4 months), zero exact duplicates, and zero low-confidence qualified topics.

## Production commands

```bash
node shorts-sira.js --channel impossible-brief --no-render  # package only
node shorts-sira.js --channel impossible-brief              # voice + captions + Short render
node e2e-impossible-brief.js --render                        # three fixed no-upload E2E cases
node post-publish-analyzer.js --channel impossible-brief --due
node channel-plan.js --channel impossible-brief
node library-health.js --channel impossible-brief
```

The upload switch remains `PUBLISH=1`, but that alone is insufficient: `IB_YT_CLIENT_ID`, `IB_YT_CLIENT_SECRET`, `IB_YT_REFRESH_TOKEN`, and `IB_YT_CHANNEL_ID` must all be correct. A mismatched authenticated ID exits with code 7 before upload.

## Verified E2E cases

The SPACE, EARTH, and PHYSICS packages for Moon disappearance, a one-second rotation stop, and doubled gravity passed scripts, claim layers, direct authoritative sources, hooks, claim-timed synthetic dry-run narration, synchronized burned captions, eight-change scenario-specific procedural diagrams, 1080×1920 rendering, scenario-specific thumbnails, descriptions, quality gates, and metadata. Durations were 19.784, 18.625, and 19.134 seconds. Upload was disabled.
