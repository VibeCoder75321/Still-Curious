# Still Curious version 2 implementation log

## Current status

**Tasks 01–14 are complete. Next: Task 15 — Connect the accepted script to dialogue audio.**

The revised framework and task pack are preserved in [docs/editorial](editorial/README.md). Task 01 established the baseline below. Tasks 02–04 add contracts, providers/accounting and durable recovery. Task 05 adds the [editorial producer](episode-v2-producer.md). Tasks 06–09 add [research, frozen evidence, casting and independent preparation](episode-v2-research-preparation.md). Task 10 adds the [speaking roles](episode-v2-roles.md), and Task 11 connects the [durable conversation](episode-v2-conversation.md). Task 12 adds [proportionate editing and review](episode-v2-post-production.md). Task 13 adds an owner-controlled [private app text pilot](episode-v2-private-app.md). V1 remains the default; explicitly selected V2 jobs stop at the accepted-text checkpoint at `ready_for_audio.wait`. Task 14 adds the [accepted live firefly text pilot](pilots/fireflies-01/assessment.md), ready for an audio trial.

## Baseline reference

- Recorded: 15 October 2026, America/New_York.
- Branch: `main`.
- Starting revision: `53c7ea4b905ddddfc8c07a440b0e4608993efec4`.
- Starting working tree: clean, including after the baseline build.
- Checkout at verification: `/workspace/scratch/8f99195eb4c5/sleep-podcast`.
- Site project: `appgprj_6acfcc84fe10819185eb6bb1b5266d63`.
- Existing site: <https://still-curious-bedtime.workspace-066083.chatgpt.site>.
- Node used for checks: `v24.19.0`.
- No `AGENTS.md` was found in the conversation workspace. No dependencies were added or changed.

The starting revision identifies the runtime code tested here. Later source synchronization can create a documentation commit after this revision without changing that runtime baseline.

## Production route

| Step | File and current behavior |
| --- | --- |
| Homepage | `app/route.ts` imports `client/index.html` and returns the HTML. That page loads `/app.js` and `/styles.css` from `public/`. Future UI work must inspect `client/index.html`; `public/index.html` is not the imported homepage source. |
| Browser orchestration | `public/app.js` creates a job, reads its saved state, and posts one advance request at a time while the page is visible. On interruption it rereads the job before offering resume. This is not an unattended queue. |
| Creation and listing | `app/api/episodes/route.ts` requires sign-in, checks same-origin mutations, accepts five-minute jobs, and writes an `outline` job to D1. It permits one active job per user. |
| Ownership and serialization | `app/api/_episodes.ts` reads only the authenticated user's jobs and prepares their public view. The current public view includes most saved artifact state; limiting it is future Task 13 work. |
| Advance and persistence | `app/api/episodes/[id]/advance/route.ts` acquires a D1 lock, calls `advanceJob`, and saves the result conditionally against that lock. An expired interrupted lock stops the job because paid work may have completed. |
| Generation | `lib/episode-service.ts` implements `advanceJob`: `outline → research → script → optional script_repair → review → tts → assembling → ready`, with failure handling. At most one paid provider request is initiated by each advance invocation. |
| Research and text | The current pipeline uses one hosted search, exactly three sources, a single full-script writer and a factual review. Factual turns require dossier claim IDs. A maximum of ten OpenAI calls is enforced. Model defaults are code configuration, not availability verified by this task. |
| Dialogue audio | `lib/dialogue.ts` creates speech-preserving chunks from `id`, `speaker` and `text`. `lib/episode-service.ts` pins the script hash, voices, model and chunk plan; saves completed clips and provider request IDs; and preserves the older per-turn audio path for existing jobs. |
| Assembly and storage | `lib/mp3.ts` validates and concatenates MP3 data. The service reads saved R2 clips, checks ordering/integrity, requires 240–390 seconds, writes the final R2 object and marks the D1 job ready. |
| Listening and research | `app/api/episodes/[id]/audio/route.ts` checks ownership and ready status, then supports ranged R2 playback. `[id]/research/route.ts` exports the owned saved dossier. |

`db/schema.ts` defines the D1 episode row, JSON state, lock fields and unique active-user index. `.openai/hosting.json` binds `DB` and `BUCKET`. Provider secrets remain server configuration; no secret values were read or recorded for Task 01.

`src/episode_pipeline.py`, `src/episode_prompts.py` and the other Python modules retain the older local experiment. The production TypeScript routes do not invoke that pipeline. Its tests provide historical regression coverage, not proof of the hosted route behavior.

## Baseline checks

Run the following from the repository root. All checks below completed successfully on 15 October 2026 before the documentation changes. No paid provider calls were made; provider behavior in the test suites is mocked.

