# Version 2 speaking roles

Current editorial guidance: [engagement update](editorial-engagement-update.md), including host/guest prompt 1.3.0, preparation compatibility and advisory participation observations. The task entries below record their original implementation stages.

Task 10 supplies request builders and versioned prompts for the host, each guest and optional contribution requests. Task 11 now places these requests inside the [durable conversation loop](episode-v2-conversation.md). The stage registry reaches `editing.edit`; creating an episode in the current interface still selects version 1.

## Request builders

| Module | Builder | Result |
| --- | --- | --- |
| `lib/episode-v2/roles/host.ts` | `createHostRolePlan(job, read)` | The host's optional speech, action, next speaker and concise show-state updates. |
| `lib/episode-v2/roles/guest.ts` | `createGuestRolePlan(job, read, speaker)` | That guest's spoken contribution and optional stance update. |
| `lib/episode-v2/roles/contribution-request.ts` | `createContributionRequestPlan(job, read, speaker)` | Pass, or one proposed point of at most 360 characters. |

Each plan includes its server-owned speaker, exact artifact input references, prompt/editorial versions and a structured provider request. Task 11 adds the durable operation ID, reserves usage through the existing adapter, accepts results and routes the floor. Building or parsing a role request neither changes the job nor appends a transcript.

The output contracts live in `roles/contracts.ts`. Speakers cannot supply their own speaker IDs, turn IDs, an array of dialogue or fields for another person's answer. Speech uses `text`; routing and stance updates stay in separate fields. Structural checks do not prove that arbitrary prose contains only appropriate dialogue. Prompts establish that editorial boundary, and final review remains responsible for the episode as a whole.

## Inputs and privacy

All roles require the current frozen evidence, matching cast and prepared host plan. The common context reader verifies the original editorial metadata, preparation prompt versions, exact input references and source hash. A changed foundation pauses before a provider call.

The host receives its own profile, flexible host plan, all three concise guest notes and the complete accepted transcript. A guest or bidder receives only its own profile and private note, the common evidence, relevant saved passages and the complete accepted transcript. Other guests' private notes, host planning and unsaid alternate answers are excluded from those provider inputs. Guest positions are learned through accepted speech. Saved stance updates for the current guest help retain an actual change of view.

The reader selects the latest saved transcript rather than accepting caller-supplied dialogue. For an opening host request, no transcript means an empty conversation. Guests require a preceding accepted exchange. Existing turns retain their exact text and order, including corrections and qualifications. The transcript's cast and evidence references must match the current foundation.

## Output behavior

The host may ask a guest, yield to a guest, continue speaking or close. Asking needs its own spoken question. Yielding can have `text: null`, so direct guest responses do not require a host interjection. Continuing requires host speech and retains the host's floor; closing selects no next speaker. The host also identifies the live point to address, current topic, unresolved questions and any detour return point. Task 11 will record these choices and enforce the floor.

Guest speech can be a short qualification or a sustained explanation, with no per-turn word quota or mandatory citation field. A stance update records a changed emphasis separately from speech. The prompts allow reasonable disagreement and qualified recollection without live research, factual labels or an interruption for fact checking. They forbid invented firsthand experiences and prewriting another speaker's lines.

Contribution requests are optional. Passing is normal; a request names one point and why it would help. It is not a full competing answer and does not grant a turn. The host will decide whether to accept it, and any later contribution will be generated separately from the updated transcript.

The existing role policy supplies zero web-tool allowance for all three roles. These request builders explicitly use structured generation rather than research. The default spending ceiling remains unset and no live generation is needed for Task 10.

## Guest voice refinement

`conversation-guest` version **1.2.0** strengthens the reusable speaking instructions in `lib/episode-v2/prompts/guest.ts`. The existing casting profiles already supply intellectual tendencies, trusted methods, temperament and confidence style; the guest now uses these to choose what to notice, how to explain it, the useful level of abstraction and a consistent conversational rhythm. No topic, character, sample dialogue or personality archetype is added.

The guest answers the immediate point and develops one useful contribution, leaving room for the next speaker. Explanations progress in spoken steps, use concrete pictures when helpful and select details for understanding rather than exhaustive coverage. The prompt discourages mechanically repeated openings, contrasts, lists and conclusions without banning those forms individually. A silent final check asks whether the response is specific to this guest, advances the exchange, works aloud, adds understanding and uses appropriate factual confidence. An interchangeable response should be sharpened through the existing profile, not invented differences.

Evidence remains frozen and binding. Material uncertainty, documented story qualifications and hypothetical labels remain required; unsupported claims cannot become facts. Methodology and evidence caveats belong in speech when they help answer the question, rather than as routine announcements. References to other participants must come from the supplied accepted transcript. Private notes and unseen dialogue cannot be inferred.

Casting, preparation, contribution requests, the host and editing prompts were inspected and retained: preparation already uses the individual profiles, listening bids already require a useful point, and the editor already protects distinct voices. Only the guest speaking prompt and its version changed. Inputs, output fields, schemas, agents, floor routing, duration allowances and source handling are unchanged. Existing accepted speech and the completed pilot remain untouched. New guest operations record version 1.2.0; the existing request-fingerprint check treats an unfinished operation created with different instructions as stale instead of silently resubmitting it.

## Verification limits

Authored fixtures and mocked provider responses check speaker ownership, exact transcript inputs, private-note boundaries, silent yields, routing consistency, short bids, reference drift and tool restrictions. They establish the request and parsing behavior, not naturalness or factual quality of live generated speech. Those remain measured-pilot questions.

Task 11 advances the host/guest prompts to version 1.1.0 and adds request collection, saved response opportunities and usefulness feedback. These are control fields outside speech. See the [conversation guide](episode-v2-conversation.md) for the scheduler and persistence behavior.

Guest prompt 1.2.0 verification on 15 October 2026:

| Check | Result |
| --- | --- |
| `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts` | 165 passed; zero failed, skipped or cancelled. Existing checks cover strict outputs, exact transcript context, private-note isolation, variable speech length, bounded bids and zero web tools. |
| `node node_modules/typescript/bin/tsc --noEmit` | Passed. |
| `bash scripts/build-verified.sh` | Passed all five phases. |
| `git diff --check` | Passed. |

No live generation or audio was run for this prompt change. These checks establish compatibility; improvement in voice, naturalness and listener engagement still needs assessment on a newly generated conversation. The earlier accepted pilot is evidence about the previous prompt, not a test of version 1.2.0.
