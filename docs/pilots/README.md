# Task 14 measured text pilot

The [second pharmaceutical pilot](pharma-process-15m-02/README.md) reuses the saved research with the revised production prompts: **2,119 words**, acceptable review, guest turns **4/4/3**, and two silent host yields. It made no new searches or source reads. Combined conservative allowance across the pharmaceutical runs is **$3.500258125 of $5**. [Transcript](pharma-process-15m-02/transcript.md) · [Assessment](pharma-process-15m-02/assessment.md). Narrative and participation improved; remaining editorial and local-run recovery limits are recorded, and no audio was generated.

Subsequent listener review identified factual framing and editorial weaknesses in the pharmaceutical pilot. Its [correction record](pharma-process-15m-01/corrections.md) supersedes a recommendation to send that original script directly to audio. The [production update](../editorial-engagement-update.md) addresses selection, participation and review; it has not yet been assessed in a new live episode.

The [15-minute pharmaceutical process development run](pharma-process-15m-01/README.md) is **complete** with the revised guest prompt: **1,908 words**, acceptable review and **$1.806268125 conservative allowance of $5**, including an abandoned request's full reservation. [Read its transcript](pharma-process-15m-01/transcript.md) and [assessment](pharma-process-15m-01/assessment.md). Its preflight remains the original zero-call record. The local runner accepts `--minutes 5` (default) or `--minutes 15`; website creation retains its five-minute UI. The five-minute defaults and completed run below are preserved.

For long local runs, keep live mutable state in an ignored runtime directory and monitor the runner's own execution output; copy completed artifacts into the saved run directory afterward. Workspace synchronization reverted versioned run files during this follow-up. The recovery record documents the isolated runtime used successfully here; this does not change the deployed D1 runner.

Status: **Task 14 is complete.** The approved $5 text-only firefly pilot reached the accepted text checkpoint on 15 October 2026. The final script has 600 words in nine turns. Estimated charges were **$0.918715**; actual billed charges are unreported. No audio was generated.

[Read the transcript](fireflies-01/transcript.md) · [Assessment and measurements](fireflies-01/assessment.md) · [Usage summary](fireflies-01/pilot-summary.json)

The user approved **How do fireflies make light?**, five minutes, with a **$5 maximum and no audio**, at 18:10 America/New_York. The complete saved run is in `fireflies-01/`, including authorization, exact artifacts, SQLite state and recovery notes. **Task 15** uses this accepted script for a separately authorized four-voice audio trial.

## Reproduce preflight

Run from the project root:

```bash
node --experimental-strip-types scripts/run-text-pilot.ts --topic 'How do fireflies make light?'
```

Without `--run`, the script prints saved-policy reservation quotes, makes no provider calls and creates no pilot storage. The saved [preflight](task14-preflight.json) has a null authorized ceiling. The proposed $5 ceiling is not an estimate or a promise that the run will complete. The current policy reserves about $0.54 per hosted retrieval operation and $0.40 for the largest text/review request, releasing headroom only after observed usage. Smaller ceilings can pause safely before completion.

## Run after confirmation

The existing ignored `.env.local` contains the configured provider access. Do not print or copy its contents. After the user agrees to the topic and ceiling, run:

```bash
node --env-file=.env.local --experimental-strip-types scripts/run-text-pilot.ts --run --topic 'How do fireflies make light?' --ceiling 5 --out docs/pilots/fireflies-01
```

This uses the production V2 stage registry, provider adapter, leases, accounting and artifact validators with a durable local SQLite adapter and private file-backed object storage. It measures the text pipeline rather than the deployed HTTP/browser environment; Task 13 already checks real routes with mocked providers. Local pilot records do not appear in the production app's Saved list. No hosting secrets, audience or production jobs are modified.

The directory preserves `run.sqlite`, `job.json`, immutable object artifacts, HTTP timing/retrieval counts, `usage-report.json`, and available transcript/research exports. The complete job retains attempt provenance and provider usage. HTTP journal entries contain only method, timestamp and status; no request headers or prompts. Prompt inputs can be reconstructed from saved artifacts and versioned source. API credentials are never written to run artifacts.

Reusing the same command/directory loads the saved job and enforces identical topic and ceiling. Known pending responses use GET and retain their reservation; uncertain results without an ID stay held. A fresh invocation may resume only through the existing safe control. It does not override a budget, review, material, validation or unknown-result hold. Provider rejection or network failure must be assessed before another paid experiment. A step/call budget or the runner's 512-tick guard can stop an incomplete run; stopping is not acceptance.

## Assess and finish

Read every accepted and final turn. Record whether speakers respond to preceding speech, have distinct useful viewpoints, explain clearly, use proportionate qualification, fit approximately five minutes and answer the central question. Assess whole-episode review and any local correction; do not assign numerical accuracy. Record the introduction and rough spoken length; actual delivery duration remains unmeasured until audio.

Report observed stage and operation latency with polling/operator delays identified; provider-only processing time was not independently measured, submission and retrieval requests separately from logical operations, and observed tool/token counts with missing values retained. Reasoning tokens are part of output, not extra tokens to add again. Cost calculations are estimates; billed charges remain unknown. Record the saved pricing version and any incomplete usage/cache details. Compare an available old transcript qualitatively without launching another paid run.

Only mark Task 14 complete when an accepted transcript is enjoyable enough for an audio trial. A held or failed run needs a specific next question or stage repair using valid upstream artifacts. Task 15 then connects accepted text to audio.
