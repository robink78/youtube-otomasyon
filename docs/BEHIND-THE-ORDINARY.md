# The Hidden Logic of Things operations and setup

The Hidden Logic of Things (`behind-the-ordinary`, prefix `BTO`) is the fourth channel on the shared growth platform. It explains one documented reason, history, mechanism, or design decision behind one familiar object or system. It is not a generic-facts feed.

## What was added

- Channel config, brand, prompt, five editorial pillars, isolated state/analytics/memory/reports, OAuth names, staggered schedule, and quality thresholds live under `channels/behind-the-ordinary/`.
- The inventory contains **525 unique research questions**: 105 each in Everyday Mysteries, Hidden Engineering, Strange Origins, Design Decisions, and Ordinary Systems. Each is phrased as a neutral question (`Zippers: what explains locking sliders?`) and stores no answer.
- Question-only records have `productionReady:false`, which keeps them out of production discovery until they are researched.
- **Researched launch batch (7 records).**
  - Jeans watch pocket and jeans copper rivets: Levi Strauss & Co. archives.
  - QR code corner squares: DENSO WAVE.
  - Bluetooth logo: Bluetooth SIG.
  - Barcode guard bars: GS1, Wikipedia.
  - Cat's-eye road studs: National Motor Museum, MyLearning.
  - The shopping cart's folding-chair origin: Oklahoma Historical Society.
- **How each record is verified.** Every fact carries a verbatim quote that the builder found in the cited page. Seeds are in `channels/behind-the-ordinary/topics/research-seeds/`. Five of the seven pass the Short readiness gate today; the other two are held at REVIEW and are not uploaded.
- Shorts reuse the common candidate, hook, title, fatigue, experiment, rendering, analytics, prediction, and learning systems. Long-form reuses the common weekly lane and provider boundary.

## Research: how a question becomes a video

The biggest risk for this channel is repeating an internet myth, so a question enters production only through `scripts/ib-ct-library/build.js`. The builder checks, per record:

- **Verbatim quotes:** every fact carries a quote of at least 5 words that must appear in the cited page's text. Case, typography and whitespace are ignored; paraphrase is not accepted.
- **Numbers:** every number in a fact appears in its source, and every spoken or shown number traces to a fact.
- **Topic sources:** at least two, all on primary hosts (standards bodies, inventors and manufacturers, government, museums, universities), and all reachable.
- **Narration:**
  - 5–8 lines and 55–90 words;
  - an opening hook of at most 9 words, with hook plus second beat at most 18 words;
  - at least 10 hook candidates;
  - a thumbnail of at most 3 words;
  - the channel quality gate.

Two ways to add records:

1. **Hand research:** write a seed in `topics/research-seeds/` and run `node scripts/ib-ct-library/build.js <seed> --write`.
2. **Automated research:** `scripts/bto-research.js` runs daily through `.github/workflows/bto-research.yml`. It is dormant until `BTO_RESEARCH=1` and a provider key are set. Per question it:
   - reads the matching Wikipedia article(s) and skips those not named after the object or not mentioning the detail;
   - takes the article's own cited references on primary hosts that are still reachable as topic sources;
   - asks the configured provider (Groq) for a draft that may only use that text, with quoted facts and narration lines citing fact ids;
   - checks that each narration line shares content with its facts;
   - runs the same builder checks, with one repair round.

   Anything that fails stays in the backlog (`state/research-attempts.json`, retried after 60 days). Automated records carry `researchMethod`. Review them in the weekly `Shorts quality preview` before relying on them.

Until enough records are researched, the channel simply has nothing to publish on some days. The 30-day simulation reports these as research-gap days rather than inventing content.

## Schedule and safety defaults

- Short target: daily, production slot `10:30 Europe/Istanbul`, public slot `18:00 America/New_York`.
- Long target: every seven days, 8–15 minutes, quality over cadence.
- `BTO_PUBLISH` is unset/off by default. `BTO_LONGFORM_PUBLISH` is off and shared `longform.render.enabled` remains `false`.
- No validation command in this document uploads. A live write requires the publish flag, a healthy BTO OAuth identity, a PUBLISH quality decision, and the shared uploader's identity/idempotency guards.
- TikTok and Instagram are disabled for this channel; existing dormant TikTok behavior is unchanged.
- While the channel is not connected (`"onboarding": true` and no BTO credential or channel ID configured), the OAuth health check reports **NOT_CONFIGURED / setup pending** instead of a failure, so the portfolio health stays green. A partial configuration is checked normally.
- Music beds use the channel's own `everyday-curious` / `everyday-warm` moods, not the tense disaster beds of the other channels.

## Groq long-form writer

The shared provider boundary is `core/llm/longform-provider.js`. Configure:

```text
LONGFORM_LLM_PROVIDER=groq
GROQ_API_KEY=<secret>
GROQ_MODEL=openai/gpt-oss-120b
LONGFORM_LLM_MAX_ATTEMPTS=2
LONGFORM_LLM_MAX_RETRY_MS=30000
LONGFORM_LLM_FALLBACK_PROVIDER=
```

No fallback occurs unless `LONGFORM_LLM_FALLBACK_PROVIDER` explicitly names a configured provider. The existing Anthropic provider remains compatible when explicitly selected. API keys and raw error bodies are never stored in provider events.

