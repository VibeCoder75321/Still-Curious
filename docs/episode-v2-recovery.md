# Version 2 durable execution

Task 04 adds `persistence.ts` and `runner.ts` under `lib/episode-v2/`. The existing advance endpoint selects this runner only for saved v2 jobs. Creation still produces v1 jobs. Tasks 05–09 register the [editorial producer](episode-v2-producer.md) and [research through host preparation](episode-v2-research-preparation.md); later tasks add speaking and conversation handlers. A missing handler pauses without calling a provider. Task 13 supplies the opt-in UI and explicit resume controls. No live pilot was run here.

## Saved execution and conditional writes

The existing D1 schema is sufficient; no migration is required. Each lease has an owner, episode ID, random lock token, five-minute expiry, execution revision and exact original `job_json` snapshot. Claiming an expired lease permits inspecting saved work. It does not authorize repeating an unfinished operation.

Before submitting, the runner saves the selected model policy, a unique attempt ID, logical step key, phase, prompt version, exact artifact input references, SHA-256 input hash and the usage reservation in one conditional update. The hash covers the request/schema, resolved input contents, prompt/editorial versions, topic, configuration and role settings. Rebuilding a plan with different inputs or prompt versions cannot accept the old response.

Every save compares owner, lock token, unexpired lease, execution revision and the exact prior JSON. The JSON comparison also rejects an outside writer that changed state without incrementing the revision. Successful writes increment the revision. Releasing an old token cannot clear a replacement lease. Paused jobs retain the single active-job slot except when explicitly cancelled.

On success, artifact outputs, their provenance, usage settlement, completed attempt and next step are saved in the same D1 update. The runner stamps provenance from the accepted input references, saved prompt version and actual provider model/usage ID. Artifact IDs are immutable; a revised artifact needs a distinct ID and version reference. A completed attempt is valid only when its output versions exist and its usage is settled within bounds.

## Start and poll

The runner sets Responses `background: true` and `store: true`. Each advance performs either one POST submission or one GET retrieval, without a polling loop. Both transports have a local timeout of at most 15 seconds. Pending responses save their ID, keep the full reservation and permit another poll after two seconds. Polling reuses the attempt and saved settings; it does not reserve or submit another operation.

This follows the documented [background mode](https://developers.openai.com/api/docs/guides/background) and [response retrieval](https://developers.openai.com/api/reference/typescript/resources/responses/methods/retrieve) APIs, checked on 15 October 2026. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) distinguish CPU limits from HTTP wall time: a client disconnect can interrupt request work, and `waitUntil` offers only a bounded extension. The project sets no explicit Worker duration override. Actual model latency has not been measured; choosing short submit/poll requests avoids relying on the original adapter's 90-second synchronous wait. No `waitUntil` task or unattended queue is introduced. Account support, retention and retrieval availability remain provider constraints to verify in the pilot.

| Saved state | Next advance |
| --- | --- |
| Completed, with exact matching inputs and saved output versions | Reuse the saved result. |
| Pending or uncertain, with a saved response ID | Retrieve that exact ID once; never POST a replacement. |
| Submitted or uncertain, without a saved response ID | Pause for reconciliation; retain the reservation. |
| Retrieval unavailable, unreadable, or returning a different ID | Keep the original ID and full reservation; pause. A later attempt may GET the same ID. |
| Known rejection, incomplete/invalid result, or work beyond a configured bound | Save usage and pause for attention; no automatic paid retry. |
| Output conversion or artifact storage fails | Save provider metadata and pause at the current step; no partial artifacts are accepted. |
| Lock, revision, JSON snapshot or input hash changes | Reject the stale completion. |
| Save acknowledgement is lost | Reread D1. Never overwrite a possibly committed result with a fallback failure. |

There is no atomic transaction across D1 and a provider submission. If a request might have been sent but its response ID was never saved, the safe outcome is a pause requiring attention. This implementation does not claim automatic recovery in that case.

## Adding a stage handler

`StepFactory` receives the claimed job and an owned artifact reader. Return one deterministic `StepPlan` containing a stable logical key, current stage/substep, exact input references, prompt/editorial versions, one provider request and a `finish` function. `finish` receives both parsed output and observed web actions/sources, then returns artifact envelopes and the next step. It must not initiate provider work. The runner supplies the attempt ID, background mode, reservation, provenance and conditional persistence.

Examples of distinct keys are `preparation:expert1`, `preparation:expert2`, `conversation:turn-7:expert3` and `contribution:round-1:expert1`. Prepare each guest and collect each contribution request in separate advances. Conversation/edit/review loop policies belong to their later stage implementations and must use the existing configured limits.

Register handlers with `advanceV2Job` through its `StepRegistry`. Missing handlers pause with `needs_input`; absence of a usage ledger pauses with `budget`. The default five-minute profile still has no live-spending ceiling. Ordinary budget, input, material-review and cancellation pauses require an explicit state change before resuming; only known-ID reconciliation can proceed from an ambiguity pause automatically. Text acceptance remains a separate checkpoint before audio spending.

## Private and bounded artifacts

- Job JSON: at most 512 KiB. One artifact: at most 256 KiB. The canonical material used to hash one plan: at most 2 MiB.
- Source-record and evidence-pack artifacts above 32 KiB are stored in the existing private R2 bucket. D1 retains an exact version reference, size, SHA-256 and owner/episode-scoped content-addressed key. Reads verify all four and parse the artifact schema.
- Final-script/review artifacts stay inline for the existing approval gate. Avoid copying source bodies into the job's separate source-summary list.
- R2 writes occur before the D1 acceptance update. A failed conditional update can leave an unreferenced private object; it never makes that output authoritative. No public blob-serving endpoint is added.
- The v2 public job view exposes status/progress and an owned audio URL when ready. Private artifact keys, attempt inputs, response IDs and usage internals stay on the server. Research export/UI work remains Task 13.

## Verification

On 15 October 2026, **68 TypeScript checks passed**: 15 new recovery checks plus all 53 retained contract/provider/Worker/dialogue checks. The recovery suite executes the production SQL against Node's in-memory SQLite, with injected clocks, private object storage and mocked provider transport. It covers concurrent advances, saved-result restart, polling, unknown submissions, stale leases/snapshots/inputs, lost acknowledgements, failed persistence, separate guest/bid steps, private ownership/integrity and storage bounds.

```sh
node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts
node node_modules/typescript/bin/tsc --noEmit
bash scripts/build-verified.sh
git diff --check
```

This verifies local recovery behavior and build compatibility. It does not establish live model access, actual response latency, provider retention, production D1/R2 failure rates or podcast quality. Those need the later measured pilot. Existing v1 audio and browser behavior were covered by retained tests; no new generation, browser session or paid call was needed.

Task 11 registers the conversation handlers with the same durable runner. All production transcript snapshots use the private immutable object/index path, even when individually small, to keep repeated full-transcript copies out of job JSON. Read them through `readArtifact`. Pending conversation preflight reconstructs the original allowance view before hashing, and response-ID retrieval cannot resubmit accepted dialogue. See the [conversation guide](episode-v2-conversation.md).

Task 12 registers editing, initial review, a bounded optional source lookup, local/section repair and recheck. Accepted text saves its final script and specific review atomically before the `ready_for_audio.wait` checkpoint. Material holds do not rerun conversation stages. Supplemental source evidence is distinct from the original frozen research. See [post-production](episode-v2-post-production.md).
