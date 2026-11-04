# Private V2 text pilot

Task 13 exposes the completed text pipeline inside the existing owner-private app. V1 is still selected by default. V2 is deliberately text-only until the measured pilot and later audio task are complete.

## Start or save a pilot

Select the V2 text-pilot option, enter a five-minute science question, and optionally enter a dollar spending limit. Leaving the limit empty saves a paused job and makes no provider calls. Starting with an explicit limit authorizes calls within that ceiling. The limit is not an estimate of completion cost or a guaranteed final bill: reservation and usage-reporting limitations from the provider/accounting guide still apply.

Limits accept whole cents from $0.01 to $1,000. The saved allowance allocates 35% to research, 45% to text, 20% to review and zero to audio. These are stage limits, so a job may pause before reaching the overall ceiling. A budget increase must be explicit and is accepted only when no pending or uncertain provider work remains. Existing reservations and measured usage are preserved.

## Controls and recovery

Pause waits for the current browser request to settle and then saves a manual pause under the job lease. It cannot revoke work already submitted to a provider. Resume reuses saved stage artifacts and retrieves known provider responses. An uncertain result without a saved response ID stays held; repeated submission is prohibited. Cancel preserves the job and any uncertain usage while releasing the active slot. Cancel is terminal for these controls.

Reopening a saved job reads its current server state without advancing it. Resume and budget actions reread allowed controls first. While running, the page advances one bounded request at a time with polling delays. Page inactivity stops subsequent advancement; this is not an unattended queue. Server leases also protect against overlapping tabs.

An accepted whole-episode review saves the exact approved script and pauses at the text checkpoint. The app offers transcript/research downloads and makes no audio request. The checkpoint releases the active slot so a later job can be created.

## Access and exports

The Site audience remains owner-only. Every episode route independently scopes records to the authenticated Site user; mutations also require the same origin. Do not broaden the Site audience without revisiting the rollout permission model. `V2_TEXT_PILOT_ENABLED=true` enables capability discovery and new V2 creation when text bindings are available. Removing/disabling it hides creation; existing owned jobs and their safe controls remain available.

Polling exposes plain stage progress, safe pause descriptions, action flags and owned links. It excludes private preparation, storage references, prompts, usage records and provider attempts. The transcript download distinguishes exact accepted speech, edited speech, whole-episode review and final approved speech. The research download contains saved source records, frozen evidence and post-conversation supplementary evidence. Both are authenticated, private no-store JSON attachments.

## Verification boundary

Nine real-route tests and six actual-browser-script harness tests cover the app behavior, using mocked providers and local storage doubles. All 159 TypeScript tests, TypeScript checking, script syntax and the verified Worker build pass. No live model calls, browser rendering checks or real-device audio tests were performed for Task 13.

Task 14 runs one agreed five-minute topic with an explicit applicable ceiling, records stage latency/calls/tools/tokens/estimated charges and usage gaps, and reads the full transcript for quality. Task 15 adds audio only after that text pilot is accepted.