The writer receives a fact pack and claim IDs, not a one-line topic. It checkpoints fact pack, narrative angle/blueprint, and every completed section under `channels/<slug>/state/longform/generation/`. A 429 uses bounded retry, then records `DEFERRED`; the weekly lane/Short scheduler can continue and the next run resumes the missing section. An explicitly configured fallback may be used after the primary fails.

The generation path is:

```text
topic → researched evidence → fact pack → narrative angle → outline
      → section plan → section generation → continuity/retention checks
      → factual consistency/claim map → final voiceover script
```

Quality checks cover unsupported claims/numbers, copied source wording, duplicate sections, repeated paragraphs, weak hook, excessive introduction, missing payoff, wrong channel identity, generic filler, source depth, truthful titles/thumbnails, and actual evidence-supported duration. Thin evidence is blocked rather than padded.

## Local no-upload validation

```bash
npm install
npm run topics:behind-the-ordinary
npm run library:behind-the-ordinary
npm run test:behind-the-ordinary
node growth.js dry-run --channel behind-the-ordinary
node growth.js longform --channel behind-the-ordinary --dry-run --force
node simulate-portfolio.js
npm test
```

`e2e-behind-the-ordinary.js` writes a package and explicitly reports `uploadAttempted:false`. Add `--render` only when local ffmpeg/Edge TTS and source-network access are available; it still does not upload.

## Create and connect the YouTube channel

These steps need the owner's Google account and cannot be done by the repository.

1. **Create the channel.**
   - In YouTube, create a new channel (Brand Account) named **The Hidden Logic of Things**.
   - Set its handle; `@HiddenLogicOfThings` is proposed if free.
   - Under audience, choose "not made for kids".
2. **Reuse the existing OAuth client.** The Failure Reconstructed Desktop client in the existing Google Cloud project works for any channel. Quota is shared per project: four daily uploads are about 6,600 of the 10,000 daily units, which the quota ledger accounts for.
   - Keep the app's Audience in mind: while it is **Testing**, refresh tokens expire after 7 days. Completing Branding and **Publish app** removes that limit for all channels.
3. **Authorize the new channel** from the repository folder. The client ID/secret are the same values as Failure Reconstructed's.

```bash
export BTO_YT_CLIENT_ID='same Desktop client id'
read -r -s -p 'BTO client secret: ' BTO_YT_CLIENT_SECRET; printf '\n'
export BTO_YT_CLIENT_SECRET
node youtube-yetki.js --channel behind-the-ordinary --oauth-mode=testing --new-channel --github --repo=eyazan/youtube-otomasyon
unset BTO_YT_CLIENT_ID BTO_YT_CLIENT_SECRET
```

   - On Google's screen pick **The Hidden Logic of Things**.
   - The helper verifies the authenticated channel and refuses (`CHANNEL_ALREADY_ASSIGNED`) if you pick a channel that already belongs to FR, IB or CT.
   - It then stores the BTO secrets and the `BTO_YT_CHANNEL_ID` variable without printing the token.
   - Use `--oauth-mode=testing` while the Google app is in Testing, so the health check warns before the 7-day expiry. Use `production` once the app is published.
4. **Check health:** `gh workflow run youtube-oauth-health.yml`. The BTO row must show the expected channel and "upload allowed".
5. **Preview without upload:** `gh workflow run quality-preview.yml -f bto_slug=why-jeans-have-copper-rivets`, then watch the rendered Short.
6. **Optional research automation:**
   - Create a free Groq key at console.groq.com.
   - `gh secret set GROQ_API_KEY`.
   - `gh variable set LONGFORM_LLM_PROVIDER --body groq`.
   - `gh variable set BTO_RESEARCH --body 1`.
7. **Go live:** `gh variable set BTO_PUBLISH --body 1`. Shorts are then produced at 10:30 Istanbul and scheduled for 18:00 New York.
8. **Keep long-form off for now** (`BTO_LONGFORM_PUBLISH` unset). Long-form needs deep evidence (8–15 minutes); the current Short-sized evidence packs are correctly blocked as `INSUFFICIENT_DEPTH`.

## Required names

| Type | Name |
|---|---|
| GitHub secret | `BTO_YT_CLIENT_ID` |
| GitHub secret | `BTO_YT_CLIENT_SECRET` |
| GitHub secret | `BTO_YT_REFRESH_TOKEN` |
| GitHub variable | `BTO_YT_CHANNEL_ID` |
| GitHub variable | `BTO_PUBLISH` |
| GitHub variable | `BTO_LONGFORM_PUBLISH` |
| GitHub secret | `GROQ_API_KEY` |
| GitHub variable | `LONGFORM_LLM_PROVIDER=groq` |
| GitHub variable | `GROQ_MODEL=openai/gpt-oss-120b` |
| GitHub variable | `BTO_RESEARCH=1` (optional daily research) |

## Current owner-action blockers

- **YouTube channel and authorization:** the channel itself and its authorization (steps 1–4 above).
- **Groq key:** needed for automated research and for long-form writing.
- **Research backlog:** 518 questions are not yet researched. Hand research or the daily research job turns them into publishable records; nothing is promoted without verified evidence.
- **Live long-form:** stays disabled until deep evidence packs and reviewed dry runs exist.
