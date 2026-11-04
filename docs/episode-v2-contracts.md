# Version 2 pipeline contracts

Task 02 defines the shared shapes and validation helpers. The schemas are in `lib/episode-v2/contracts.ts`; the five-minute profile is in `lib/episode-v2/config.ts`. Types are inferred from the same Zod schemas used to validate saved data. Zod was already installed; this task adds no dependency.

## Versioning and provenance

Every version 2 job and artifact has numeric `schemaVersion: 2` and `pipelineVersion: 2`. An artifact also has a unique `id`, a `kind`, a positive integer `version`, an ISO creation time, and `provenance`:

- `inputVersions`: artifact references containing ID, kind and exact version.
- `editorialVersion`: the programme guidance used, currently framework v2.1.
- `prompt`: prompt ID/version, or null for an artifact produced without a prompt.
- `modelConfiguration`: actual model and optional reasoning effort, or null for a code/fixture artifact.
- `usageRecordIds`: references to the accounting records that Task 03 will introduce.

An artifact reference names an exact version. Model names and reasoning effort are strings in this storage contract; supported provider settings are verified in Task 03. No runtime model selection is implied by the coding agent's Extra High setting.

## Artifact types

| Kind | Data |
| --- | --- |
| `episode_brief` | Original request, explicit/inferred curiosity, central question, listener promise, background, deeper focus, exclusions, premises to check, atmosphere and selected duration. Task 05 adds interpretation notes, duration adaptation and editorial-input metadata. |
| `research_commission` | Brief reference, questions, evidence needs, alternatives, possible stories and overstatements to avoid. Task 05 adds the original request, duration and an evidence-sufficiency criterion. |
| `source_records` | Source identities, publication details and notices, evidence families, reading coverage, saved passages and locators. |
| `evidence_pack` | Source-record and commission versions, common briefing, topic map, qualified claims, interpretations, stories, uncertainties, limits and a coverage decision. |
| `cast` | Host and exactly one profile for each of `expert1`, `expert2`, `expert3`; fictional guest identities, overlapping expertise and intellectual temperament. |
| `guest_preparation` | Guest ID, cast/evidence versions, thesis, evidence, qualifications, counterargument, examples, open questions and revision conditions. Each guest receives a separate artifact. |
| `host_plan` | Brief/evidence/cast versions, the three guest-note references, priorities, questions, possible follow-ups, detours and ending aim. |
| `transcript` | Exact spoken turns plus separate host decisions, stance changes and show state. |
| `edit_report` | Transcript reference, edited turns and changes mapping source turns to result turns. An empty result mapping records removal of a redundant turn. |
| `review` | Evidence/edit versions, an overall outcome, notes and any concrete consequential issues with affected turns and evidence. |
| `final_script` | Cast/edit/review references, final spoken turns, resolved local issue IDs and the nearby coherence check. |

`spokenTurnSchema` accepts only `{ id, speaker, text }`. IDs and text must be nonblank; IDs must be unique within a transcript or finished script. Valid speakers are `host`, `expert1`, `expert2`, `expert3`. There is no turn word quota, factual flag or required claim-ID field. Production metadata is held separately.

Task 05's additive brief/commission fields are optional in the shared decoder for saved-v2 compatibility, but the producer always writes them. An optional private `state.programmeBrief` retains a supplied original's full text, ID, version and SHA-256; absence explicitly means unavailable. See the [producer guide](episode-v2-producer.md) for input hashing, duration planning and text-size checks.

Source records distinguish discovered material, snippets, abstracts, partial/full body reading and inaccessible sources. A record marked as body reading must include a saved body passage. This is a structural check, not proof of what the researcher actually read. `assertEvidencePackSources` resolves claim/story/interpretation references to the exact saved source version and its passage IDs.

## Review and final text

The outcomes are `acceptable`, `acceptable_with_local_edit` and `revise_section`. An acceptable review can retain notes about minor uncertainty; it has no consequential issues. The other outcomes require specific issues. An accuracy percentage is not a field in the contract.

`assertFinalScriptApproved` checks matching review/edit versions. A local-edit outcome requires exactly the identified issues to be resolved and nearby coherence checked. A section-revision outcome requires revision and a new review before acceptance. It does not send the conversation back to the beginning.

Jobs at `ready_for_audio`, `tts`, `assembling` or `ready` need a `state.finalScript` reference resolving to a saved final script and its accepted review, unless the job is already failed. `ready` also requires a saved audio key. This prevents a text checkpoint from masquerading as playable audio. These checks establish recorded approval, not independent factual correctness.

## Stages and substeps

