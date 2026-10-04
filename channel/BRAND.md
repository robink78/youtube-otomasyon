# FAILURE RECONSTRUCTED — Forensic Engineering Documentaries

**What the viewer should feel:** *"This channel reconstructs exactly why systems failed."*
**What they should never feel:** *"This is another faceless AI YouTube channel."*

## Recurring brand elements (and where they come from)

| Element | What it is | Produced by | Appears when |
|---|---|---|---|
| **Failure chain** | Numbered boxes from the trigger to the collapse; the final box is red | `engineering-visuals.js` (`failure-chain`) | Shorts: ~3 s overlay on the first technical scene. Long-form: in the technical-cause scene |
| **Failure timeline** | Dated markers on a blueprint line | `engineering-visuals.js` (`timeline`) | Case videos with ≥ 2 dated events |
| **Root cause card** | Mechanism in large type + the trigger | `engineering-visuals.js` (`root-cause`) | The discovery/investigation scene |
| **Myth vs evidence** | "Common belief" vs "What the evidence shows" | `engineering-visuals.js` (`myth-vs-evidence`) | When the case file records a common misconception |
| **Critical decision marker** | Red card: the moment it could have been stopped | `engineering-visuals.js` (`critical-decision`) | Only if the case file documents a real decision (`vaka.karar`) |
| **Warning signs** | The signals that were missed | `engineering-visuals.js` (`warning-signs`) | Only if `vaka.uyarilar` exists |
| **What changed afterwards** | The engineering practice the failure changed | `engineering-visuals.js` (`what-changed`) | The final-lesson scene |
| **Date / location stamp** | `1940 · TACOMA NARROWS` in amber, top-left | `shorts-yap.js` | Case Shorts, on the context scene |
| **Colour language** | Blueprint navy (`#0B1522`), grid, amber accent (`#D9A441`), failure red (`#D9534F`) | shared constants | Diagrams, thumbnails, stamps |
| **Voice** | Andrew (Edge neural), documentary register, no clichés | `seslendir.js`, `shorts-yap.js` | Every video |

## Not mechanically identical

- Elements appear **only when the case file has the evidence for them**. A video without documented warning signs has no warning-signs card, and the chain length follows the real chain.
- The structure adapts to the story type (`story-structure.js`: chronological / investigation / explainer).
- The primary thumbnail layout rotates to the least-used layout on the channel (`thumbnail-strategy.js`), and title patterns are penalised when overused (`title-engine.js`).
- Music follows the cluster's mood, with per-video variation (`lib/muzik.js`).
- `originality-check.js` measures what is left: structure, hooks, sentences, footage reuse, thumbnails and music.

## Series (topic clusters)

Bridge Failures · Structural Engineering Failures · Aviation Failures · Spaceflight Disasters · Maritime Disasters · Nuclear Accidents · Fires & Explosions · Industrial Disasters · Infrastructure Failures · Materials & Fatigue · Natural Hazards vs. Engineering. See `channel/topic-clusters.json` and `channel/internal-linking-plan.md`.
