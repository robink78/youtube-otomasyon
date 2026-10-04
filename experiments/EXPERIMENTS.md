# Growth experiments

Rules: one variable per experiment · ≥5 videos per arm before reading results · correlation is not causation · never re-upload to reset an experiment.

## title-style — running

Hypothesis: Story-shaped titles ("The Bridge That…") earn more Shorts-feed views per video than question titles at 7 days.
Variable: title pattern · metric: `views_7d` · start: 2026-09-24

| Arm | Meaning | Videos |
|---|---|---|
| TITLE_STYLE_A | object-that / two-beat story title | PGOKZhPYo7c, DLYpmaQ-EVw, aScjSrwqeRk, I86SnrokHMk, uqoAjXMbbls, M4rr4aVc4Uc, NnGoWJOdaW0, 7q3E09HMIGI, rgSsk8q6eyM, WlZ2z90pqx8, 5yPoQCElJuk, fGE8kZOaQZ4, Vuvx5nEqcaY, rAZ4cE4A0DE |
| TITLE_STYLE_B | why/how question title | qkzRUqlEy5I, X0jw78mIGdk, ODZ7y6r1o6o, bqTpdauhlHo, tIXvjbAXStw, NobEECFBrwo, 4Mo58FxCr4A, u0iftg8gF5w, hsuWhB8lCvU, I9Lcpi9kPYs, Nk7vmybWY98, ZTtPwqBSxpA |

Result (insufficient data confidence): Not enough videos per arm (need ≥5; have TITLE_STYLE_A=2, TITLE_STYLE_B=4). No conclusion — and no causal claim.

## thumbnail-text — planned

Hypothesis: For long-form, a 2-4 word thumbnail text raises CTR versus a text-free frame.
Variable: thumbnail text · metric: `ctr` · start: —

| Arm | Meaning | Videos |
|---|---|---|
| THUMBNAIL_TEXT | 2-4 word text | — |
| NO_THUMBNAIL_TEXT | frame only | — |

## cold-open — planned

Hypothesis: Opening on the event keeps more viewers at 30 s than opening on a question.
Variable: cold open · metric: `first30sRetention` · start: —

| Arm | Meaning | Videos |
|---|---|---|
| COLD_OPEN_EVENT | opens on the failure itself | — |
| COLD_OPEN_QUESTION | opens on a question | — |

## length — planned

Hypothesis: 12-minute documentaries earn more watch time per impression without losing average % viewed.
Variable: long-form length · metric: `watchTimeMinutes` · start: —

| Arm | Meaning | Videos |
|---|---|---|
| 8_MIN_VIDEO | ~8 minutes | — |
| 12_MIN_VIDEO | ~12 minutes | — |

## cta-position — planned

Hypothesis: A mid-video contextual CTA converts more subscribers per 1,000 views than an end CTA.
Variable: CTA position · metric: `subsPer1000` · start: —

| Arm | Meaning | Videos |
|---|---|---|
| CTA_MID | contextual CTA after the technical payoff | — |
| CTA_END | CTA near the end | — |