| Stage | Substeps |
| --- | --- |
| `commission` | `produce` |
| `research` | `discover`, `read`, `synthesize` |
| `casting` | `cast` |
| `preparation` | `expert1`, `expert2`, `expert3`, `host` |
| `conversation` | `host`, the selected expert, or `request_expert1`, `request_expert2`, `request_expert3` |
| `editing` | `edit` |
| `review` | `assess`, `local_edit`, `section_revision`, `recheck` |
| `ready_for_audio` | `wait` |
| `tts` | `synthesize` |
| `assembling` | `assemble` |
| `ready` | `complete` |

`assertStepTransition` rejects unknown stage/substep combinations, skipped stages, skipped guest preparation and a return from review to the full conversation. It permits bounded research loops, contribution requests, local repair/recheck and successive audio sections. It describes valid phase order. Tasks 03–04 add allowance reservations, exact input versions and locking; later stage implementations enforce their prerequisites and loop counters.

Status is separate: `running`, `paused`, `failed`, or `ready`. Pause/failure records retain the stage and substep where processing stopped. Paused jobs require a reason; failed jobs require an error. `assertJobTransition` keeps job identity and owner stable, requires a paused job to resume at its saved step, and rejects advancing terminal jobs. The accepted-text checkpoint is paused at `ready_for_audio.wait`; it can proceed to `tts.synthesize` when audio is requested.

## Five-minute profile

`createFiveMinuteConfig()` returns a fresh validated configuration for each job:

| Setting | Default | Meaning |
| --- | --- | --- |
| Selected duration | 5 minutes / 300 seconds | Pilot scope. |
| Introduction | 20–30 seconds | Editorial target. |
| Spoken words | 550–700 total | Soft guidance for the whole episode. |
| Final audio | 240–390 seconds | Initial acceptable duration window, retained from the audio baseline. |
| Audio allowance | 5,000 characters | Initial episode allowance. |
| Audio chunk | 1,800 characters | Existing chunk size; schema maximum is 2,000. |
| Provider operations | 64 | Candidate episode safeguard, replacing the old ten-call assumption for v2. |
| Search / source reading | 4 calls / 8 reads | Candidate research limits. |
| Conversation | 32 turns; 3 contribution-request rounds | Safeguards, not a required turn count or rotation. |
| Edit / review | 1 edit pass; 2 review passes | Includes the initial assessment and a recheck when needed. |
| Local / section repair | 1 of each | Bounded correction allowances. |
| Spending ceiling | null | No live-spending authority is represented by this default. |

The count limits are configurable, unmeasured pilot choices. They are independent ceilings, not a promise that every maximum can be reached within the total allowance. A caller can supply an existing authorized spending ceiling; Task 03 will implement accounting and enforcement. Task 02 makes no provider calls and does not choose runtime models.

## Version 1 compatibility and integration

`decodeStoredEpisodeJob` treats jobs with no version fields as version 1 and also accepts explicit version 1. It preserves opaque legacy artifacts, word-array drafts, clip layouts, extra fields and an absent progress object. It does not retrofit the new turn schema onto older scripts.

Version 2 data must carry both version fields and validate as v2. Malformed, mixed or unsupported future versions cannot fall back to the v1 reader. Decoder errors do not echo saved input. Owned-job and job-list reads use this decoder. Task 04 adds a separate v2 advance branch; new job creation still follows the existing v1 pipeline. Opt-in v2 creation and UI are Task 13 work.

Run `node --experimental-strip-types --test tests/episode-v2-contracts.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` for the contracts and retained TypeScript regression suite. The Task 02 result is **38 passed**, including 11 new contract checks. TypeScript and the verified Worker build also pass; see the implementation log for the dated handoff.

Tasks 06–09 add optional research-loop metadata/relationships, explicit evidence basis and frozen source hash, linked extracts/source families and grounded cast perspectives. Older v2 artifacts still decode; new stage handlers require their implemented provenance and foundation fields before advancing. An empty source snapshot can honestly represent a verified search with no candidates. See [research and preparation](episode-v2-research-preparation.md).

Task 11 adds optional saved conversation/floor state to transcript snapshots and a host request-collection action. Accepted speech still has only `id`, `speaker` and `text`; requests, invitations, response queues and budgets remain separate. Nonempty transcripts without scheduler state require explicit review before orchestration.

Task 12 adds the `review_evidence` artifact for a bounded consequential source lookup after the conversation, optional edit-chain/repair metadata, and the review lookup substep. Existing frozen evidence stays unchanged. New final-script approval checks the specifically reviewed edit and exact speech through the optional third `assertFinalScriptApproved` argument; future audio consumers must supply it.
