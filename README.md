# Still Curious

## iPhone version

The native iPhone foundation is in [`ios/`](ios/README.md), including a SwiftUI listening library, native audio player and StoreKit subscription infrastructure. Paid episode creation and mobile sign-in are not connected yet, and the build has not been submitted to Apple. See the [paid App Store release plan](docs/app-store/release-plan.md) for enrollment, backend, privacy and device-validation requirements.

## Current source and entry points

This is the complete source repository for [Still Curious](https://still-curious-bedtime.workspace-066083.chatgpt.site/). It includes the web app, generation service, prompts, durable storage, tests, assets and earlier Python experiments.

| Location | Purpose |
| --- | --- |
| `app/` | Web pages and authenticated API routes |
| `lib/episode-v2/` | Current staged podcast generation pipeline |
| `lib/episode-v2/prompts/` | Producer, research, preparation, host, guest, editing and review instructions |
| `lib/episode-v2/coherent-personality.ts` | Seeded coherent guest characters |
| `lib/episode-v2/discussion-design.ts` | Evidence-backed positions and interaction review contracts |
| `lib/episode-v2/personality.ts` | Original 1.6 personality system and compatibility |
| `public/` | Browser assets and sample audio |
| `tests/` | Automated tests and authored offline provider fixtures |
| `drizzle/` | Database migrations |
| `scripts/` | Build, development and operational scripts |
| `docs/` | Design, editorial framework, implementation records and pilots |
| `src/` | Earlier Python experiments |

The current app supports the selected episode duration, three fictional specialists with independent preparation, a responsive host, saved progress and background scheduling, bounded editing/review, and optional ElevenLabs audio. New episodes use [discussion design 1.7](docs/episode-v2-personalities.md); existing jobs preserve their saved prompts. API keys are configured separately as runtime secrets and are not part of this repository.

Install dependencies with the pinned package manager in `package.json`. Run the TypeScript suite with `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` and type checking with `node node_modules/typescript/bin/tsc --noEmit`. Use `pnpm dev` for local development. Cloudflare D1/R2 bindings and runtime credentials are required for generation; see the deployment manifest and the operational documentation.

## Historical implementation notes

The sections below record earlier milestones; their five-minute and foreground-only descriptions refer to earlier versions.

A private bedtime-listening MVP with a free pre-recorded sample and a separate custom-episode flow.

## Listening

The five-minute Polynesian wayfinding sample plays directly in the app. It is an AI reading of a user-provided script excerpt; its claims have not been independently reviewed. Speed and a browser sleep timer are available.

Custom creation currently supports **five minutes**. A signed-in user enters a science question. The app saves a private job, creates an outline, gathers a cited source dossier, writes a four-speaker script, checks factual claims, generates contextual conversation sections with ElevenLabs Text to Dialogue, and assembles a playable MP3. Source links and a downloadable research dossier accompany the result. The speakers are fictional. Longer episodes and subscription credits are future work; the MVP does not maintain or deduct an app credit balance. Provider usage can still consume the owner's API allowances.

Generation advances through one bounded request at a time while the page is open. Returning to a saved job can continue it. Uncertain paid requests stop safely rather than being blindly repeated. It does not run as an unattended background queue.

## Hosted implementation

The existing owner-private Sites project now uses the Vinext Worker starter, D1 for owned jobs/artifacts, and R2 for audio clips and final MP3s. Routes include capabilities, episode creation/list/detail, one-step advance, owned research download, and audio streaming with Range support. Same-origin mutations and user ownership are enforced.

Runtime configuration names are OPENAI_API_KEY, ELEVENLABS_API_KEY, ELEVEN_VOICE_HOST, ELEVEN_VOICE_EXPERT1, ELEVEN_VOICE_EXPERT2, and ELEVEN_VOICE_EXPERT3. Optional ELEVEN_DIALOGUE_MODEL defaults to eleven_v4. Optional OPENAI_MODEL defaults to gpt-4.1-mini for outline/research/review; OPENAI_SCRIPT_MODEL defaults to gpt-4.1 for writing and the bounded repair. Provider keys belong in Sites secret environment variables. Local env files stay ignored. They must never appear in source, client assets, or the hosting manifest.

The production pipeline in lib/episode-service.ts makes one outline, one research, one script, and one review call, with at most one bounded script-repair call. Research uses a strict schema, stable source IDs, and URL matching that removes only tracking parameters. Factual turns must reference saved dossier claims. Writing uses ordinary dialogue text with variable turn lengths and 8–36 contributions: short interjections and sustained explanations are both allowed. The prompt encourages distinct specialist interests, supported storytelling, natural follow-ups, and restrained warmth without invented firsthand experiences. Older word-array drafts remain readable. The script target is approximately five minutes (550–700 words), with a 110–150-word host opening and final audio duration checked independently. Dialogue speech is limited to 5,000 characters, split at turn/word boundaries into sections of at most 1,800 characters. Voice IDs, model, script hash, request IDs, and completed sections are saved for resumption. Recent request IDs and adjacent text carry continuity between sections. A 4–6.5 minute final recording is required. These checks improve traceability; they do not prove every statement is accurate.

The Python modules under src/ retain a local experimental pipeline and ElevenLabs/FFmpeg tools. See docs/generation.md and docs/mvp_plan.md.

## Version 2 implementation

The revised [framework and editorial inputs](docs/editorial/README.md) and [implementation log](docs/implementation-v2.md) define the next pipeline. Tasks 01–14 are complete: the baseline, source inputs, [versioned contracts](docs/episode-v2-contracts.md), [provider adapter/accounting](docs/episode-v2-providers.md), [durable execution/recovery](docs/episode-v2-recovery.md), [editorial producer](docs/episode-v2-producer.md) and [research through independent preparation](docs/episode-v2-research-preparation.md). Task 10 adds the [speaking roles](docs/episode-v2-roles.md). Task 11 connects the [durable conversation](docs/episode-v2-conversation.md). Task 12 adds [proportionate editing and review](docs/episode-v2-post-production.md). Task 13 adds the [private app opt-in, controls and text exports](docs/episode-v2-private-app.md). V1 remains the default; the owner can explicitly select a five-minute V2 text pilot with a spending limit. An empty limit saves it paused without provider calls. Task 14 completed the [live firefly text pilot](docs/pilots/fireflies-01/assessment.md): 600 accepted words, $0.918715 estimated charges, no audio. Next is Task 15, connecting that accepted script to the existing four-voice audio system. The full original user brief has not been recovered as a verified verbatim source; framework v2.1 is the available editorial authority.

The homepage route imports `client/index.html`; its browser code and styles are in `public/app.js` and `public/styles.css`. The old proposal in `docs/proposed_pipeline.md` is superseded by framework v2.1.

## Verification

The Task 01 baseline was verified on **15 October 2026** at runtime revision `53c7ea4b905ddddfc8c07a440b0e4608993efec4`:

- `node --experimental-strip-types --test tests/server-pipeline.test.ts tests/dialogue.test.ts` — 27 passed.
- `"$CODEX_PRIMARY_RUNTIME_PYTHON" -m unittest discover -s tests` — 32 passed for the retained Python experiment.
- `node --check public/app.js` — passed.
- `node node_modules/typescript/bin/tsc --noEmit` — passed.
- `bash scripts/build-verified.sh` — passed.

Task 02 adds 11 contract checks. Run `node --experimental-strip-types --test tests/episode-v2-contracts.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` for the current **38-test TypeScript suite**. TypeScript checking and the Worker build also pass after the contract changes. The Python baseline above was unchanged and was not rerun for Task 02.

Task 03 adds 15 mocked provider/accounting checks. Run `node --experimental-strip-types --test tests/episode-v2-providers.test.ts tests/episode-v2-contracts.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` for the **53-test suite**. The TypeScript check and verified Worker build pass. Existing Python/browser code was unchanged and was not retested for this task.

See the [baseline record](docs/implementation-v2.md#baseline-checks) for scope and warnings. No paid provider calls were made during these checks. Earlier live verification covered fireworks text generation, four short voice samples and a 31-second dialogue preview; it was not repeated for Task 01. Full dialogue episode playback, browser rendering, phone background playback and timer behavior on a real device still need verification.

Task 04 adds 15 SQLite-backed recovery checks. Run `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` for the **68-test suite**. TypeScript checking and the verified Worker build pass. No live provider calls were made.

Task 05 adds nine producer checks, bringing that command to **77 passing tests**. It verifies exact editorial inputs, two linked artifacts saved atomically, five-minute adaptation and restart reuse with authored fixtures/mocked transport. TypeScript and the Worker build pass; live commissioning quality remains for the measured pilot.

Tasks 06–09 bring the same full TypeScript command to **112 passing tests**, including a connected producer-to-host-plan fixture, bounded research, frozen evidence, stable casting and independent preparation with restart recovery. TypeScript checking and the verified Worker build pass. All provider calls in these checks are mocked.

Task 10 adds ten speaking-role checks, bringing the same full TypeScript command to **122 passing tests**. Host/guest/bid requests preserve exact accepted speech and preparation boundaries; TypeScript checking and the Worker build pass. Conversation scheduling is next in Task 11. No live provider calls were made.

Task 11 adds eight offline conversation checks, bringing the same full TypeScript command to **130 passing tests**. The durable loop preserves accepted speech, speaker routing, response opportunities, bids and remaining limits across restart. TypeScript and the Worker build pass; no live provider calls were made.

Task 12 adds fourteen post-production checks, bringing the same full TypeScript command to **144 passing tests**. Light edits, bounded repairs and whole-episode review now produce an exact approved script at the text checkpoint. TypeScript and the Worker build pass. All provider behavior was mocked.

Task 13 adds fifteen route/UI checks, bringing the same full TypeScript command to **159 passing tests**. The real API flow reaches the text checkpoint with mocked providers; ownership, budget controls, recovery, exports and legacy audio pass. TypeScript, browser-script syntax and the verified Worker build pass. No paid provider calls were made.

Task 14 reaches the accepted text checkpoint in a real $5-capped live run. **165 tests** pass after fixes for ignored tool-attempt counting and local SQLite refresh recovery. The [transcript and measured report](docs/pilots/README.md) retain all usage/recovery limits; audio is next.

Task 15 adds the [V2 audio connection](docs/episode-v2-audio.md): exact approved-text/voice/model pins, an explicitly budgeted four-voice audition, clip reuse after acceptance, durable reservations and safe recovery, selected-duration MP3 assembly, private seekable playback and app controls. The accepted [pharmaceutical continuation](docs/pilots/pharma-process-audio-01/README.md) is preflighted without changing its research or dialogue. Live audio remains disabled: the configured ElevenLabs key lacks account-metadata read permission. No paid audio request was made; actual audition/listening acceptance is still required before Task 15 is complete.
