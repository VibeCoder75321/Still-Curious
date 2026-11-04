# Version 2 editorial producer

Task 05 implements `commission.produce` in `lib/episode-v2/stages/producer.ts`, with its versioned prompt and output schema in `lib/episode-v2/prompts/producer.ts`. The default stage registry now includes this handler. V2 creation remains deferred to Task 13; this task makes no live provider call.

## Inputs and editorial authority

The producer receives the exact saved topic, selected five-minute profile, versioned framework guidance and the full original programme brief when available. The prompt keeps those inputs separate from role instructions. The selected duration comes from the server, including the default 20–30-second introduction and soft whole-episode word guidance.

Runtime framework guidance is an exact snapshot of framework v2.1 sections 1–2 and Appendix A's shared and producer prompts. A test compares it with the preserved Markdown source and verifies its SHA-256. It is explicitly identified as operational guidance, not the original programme brief.

The original programme brief is still unavailable as a verified verbatim source. Ordinary jobs leave `state.programmeBrief` absent and send an explicit `not_available` status. If that source is later supplied, store its complete text in `state.programmeBrief` with `{ id, version, sha256, text }`. The handler verifies the text's SHA-256 and 64 KiB UTF-8 allowance before submission. It never truncates a brief to fit. The brief's identity/hash appear in saved editorial metadata and provenance; its full text remains in private job state. Do not relabel a summary or fixture as the missing original.

The request, exact guidance, original brief and selected profile all enter the runner's input hash. Changed editorial text cannot silently adopt a response commissioned against older inputs. The saved model policy selects the producer role; the existing default is Sol at xhigh, with no web tool. Coding-agent settings do not determine that runtime policy.

## Commissioning behavior

The producer is instructed to expand a topic into possible foundations, mechanisms, evidence, history and implications, then choose one inquiry that fits five minutes. A narrow request keeps its central interest. A broad request records the narrowing and why that choice is reasonable. An interpretation note distinguishes explicit intent from an assumption without inventing personal preferences.

The output commissions investigation. It asks answerable questions, names evidence needs, seeks serious alternatives/counterevidence and documented story opportunities where useful, and states what would be enough evidence for this limited episode. It records questionable premises without treating them as established facts. It does not select a scientific conclusion, invent a discovery scene or draft the conversation before research.

The model returns a strict title, brief, research commission and duration-adaptation rationale. Code supplies identities, the verbatim request and selected timing, so a model response cannot replace those fields or add a longer opening. Empty required research/context fields and unknown fields fail validation without an automatic repair call.

## Saved artifacts and recovery

One provider operation produces two linked artifacts:

| Artifact | Saved content |
| --- | --- |
| `episode-brief:1` (`episode_brief`, version 1) | Original request, main curiosity, explicit/inferred interpretation and note, central question, promise, starting knowledge, foundations, deeper focus, exclusions, secondary questions, premises, atmosphere, duration adaptation and editorial-input references. |
| `research-commission:1` (`research_commission`, version 1) | Exact original request, five-minute duration, exact brief reference, research questions, evidence requirements, alternatives, story opportunities, pitfalls and evidence-sufficiency criterion. |

The duration adaptation records `preserved` or `narrowed`, its rationale, introduction purpose, discussion focus and ending aim, alongside the server's profile/version, 300-second target and introduction range. These are editable editorial priorities, not a prewritten running order or per-turn quota.

The durable runner saves both artifacts, shared actual-model/usage provenance, the completed `commission.produce:1` attempt, title/progress and transition to `research.discover` in one conditional D1 update. Background polling uses the same attempt. A completed attempt reuses both saved artifacts without generation. If producer output is invalid, the job remains at its commissioning step with usage recorded and no partial artifact pair. Existing v2 artifact fields added here are optional in the general decoder for compatibility; this producer always supplies them.

Research discovery/reading are not implemented by this task. Advancing to an unimplemented handler pauses without spending. No v1 generation, audio, browser flow, credential or spending ceiling was changed.

## Fixture review and verification

The examples in `tests/fixtures/producer.ts` are authored commissioning fixtures, not live model outputs or researched scientific answers. They make the desired editorial choices reviewable:

| Request | Chosen inquiry | Research requirement to notice |
| --- | --- | --- |
| “Trees” | How does water reach the top of a tall tree? | Find a discriminating measurement and an important limit, rather than surveying all tree biology. |
| “Why do some fireflies flash together?” | Preserve the original coordination question. | Establish species/conditions, observations and evidence that could distinguish proposed mechanisms; light chemistry stays background. |
| “How do trees decide to help their friends?” | What evidence would show that an interaction benefits another tree? | Examine benefit and intention as premises; seek controls and alternative explanations without dismissing the underlying curiosity. |

On 15 October 2026, **77 checks passed**: nine producer checks plus the prior 68 contract/provider/recovery/Worker/dialogue checks. The new suite covers exact input/guidance transmission, both linked outputs and one atomic acceptance, selected timing, full-brief preservation/hash/byte limits, saved-ID polling/cache reuse, invalid/override output rejection and role/data separation. Persistence uses the production SQL against in-memory SQLite; provider transport is mocked.

```sh
node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts
node node_modules/typescript/bin/tsc --noEmit
bash scripts/build-verified.sh
git diff --check
```

TypeScript checking and the Worker build pass. These checks verify contracts and integration, not whether a live model consistently makes good editorial choices or follows every semantic instruction. The measured text pilot in Task 14 remains the place to assess generated commissioning quality, conversation quality, latency and cost.