| Command | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/server-pipeline.test.ts tests/dialogue.test.ts` | **27 passed**, zero failed, skipped or cancelled. Includes pipeline schemas, source grounding, bounded repair, audio continuity/resume and ambiguous failure behavior. |
| `node --check public/app.js` | **Passed**, exit 0. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**, exit 0. |
| `bash scripts/build-verified.sh` | **Passed**, exit 0. Vinext/Vite completed all five build phases and emitted the homepage and six API route patterns. The helper enforces a three-minute build timeout. |
| `"$CODEX_PRIMARY_RUNTIME_PYTHON" -m unittest discover -s tests` | **32 passed**, zero failures. This is the retained Python experiment suite. |

The build emitted a warning that proxy environment variables were detected. No baseline failures were observed. The README's earlier count of 26 Worker tests was stale; the combined TypeScript baseline is 27.

These checks do not establish live provider availability, dialogue quality, full-episode playback, browser rendering, phone background playback or real-device timer behavior. Those remain pilot/release checks in Tasks 14–16. No deployment or new generation was necessary to establish this documentation baseline.

## Task 01 changes and decisions

- Preserved the exact framework v2.1 DOCX and supplied task-pack DOCX under `docs/editorial/`, with checksums and provenance in `sources.json`.
- Extracted all 170 framework paragraphs and both tables into `framework-v2.1.md`. Verified the binary framework copy matches its source and every nonempty paragraph appears in the extraction.
- Added the editorial authority order, latest user corrections and explicit missing-original-brief status in `docs/editorial/README.md`.
- Marked `docs/proposed_pipeline.md` as superseded. Its older per-turn audit requirements, opening guidance and cost assumptions are not version 2 requirements.
- Recorded the real homepage source, `client/index.html`, as a correction to the task pack's abbreviated UI file map. Apply this finding during Task 13.
- Updated the root README to link these inputs and replace its stale verification count with the dated, reproducible baseline.

### Remaining input gap

The full original user programme brief was not found as a verified verbatim file in the relevant current workspace and repository material. Do not invent it. Preserve it separately with provenance when it becomes available. This does not block Task 02; framework v2.1 supplies the available requirements.

## Task checklist

- [x] 01 Establish the baseline and editorial inputs
- [x] 02 Define the versioned pipeline contracts
- [x] 03 Separate provider calls and measure usage
- [x] 04 Make each step durable and recoverable
- [x] 05 Build the editorial producer
- [x] 06 Discover sources and record what was read
- [x] 07 Synthesize and freeze the evidence pack
- [x] 08 Cast three distinct fictional specialists
- [x] 09 Prepare each guest and then the host
- [x] 10 Implement the speaking roles
- [x] 11 Orchestrate the conversation turn by turn
- [x] 12 Edit and review the episode proportionately
- [x] 13 Expose the new pipeline in the private app
- [x] 14 Run one measured text pilot
- [ ] 15 Connect the accepted script to dialogue audio
- [ ] 16 Release the pilot with a tested rollback

## Next assignment

Implement **Task 15 — Connect the accepted script to dialogue audio** from the preserved task pack. Task 14's accepted local pilot is saved in `docs/pilots/fireflies-01/`; its final script has 600 words, 3,917 characters and nine turns. Read the explicit `state.finalScript` and its exact edit/review through the artifact reader, and call `assertFinalScriptApproved(final, review, edit)` before adapting speech. Do not select a final script heuristically.

Adapt the exact accepted `id`, `speaker` and `text` turns to the shared audio contract without inventing V1 factual labels or claim IDs. Pin the final hash, stable four-voice mapping, dialogue model and chunk plan. Reuse continuity, saved clips, MP3 validation and assembly. Verify current provider capabilities before changing settings, retain the configured character cap, and invalidate affected audio explicitly after text changes.

Run meaningful mocked resume/mismatch tests, including uncertain voice results that cannot trigger automatic resynthesis. Prepare a short audition containing all four voices and a section boundary. The Task 14 $5 approval was text-only: establish an applicable explicit audio allowance before a live audition or full synthesis. Preserve existing authorized credential reuse. Save and cost the audition separately, then synthesize the saved five-minute script only after the audition is acceptable and within the agreed allowance.

Complete Task 15 when accepted text and audio match, all intended speakers and transitions are intelligible, no dialogue is missing or duplicated, and measured duration is acceptable. Broader deployed/device checks and rollback remain Task 16.

## Task 15 implementation and verification — 16 October 2026

Implemented the dedicated V2 audio runner, typed audio contracts and separate ElevenLabs reservations, exact final-script/edit/review validation, pinned four-voice/model/price/chunk plan, explicit audio authorization and audition acceptance, saved-clip reuse, safe receipt/history GET recovery, mismatch/uncertain-outcome holds, explicit invalidation, selected-duration assembly and private range playback. Existing text agents, research and approved dialogue remain unchanged. See [audio details](episode-v2-audio.md).

The latest user-accepted pharmaceutical script, rather than the older firefly script named in the original handoff, is the current audio candidate. Its exact 13,724 characters split into ten sections; the first three contain all four voices. [Preflight](pilots/pharma-process-audio-01/preflight.json) records the unchanged speech hash, section coverage and budget arithmetic. Proposed audio allowance $1.49 would keep combined conservative text-plus-authorized-audio at $4.990258125 under the original $5 cap. It has not been activated.

Live acceptance is blocked: the configured ElevenLabs key returned HTTP 401 `missing_permissions` for the account subscription metadata check. Provider access stopped; no paid audio requests, new research or text generation occurred. Production audio enablement and verified account/voice pricing remain unset. Task 15 is not complete until a real four-voice audition is heard/accepted and final text/audio correspondence and duration are verified. Task 16 follows that acceptance, not merely passing offline checks.

## Task 02 implementation and verification

Completed on 15 October 2026, starting from `f86c3074b98700831744c73a380c941c56af1cca` with a clean working tree.

- Added `lib/episode-v2/contracts.ts`: strict runtime schemas with inferred TypeScript types for the eleven artifact kinds, stable references/provenance, spoken turns, evidence links, cast/preparation, holistic review and final script approval.
- Added `lib/episode-v2/config.ts`: a versioned five-minute profile, 20–30-second opening target, soft whole-episode word range, existing audio allowance/duration window, configurable count limits and an unset spending ceiling. No per-turn word quota is defined.
- Defined phase/substep and job-status transitions. Pauses/failures retain their step. Audio stages require an explicit accepted script/review version; `ready` additionally requires an audio key. Durable attempt state, usage enforcement and locking remain Task 04 work.
- Replaced unchecked stored-job casts in `app/api/_episodes.ts` and `app/api/episodes/route.ts` with version-aware decoding. Unversioned and explicit v1 jobs preserve legacy artifact layouts. Unknown/mixed versions fail with a generic error rather than silently decoding as v1.
- Added `tests/episode-v2-contracts.test.ts` and the [contract guide](episode-v2-contracts.md). No dependencies or credentials were changed; no paid provider calls were made.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-contracts.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **38 passed**: 11 contract checks plus all 27 retained Worker/dialogue checks. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed** after resolving the union's legacy source field and retaining fixture types in the generic test helper. |
| `bash scripts/build-verified.sh` | **Passed** across all five phases. The existing proxy-environment warning remains. |
| `git diff --check` | **Passed**. |

The checks cover invalid stage/substep transitions, local approval/version requirements, source passage resolution, flexible speech without citations, configuration bounds and old job round-trips. They do not claim that the v2 production runner or provider accounting exists yet. New v2 job creation remains deferred to Task 13.

## Task 03 implementation and verification

Completed on 15 October 2026, starting from `cedc2c2f49baa1e8c36ce33baa1639adb4a51756` with a clean working tree.

- Added `model-policy.ts` with a verified, dated Sol/Luna capability and price catalog, role-specific candidate settings, explicit Standard/default processing and saved price snapshots. Published capabilities were checked against the official pages linked in the [provider guide](episode-v2-providers.md); account access was not tested.
- Added `providers.ts` with injected fetch/clock functions, strict structured results, bounded web research and observed exact-source opening. It records actual response/model metadata and never automatically retries or repairs a failed output.
- Added `usage.ts` with serializable records, separate research/text/review/audio allocations, pre-call reservations, observed usage, estimates, conservative held allowances and explicit unknown costs. Missing reports are not converted into zero usage. Reasoning is not double-counted as extra output.
- Extended v2 state with optional saved policy/ledger. Ledger limits must match episode configuration. The adapter requires persistence before submission and after completion; D1 locks, attempt identities and reconciliation are Task 04 integration work.
- Added 15 mocked checks in `tests/episode-v2-providers.test.ts`. The existing v1 provider and voice path remain operational. No credentials or dependencies changed and no live generation/provider calls were made.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-providers.test.ts tests/episode-v2-contracts.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **53 passed**, including all 38 prior TypeScript checks. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five build phases; existing proxy warning only. |
| `git diff --check` | **Passed**. |

The policy remains a pilot choice. Actual provider latency, speaker quality and costs will be measured in Task 14. Hosted-tool reservations deliberately need more headroom than expected cost; no new dollar ceiling was invented. The default five-minute config still has no live-spending ceiling.

## Task 04 implementation and verification

Completed on 15 October 2026, starting from `5eefb0d70826950c1b9fdced133a6a0cdac83c86`. The task started with a clean working tree; work continued across a conversation interruption without discarding its existing changes.

- Added `persistence.ts` with owner-scoped D1 leases, execution revisions, exact-snapshot conditional writes and immutable artifact storage. Existing schema/unique active-job index suffice; no migration or new dependency was needed.
- Extended v2 contracts with private artifact references and durable attempt states. Completed attempts must resolve their exact output versions and settled usage record. Large source/evidence artifacts use private, size-bounded, content-addressed R2 objects with integrity checks.
- Extended the provider adapter with background submission and exact saved-ID retrieval. Polls reuse the original reservation/settings and never POST a replacement. Both submission and retrieval use a local transport timeout of at most 15 seconds in the runner.
- Added `runner.ts` with stable plan/input hashes, prompt/model policy pinning, pre-submission attempt/reservation persistence, and atomic output/provenance/usage/next-step acceptance. Each advance initiates at most one new paid operation. Each guest preparation and contribution request has its own substep/key.
- Added a separate v2 branch in the advance endpoint and a limited v2 public view. Existing v1 creation/generation remains on its previous path. The v2 stage registry is empty until later tasks register handlers; it pauses without spending. Explicit resume/UI/export controls remain Task 13 work.
- Checked official background/retrieval and Worker limit documentation, linked in the [recovery guide](episode-v2-recovery.md). No real model-latency benchmark was run. Client disconnection and uncertain provider completion motivate short submit/poll operations rather than a long synchronous request or `waitUntil` loop.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **68 passed**: 15 new recovery checks plus all 53 prior TypeScript checks. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five build phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

The new suite runs the repository's actual SQL against in-memory SQLite and uses mocked providers/private storage. It verifies duplicate advances, interruption before an ID is saved, ID-based restart/polling, stale leases and exact snapshots, changed prompt/input versions, lost save acknowledgements, failed reservation persistence, private ownership/hash/size checks and separate guest/bid advances. At most one output is accepted and uncertain work is never automatically resubmitted.

The D1/provider boundary cannot be a single transaction. An interrupted submission with no durable response ID still needs attention; lease expiry cannot make it safe to repeat. A failed R2/D1 acceptance can leave an unreferenced private object, but cannot adopt a stale artifact. No live provider calls, credential changes, paid generation or browser verification occurred for Task 04. The default spending ceiling remains unset.

## Task 05 implementation and verification

Completed on 15 October 2026, starting from `5f5f2760a9519ee19df0578d3d51c1f7f7e48385` with a clean working tree.

- Added a versioned producer prompt, strict result schema and exact framework excerpts with a source hash/drift check. The prompt focuses broad topics, preserves narrow intent and commissions evidence rather than deciding the scientific conclusion first.
- Added optional private `state.programmeBrief` for a complete supplied original, with version/hash/byte validation before submission. The real original remains unavailable; requests explicitly record that gap and never label framework guidance as the original.
- Extended the brief with interpretation notes, editorial-input metadata and a saved five-minute duration adaptation; extended commissions with the verbatim request, duration and evidence-sufficiency criterion. These additive fields preserve older v2 artifacts, while the new handler always writes them.
- Added `stages/producer.ts` and the stage registry. One saved producer attempt creates the linked brief/commission pair, stamps actual usage/model provenance and transitions to `research.discover` atomically. The server supplies original wording and timing; model attempts to override those fields fail validation.
- Added three authored editorial examples and nine mocked integration checks, including full-brief preservation and background restart/cache reuse. The examples are reviewable fixture outputs, not live research or proof of generated semantic quality. No dependencies, provider credentials, live allowance, v1 creation or audio behavior changed.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **77 passed**: nine new producer checks plus all 68 prior TypeScript checks. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

The first local check caught a Zod refinement/length-chain error; it was corrected before all checks passed. The final checks cover one atomic artifact pair, correct input/reference/provenance mapping, selected introduction timing, invalid/override output handling and no regeneration after completion. No paid provider call or browser verification was performed. Live editorial performance remains a Task 14 pilot question. The [producer guide](episode-v2-producer.md) records behavior, fixture choices and limitations.

## Tasks 06–09 implementation and verification

Completed on 15 October 2026, starting from `9d40533138d0fc4e79707819ce667560d8444d18`. Four delegated implementations were integrated in dependency order. Work resumed from saved changes after credit interruptions; completed stages were not regenerated.

| Task | Implemented behavior |
| --- | --- |
| 06 — Source discovery and reading | Separate durable search/read handlers, immutable source snapshots and bounded coverage decisions. Records retain passages/locators, access status, publication notices and source-family relationships. Inaccessible papers remain inaccessible; notices survive subsequent reads and rediscovery. |
| 07 — Evidence synthesis and freeze | Read-grounded findings, explicit observation/inference/interpretation, qualified stories, common briefing and linked specialist extracts. Exact source version/hash freezes the foundation. Insufficient evidence saves a scope decision and pauses; a supported narrower question can proceed. |
| 08 — Casting | Three distinct fictional specialists with server-assigned stable audio IDs, overlapping expertise, methods, intellectual tendencies and evidence-grounded perspectives. No prescribed disagreement, fixed speaking jobs or embedded voice mapping. |
| 09 — Independent preparation | Three separate saved guest operations with only their own profile and shared evidence, followed by host preparation using all three notes. Exact cast/evidence/editorial/prompt provenance is checked before reuse. The host saves a flexible question pool, not guest answers. |

Shared additions include optional compatible research/foundation/profile contract fields, source-relationship validation, artifact helpers and explicit preflight pauses. A source request may opt in to recording an observed failed exact-page open; that does not authorize read passages. The stage registry now includes all handlers through `preparation.host`. New v2 job creation, speaking, conversation orchestration and audio connection remain later tasks.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **112 passed**, zero failed, skipped or cancelled. Includes all 77 prior checks, 11 research, eight evidence, six casting, eight preparation, one provider access-boundary and one full-pipeline integration check. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five build phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

The connected fixture runs the actual stage registry and production SQL through twelve mocked provider operations, from producer to host plan. It saves four discovered sources, including a correction and an inaccessible paper, and verifies exact provenance throughout. Separate restart checks prove that pending research/casting/preparation calls use GET for their saved response and that resuming after two guest notes calls only the remaining guest and host. Input drift and invalid references pause without automatic regeneration.

No live provider calls, paid episode generation, credential changes, dependency changes or browser checks were performed. The original v1 creation and audio path remain unchanged. The tests use authored material rather than scientific evidence and do not establish live editorial quality or quotation accuracy; those remain Task 14 pilot questions. See the [research/preparation guide](episode-v2-research-preparation.md) for behavior and limits.

## Task 10 implementation and verification

Completed on 15 October 2026, starting from `a303c78310c9e8e9f607a7149c15b137e6aa9d3e` with a clean working tree.

- Added `roles/host.ts`, `guest.ts` and `contribution-request.ts`, with strict runtime/output schemas and versioned prompts. Plans expose the server-owned speaker, exact input references and prompt/editorial versions for Task 11's durable runner integration.
- Added a saved-context reader that checks the frozen evidence, exact cast and preparation versions, original editorial metadata, host plan and accepted transcript. It reuses Task 09's editorial and preparation validation rather than introducing different evidence rules for speech.
- Host actions contain optional own speech and explicit routing/show-state fields. A silent yield is valid. Guest output contains only own speech and an optional stance update. Contribution requests pass or offer one point of at most 360 characters; they never grant a turn or prewrite a complete unused answer.
- Guests and bidders receive only their own profile/private note, saved common/relevant evidence and the complete accepted transcript. The host receives all three notes and its flexible plan. The reader selects the latest saved transcript and preserves prior speech exactly; no request builder or parser appends or rewrites turns.
- The speaking prompts allow varied contribution lengths, qualified recollection and reasonable unresolved disagreement. No live research, mandatory per-turn citations/factual labels, guest-to-guest questions, fixed speaking roles or compulsory disagreement were added.
- Left `conversation.host` unregistered until Task 11 supplies scheduling, exact-once acceptance and bounded conversation state. V1 creation, UI and audio remain on their existing path. No dependencies, credentials or spending authorization changed.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **122 passed**, zero failed, skipped or cancelled: ten new role checks plus all 112 prior checks. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five build phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

The role suite checks strict ownership shapes, routing consistency, silent yields, short/sustained guest contributions, bounded bids, initial-host behavior, exact preceding speech and later corrections, private-note separation, stale input rejection and three mocked provider calls with zero research tools. It does not prove the semantic content or naturalness of arbitrary generated speech; the prompts and later whole-episode review address that boundary, and live quality remains a Task 14 pilot question.

No live provider calls, paid generation, browser checks or credential changes were performed. The [speaking-role guide](episode-v2-roles.md) documents the builder API and Task 11 integration boundary.

## Task 11 implementation and verification

Completed on 15 October 2026, starting from `a8c2e9c190ada9de5767cf382566e660a9412b37` with a clean working tree.

- Added `conversation-state.ts` with pure cloned-state reducers for accepted host actions, invited guest speech and short listening requests. New turn IDs and speaker identities are assigned in code. Earlier speech remains exact; silent host decisions and bids create no audio turns.
- Added `conversation.ts` and registered all seven conversation substeps. Each advance submits or retrieves one role operation using the existing durable attempt, reservation, lease and atomic acceptance path. Keys follow the saved operation number, and preflight reconstruction keeps pending request hashes stable.
- Extended transcript contracts with optional saved floor state: invitations, queued response opportunities, request/refresh state, rough duration and remaining limits. Host/guest prompt versions now support explicit request collection, bid decisions, response opportunities and concise usefulness feedback. Older contract fixtures still decode; a nonempty transcript without scheduler state is held for explicit review rather than silently migrated.
- Implemented optional bounded bid rounds, saved passes, accept/park/decline decisions, refresh-before-use and an editorial note on whether a used request improved the exchange. An addressed guest retains a reply opportunity through clarification, with further opportunities queued. No forced disagreement, equal rotation or live research was added.
- Added episode-wide duration/turn guidance and conservative provider/text headroom for a return to the host. Exhaustion prompts closure or pauses with the exact transcript and next speaker. Invalid control output never partially appends or starts automatic regeneration.
- Store every production transcript snapshot in private object storage with an owned hash/index, avoiding cumulative full-transcript copies in the bounded job JSON. The existing artifact reader verifies each snapshot. Offline small fixtures can remain inline.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **130 passed**, zero failed, skipped or cancelled: eight new conversation checks plus all 122 prior checks. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

The principal twelve-operation offline scenario runs a challenge, silent yield, reply, tangent and return, bids including a pass, accepted contribution, usefulness feedback and closure to `editing.edit`. It checks every saved prefix and provider/step count. Separate checks cover SQLite restart and GET-only recovery, private snapshot reads, clarification queues, parked-bid refresh, round caps, required closure and zero-call budget pauses. No paid provider calls, browser checks, new dependencies or credential changes were made. Live conversational quality and measured cost remain Task 14 questions.

See the [conversation guide](episode-v2-conversation.md) for state, storage, limits and recovery behavior.

## Task 12 implementation and verification

Completed on 15 October 2026, starting from `43e3eb299ebf9f718adf13aa14fcd7ec3faa5cd9` with a clean working tree.

- Added `stages/editing.ts` and a versioned light-edit prompt. The editor returns exact substring patches against the closed accepted transcript, preserving every unaffected byte, speaker and surviving turn ID. Code rejects unknown/ambiguous targets, invented turns and deletion of the entire episode.
- Added `stages/review.ts` and a whole-episode review prompt using the existing three outcomes. Harmless imprecision can proceed; consequential overstatements and unsupported stories receive concrete bounded corrections or a hold. No numerical accuracy target, per-turn audit or whole-dialogue regeneration was added.
- Added `stages/local-repair.ts` for affected-passage and affected-section repair. The latter permits immediate neighbouring turns for coherence. Reports link to the prior edit and exact review, with resolved issue IDs and a nearby-coherence check. A separate recheck must accept the revised episode; a remaining material issue is held without another automatic rewrite.
- Added `stages/review-lookup.ts` for one focused consequential source question after the conversation. The optional `maxPostConversationSourceReads` defaults to one; overall source/spending caps still apply. New `review_evidence` artifacts preserve observed source access separately from the frozen foundation. Inaccessible sources supply no read passages.
- Extended compatible contracts with repair/edit links, optional lookup requests, the supplementary evidence kind and lookup substep. Added the optional specific-edit argument to `assertFinalScriptApproved` to verify exact final turns. Earlier saved-v2 contract fixtures still decode.
- An acceptable review atomically saves its exact final script and explicit `state.finalScript`, then pauses at `ready_for_audio.wait` with `text_checkpoint`. V1 creation/UI/audio remain on their existing path; no audio request is made. All editing/review handlers are registered.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **144 passed**, zero failed, skipped or cancelled: fourteen new post-production checks plus all 130 prior checks. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

The authored fixtures cover an acceptable episode with minor imprecision, an exact local overstatement correction and an invented firsthand anecdote corrected within its section. Tests also cover GET-only repair recovery, private closed-transcript reads, rejected out-of-scope edits, held material issues, configured pass limits, read/inaccessible consequential lookup evidence and rejection of altered final speech or references. The original conversation and frozen evidence remain immutable. The successful lookup reaches repair and the separate recheck with explicit supplementary provenance.

No live provider calls, paid episode generation, browser checks, dependency additions or credential changes were made. Tests establish traceability and approval behavior, not the quality or scientific accuracy of live editorial judgments; those remain measured-pilot questions. The [post-production guide](episode-v2-post-production.md) records the behavior and Task 13 integration boundary.


## Task 13 implementation and verification

Completed on 15 October 2026, starting from `f8e56943c68f1f15237b4759537ab9b867411350`.

- Added an explicit V2 text-pilot creation path and capability flag, leaving V1 as the default. The UI requires deliberate opt-in. An empty spending limit saves a budget-paused job with zero provider calls. A positive, explicit dollar ceiling authorizes text work within saved research/text/review allocations; audio receives zero allocation.
- Added leased, owner-scoped pause, resume, cancel and budget controls. Known saved provider responses resume through retrieval. Unknown results retain their reservation and cannot be blindly restarted or made safe by a budget increase. Pause/cancel preserve saved work; cancellation and accepted text checkpoints release the active-user slot.
- Limited list/detail/advance/control views to display progress, safe pause reasons, action availability and owned download links. Private preparation, artifact storage indexes, usage ledgers, attempts and provider request details remain server-side. JSON and owned downloads use private no-store caching. Invalid/future-version records fail safely.
- Added owned transcript and research downloads. The transcript separates accepted speech, edits, review and the exact approved final script, verifying the final edit/review linkage. Research exports saved sources, frozen evidence and supplementary post-conversation evidence without private preparation or accounting.
- Added text progress/checkpoint UI, explicit spending controls and saved-job reopening without automatic advancement. Processing occurs only while the page is active. Existing free samples, V1 audio playback, speed and timers remain available.
- Enabled `V2_TEXT_PILOT_ENABLED=true` in the owner-private Site runtime configuration (revision 6); provider credentials were unchanged. This flag controls new V2 creation, not retrieval or recovery of already owned jobs. No dependencies were added.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **159 passed**, zero failed, skipped or cancelled; nine real-route integration checks and six browser-script behavior checks added. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `node --check public/app.js` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

The real-route tests use SQLite-backed D1, private in-memory object storage and mocked providers to reach the text checkpoint, then list/refetch/export it. They also check same-origin/authentication/ownership boundaries, explicit and missing budgets, manual controls, known-ID recovery, unknown-result holds, safe invalid-version handling and legacy ranged audio. Browser-script tests execute the actual app script against a controlled DOM/fetch/timer harness. These establish behavior, not rendered layout or real-device playback.

No live provider calls or paid generation were made. Browser layout, production interaction and live editorial quality were not tested. The next task is one agreed five-minute text pilot with an applicable explicit ceiling, full stage/usage reporting and qualitative transcript assessment; audio remains Task 15.


## Task 14 preparation — awaiting live-run authorization

Prepared on 15 October 2026 from `16375d7cabc3d70c016eb09020476d1edda510ce`. Task 14 remains incomplete.

- Inspected the owner-private Site, configured credential presence and all three existing production job summaries. There are no saved V2 jobs or applicable V2 dollar ceilings. Existing credential reuse is authorized; no credential values were exposed or changed.
- Prepared `scripts/run-text-pilot.ts`, using the production runner/stages/accounting and durable local SQLite/object storage. Default invocation is preflight-only. Live invocation requires explicit topic, ceiling, output directory and the existing key. Saved inputs cannot silently change on restart; safe known-response recovery uses the existing controls.
- Added `pilot-report.ts` to retain observed counts, missing observations, held allowances, estimate gaps, stage timing and recovery state. Billed charges remain unknown; reasoning tokens are not added to output totals.
- Proposed the earlier firefly question and a $5 maximum for confirmation. This proposal is not authorization. The saved preflight has a null authorized ceiling and records zero provider calls.
- Verification: 162 TypeScript tests pass, including three new checks for partial usage, preflight with a credential present, and rejection of live execution without a ceiling. TypeScript checking and the verified Worker build pass. No live provider calls, paid generation or audio were run.

See [pilot instructions](pilots/README.md) for the exact command, preserved artifacts, qualitative review checklist and the remaining authorization.


## Task 14 live pilot — completed

Completed on 15 October 2026, starting from `358e1c88da9fbe1a21b16da578ba6189f3ca9efc`. The user explicitly approved **How do fireflies make light?**, a five-minute text pilot, **$5 maximum and no audio**, at 18:10 America/New_York. Existing provider access was reused without printing or changing credentials.

The real production text modules ran through the durable local runner, saved the full research/preparation/conversation/edit/review artifacts and reached `ready_for_audio.wait` with `text_checkpoint`. The accepted final has **600 words**, **3,917 characters**, nine turns and a 59-word opening (about 26 seconds at 135 words/minute). The whole-episode review was **acceptable** with no material issues or factual repair. Light editing reduced the 718-word accepted conversation, preserving all turn identities and speakers. Audio duration is still unmeasured.

There were **28 logical generation operations and 28 submissions**, plus **451 runner retrievals and three diagnostic retrievals**. Observed input/output totals were **361,099 / 57,854 tokens**, with **33,625 reasoning tokens included in output**. Tools performed two discovery searches and eight source readings. Estimated charges under the saved price snapshots were **$0.918714875**; the conservative allowance used was **$1.017925625**, within the $5 cap. Actual billed charges remain unknown. All generation records completed with required usage, although two HTTP journal entries lack their completion observation.

Elapsed time was **25 minutes 39 seconds**, including diagnosis and operator recovery. The run exposed two issues: an empty ignored over-limit web action was counted as a completed read, and an open local SQLite connection became read-only across workspace file replacement. A narrow, tested parser rule records inferred ignored attempts separately; complete extra actions or uncertain shapes still hold. The local adapter now reconnects per statement. Explicit known-response retrieval recovered both completed outputs, preserving operation identities, reservations and the original spending limit. No generation submission was duplicated. The [recovery record](pilots/fireflies-01/recovery-notes.md) preserves the observed details and original snapshots.

| Verification | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | **165 passed**, zero failed, skipped or cancelled. |
| `node node_modules/typescript/bin/tsc --noEmit` | **Passed**. |
| `bash scripts/build-verified.sh` | **Passed** across all five phases; existing proxy-environment warning only. |
| `git diff --check` | **Passed**. |

Read the [transcript](pilots/fireflies-01/transcript.md), [qualitative assessment](pilots/fireflies-01/assessment.md) and [machine-readable measurements](pilots/fireflies-01/pilot-summary.json). This is a live pipeline run through local storage, not deployed browser verification. It supports an audio audition but does not establish real-device playback, actual delivery duration, production latency or all optional conversation behaviors. Task 15 is next; no audio was authorized or generated here.

## Follow-up 15-minute chemistry run — completed

The user requested pharmaceutical process development and chemistry, approved a $5 text ceiling, and subsequently authorized abandoning one unknown source result while retaining its full reservation. The same saved episode, **From Flask to Factory**, reached an accepted text checkpoint on 15 October 2026, America/New_York.

The final script contains **1,908 words**, **12,632 spoken-text characters** and **15 turns**, approximately **14–16 minutes** at a calm 120–135 words/minute. The 119-word opening fits the 45–60-second profile. Light editing removed 185 words; whole-episode review returned **acceptable** with no factual repair. Distinct process-chemistry, analytical and engineering priorities are audible in the text, although the exchange remains host-led and Arun has only one contribution. This different-topic follow-up is not a controlled prompt comparison. See the [transcript](pilots/pharma-process-15m-01/transcript.md) and [assessment](pilots/pharma-process-15m-01/assessment.md).

There were **33 logical operations and 33 generation submissions**: 32 completed and one explicitly abandoned. Known calculated estimates total **$1.173107135**. The abandoned source retains **$0.541144** and unknown actual usage; total conservative allowance is **$1.806268125 of $5**. Actual billing is unknown. The journal records 522 runner GETs, one separate diagnostic GET and two missing completion observations. No generation submission was duplicated.

Recovery added a narrow authorized source-abandonment path: preserve the unknown outcome, full monetary/tool reservations and operation identity; keep the source unread in a separate skipped list; proceed to another candidate. Ordinary unknown requests still hold. Local workspace state was isolated after observed rollback, preserving known IDs for retrieval. Discovery/reading conversion now discards redundant self-relationships while preserving other links; the previously held result was accepted by GET with an unchanged request fingerprint. No agent counts or guest output interfaces changed. All **175 tests**, TypeScript checking, the verified production build and whitespace checks pass; all 35 artifacts and final-script/edit/review linkage were verified. The recovery and approval records are saved with the run.

Task 15 remains audio integration. No audio was authorized or generated in this follow-up.

## Editorial engagement follow-up — 16 October 2026 UTC

Implemented the listener's pharmaceutical-pilot feedback in the existing production stages. Commissioning, source selection and the evidence briefing now prioritise a consequential verified puzzle or development; historical plans are dated and relevant later work is sought within existing research allowances. Casting and preparation specify intellectual instincts through the existing profiles. Host and guest prompt 1.3.0 encourage short live questions, supported conclusions and direct responses to actual preceding speech.

Added deterministic participation observations to host, editing and review context. Counts describe who has spoken and who has been absent; they do not force a floor assignment or equal airtime. Review now addresses story, insight, voices, interaction and pacing in the existing notes/summary. Serious editorial failures use bounded correction or a hold; the editor cannot invent a missing guest contribution. Source-handling safeguards, four on-air characters, output schemas, routing reducers, stages and financial/length caps remain intact. Known compatible preparation revisions remain readable while unknown versions and changed evidence still block.

The [implementation record](editorial-engagement-update.md) describes the behavior and limits. The [pilot correction notice](pilots/pharma-process-15m-01/corrections.md) records verified factual framing issues and supersedes the earlier recommendation to move that original script directly to audio. The original accepted speech, final-script linkage, evidence, usage, database and immutable artifacts are unchanged. No new paid pilot or audio call was made; the original $5 ceiling remains unchanged.

Verification: **179 tests passed**, zero failed/skipped/cancelled; TypeScript checking, the verified five-phase production build and `git diff --check` passed. Four new tests cover participation observations, host/guest privacy boundaries, prior preparation compatibility and a material editorial hold without new speech or regeneration. No dependency or UI changes. These checks establish behavior and compatibility, not improved live listening quality; that requires a subsequent generated episode and editorial assessment.

## Research-reuse pharmaceutical pilot — 16 October 2026 UTC

Completed the requested new 15-minute-profile run using saved research and already verified corrections. [Making the Same Drug a Different Way](pilots/pharma-process-15m-02/transcript.md) has 2,119 words in 21 turns and an acceptable whole-episode review. Guest participation is four, four and three turns; two silent handoffs support a late direct exchange. The host's follow-up questions average 15.75 words. The [assessment](pilots/pharma-process-15m-02/assessment.md) records improvements and remaining weaknesses, including similar rhythms, an overlong hypothetical tail and the omitted reported activity headline. Planned duration is approximate: 14.6 minutes at 145 words per minute, longer at bedtime pacing.

No new searches or source reads occurred. There were 32 unique generation submissions, with new conservative allowance $1.69399 and combined pharmaceutical allowance $3.500258125 of the original $5. The earlier abandoned reservation remains counted; billed charges are unknown. All 35 artifacts, frozen evidence, exact final/export linkage and unique response identities were verified. No audio generation or production UI changes were made.

Local setup/recovery required same-ID acceptance of the completed commission, a run-specific context limit of 128,000 for later speaking/editorial operations, and movement of unused research headroom within the same $3.19 new-run ceiling. Records preserve the original settings, charges, floor invitation and exact dialogue. Future work should improve context sizing for richer 15-minute packs and account for the current host operation before permitting a narrowly funded guest invitation. The production defaults and floor reducers were retained during this run. Runtime state was isolated from workspace synchronization and the completed record copied here afterward.
