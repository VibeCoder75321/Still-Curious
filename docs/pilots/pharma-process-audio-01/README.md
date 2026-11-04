# Pharmaceutical process development — audio continuation

## Current result — 16 October 2026

The [four-voice audition](pharma-process-audition.mp3) is ready: **5:06**, 44.1 kHz mono MP3. It contains the first three sections (4,683 spoken characters) of the exact approved script. The job is paused at `audio_audition`; the other seven sections have not been synthesized. Listen for voice suitability, intelligibility, missing/repeated words, speaker correspondence and transitions before accepting full audio.

[Audition verification](audition-verification.json) · [Saved job](run/job.json) · [Run summary](run/audition-summary.json) · [Provider verification](run/provider-verification.json) · [Settled balance](run/balance-settled.json)

The user explicitly approved Models Access, Voices Read and History Read on the existing key. The saved settings and successful model/four-voice reads verify the change. The existing 10,000-credit key limit is unchanged. The four configured voices are standard premade voices, with no custom-rate premium.

The API price is **$0.08 per 1,000 characters**, verified on both the official API pricing page and the signed-in account's API table. The complete ten-section plan reserves **$1.241920002**, including all bounded adjacent context, within the existing $1.49 audio allowance. The audition reserves $0.414640001 of that same plan; accepting it reuses these clips. Prior conservative text allowance plus the full authorized audio allowance remains $4.990258125 against the original $5 cap.

Three paid POSTs returned HTTP 200. Their raw `character-cost` values are 389, 351 and 289: **1,029 provider units**. The settled account balance declined by exactly that amount, with 27,390 credits remaining. Purchased-credit face value is about **$0.37456**; this is not an API invoice. The immediate balance read lagged the final response, so both immediate and settled snapshots are retained. Actual billed USD stays null.

The earlier preflight incorrectly inferred API dollars from purchased display-credit conversion and the model catalog's token factor. ElevenLabs explicitly distinguishes API USD billing from display credits. The runner now requires a dated, operator-verified API dollar price and still checks the full dollar plan before any paid request. Its credit-cap check covers only the audition submitted here; it does not expand the existing key limit or authorize full rendering. Remaining quota is checked again after listening acceptance. Historical failed/unused configuration is retained.

A live response also showed that `character-cost` can differ from spoken text length. V2 now retains that raw meter separately and leaves inferred/reporting USD null; conservative reservations remain unchanged. The three audition records and receipts were relabeled offline, preserving the original records, audio hashes and complete audit trail in [meter reconciliation](run/meter-reconciliation.json). No extra provider request was made for this correction.

Verification: **201 TypeScript tests pass**, typecheck and whitespace checks pass, and ffmpeg decodes the complete MP3 without errors. All 35 original artifact references verify, and original research/text objects are unchanged. Automated checks establish file integrity and exact speech input preservation; they do not establish how naturally the voices sound or whether every spoken word was rendered correctly. That remains the listener's review. Production paid-audio enablement remains off.

## Earlier checkpoints

The following records describe earlier holds, now resolved where noted above. They remain to preserve chronology.

The user accepted the [second pharmaceutical script](../pharma-process-15m-02/assessment.md) and requested the next task on 16 October 2026. Task 15's integration is implemented; this directory records its read-only preflight, not a synthesized episode.

[Measurements and provider result](preflight.json) · [Implementation and recovery behavior](../../episode-v2-audio.md)

The text and research remain unchanged. Ten speech-preserving sections are planned; the first three contain all four voices. Proposed audio allowance: $1.49. Prior conservative text allowance plus that authorization would total $4.990258125 against the original $5 cap. Base-rate calculations are illustrations, not verified billing or an authorization.

The configured ElevenLabs key returned HTTP 401 `missing_permissions` for the subscription metadata read. Provider access stopped. No paid audio calls, new research, replacement text generation or credential changes occurred. No audio file exists for this continuation yet. Resolve metadata access and verify account/voice pricing, then create and listen to the audition before accepting full synthesis.

## Funding update — 16 October 2026

The user requested that the agent fix account metadata access; that narrow permission was saved and `GET /v1/user/subscription` now returns HTTP 200. The user then purchased $10 in credits directly. The verified balance is **28,419 credits** on pay-as-you-go, with 27,472 new credits added. The account's advertised USD-per-character price and its credit conversion must be reconciled using the model's actual factor before treating either as a verified upper bound.

[Funding and permission record](funding-and-permissions.json) records the remaining hold. Automatic approval review rejected enabling the model-catalog permission because Models Access had not been explicitly authorized. The prepared `scripts/run-audio-audition.ts` verifies subscription, model factor and the exact four default voices, derives a conservative price from the observed purchased-credit conversion, and stops before paid synthesis unless the entire plan fits the existing $1.49 audio allowance. It also retains the key's current credit limit, the exact accepted script and the listener-acceptance checkpoint. No audio has been generated or charged yet. Models Access, Voices Read and History Read are the proposed narrow metadata/recovery permissions; no scope has been silently expanded.

The full TypeScript suite now has **200 passing checks**. Three new CLI checks use authored metadata with a clearly synthetic model factor: they verify conversion/preflight without paid submissions, a hold when the account-specific price exceeds the unchanged allowance, and immediate stopping on denied metadata permission. They do not establish the live account's model factor. TypeScript and whitespace checks pass. No application-bundle code changed in this funding follow-up; the existing deployment remains valid.
