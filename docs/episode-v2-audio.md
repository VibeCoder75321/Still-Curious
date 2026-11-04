# Task 15 — approved text to four-voice audio

Implemented 16 October 2026. A live five-minute pharmaceutical audition is saved. The app now supports complete 5/15-minute episodes with optional audition; see [current app workflow](episode-v2-complete-workflow.md). The pharmaceutical pilot's remaining full render is separate and has not been silently regenerated. Earlier checkpoint records below preserve their chronology.

## Contracts and spending

The V2 advance route dispatches `tts` and `assembling` to a dedicated ElevenLabs runner, separate from OpenAI editorial operations. It reads the explicit final script and its exact edit/review through the owned artifact reader, then calls `assertFinalScriptApproved(final, review, edit)`. Only `{id, speaker, text}` enters the shared dialogue contract. No V1 factual labels, source IDs, delivery tags or replacement speech are invented.

Authorization pins reference versions, speech hash, four distinct configured voices, model, price snapshot, MP3 format, duration range and deterministic chunks. The existing 1,800-character section default stays below the endpoint's documented 2,000-character reliable-input bound. Every turn's speaker and text are preserved exactly. Five/fifteen-minute character caps and duration windows remain unchanged.

`authorize_audio` takes an allowance in whole cents within the **existing** episode ceiling. It freezes already-used research/text/review allocations and moves only remaining headroom to audio. The complete plan, including bounded adjacent context, must fit before the audition starts. Authorization itself makes no provider call. Text and audio reservations share the same ceiling and operation-count limit; invalidated audio retains incurred reservations.

Audio has separate typed ElevenLabs records, not fictional OpenAI token records. Every POST follows a durable reservation under the D1 lease. Explicit character counts are recorded when supplied. The raw `character-cost` billing meter is retained separately because API discounts can make it differ from input length. Neither meter is converted into claimed billed dollars; reported and actual billed USD stay null without dollar evidence. Conservative reservations are retained even after provider rejections.

Paid audio is disabled unless the operator configures `V2_AUDIO_ENABLED=true` and `V2_AUDIO_PRICE_SNAPSHOT`. The snapshot is server-only JSON containing `version: 1`, `model`, the exact `{host, expert1, expert2, expert3}` voice IDs, `usdPer1kCharacters` and `checkedAt` (Unix milliseconds, at most 30 days old). Its rate must be an account-specific upper bound including voice premiums. Browsers cannot set prices or voices. **Update: environment revision 7 activates these settings for the complete app workflow.** Existing credentials and voice mapping are preserved.

## Audition and recovery

When a preview is requested, the shortest opening prefix with at least two sections and all four speakers becomes a private audition. Assembly pauses at `audio_audition`. The listener checks voices, intelligibility, missing/repeated words and section continuity; `accept_audition` explicitly authorizes continuation within the same allowance. New complete-episode requests default to full recording with an explicit audition waiver; old saved audition plans keep their acceptance checkpoint. Its clips are reused in the full episode, not purchased twice. Final MP3 frame duration must fit the selected profile; no padding or automatic regeneration repairs a duration failure.

Recent request IDs carry continuity (maximum three, two-hour window); bounded adjacent text is the fallback. Response identifiers are saved before consuming the body. Each clip has an owned key, hash, byte size and measured duration. A separate private receipt recovers an uploaded clip after a lost D1 acknowledgement. A saved history-item ID can retrieve a missing body by GET; a request ID is never guessed to be a history-item ID.

Uncertain/interrupted POSTs are **never automatically resubmitted**. Without a recoverable receipt or known history-item ID, the job holds for provider-history/billing inspection. Permission, quota, rate-limit and server failures stop; raw diagnostics and credentials are not exposed. Text/review/voice/model/price/chunk mismatches stop before paid work. Explicit `invalidate_audio` retains the old plan/costs, clears active playback pointers and requires new authorization; unresolved paid operations cannot be invalidated away. A fresh generation ID prevents overwriting old clips or receipts.

Owner-only audio supports full responses, byte/suffix ranges and seeking. Playback checks exact approved-text correspondence even after pricing expires. No agents, conversation logic, research or spoken content were changed.

## Pharmaceutical continuation

[Read-only preflight](pilots/pharma-process-audio-01/preflight.json) records the accepted second pharmaceutical script; its original text pilot and research were not modified.

| Check | Result |
| --- | --- |
| Exact script | 2,119 words; 13,724 characters; 21 turns |
| Speech hash | `bc20ca560ad6db45d3a7a1220fe6f7c389fbb055671abc04aada0191d0d18811` |
| Sections | 10; all within 1,800 characters |
| Audition prefix | First 3 sections; 4,683 spoken characters; all four voices |
| Published-base illustration including context reservation | $0.41464 audition; $1.24192 full episode, not additive |
| Proposed audio allowance | $1.49, not activated |
| Prior/current conservative text allowance | $3.500258125 |
| Text plus proposed maximum audio allowance | $4.990258125 against the original $5 cap |
| Account metadata check | `GET /v1/user/subscription`: HTTP 401, `missing_permissions` |
| Paid audio submissions / audio spend | 0 / $0 |

Provider access stopped at the permission failure. No alternate key, permission change or paid request was attempted. Published-base pricing does not verify this account's allowance, model availability or voice premiums. Offline MP3 fixtures prove mechanics and duration handling, **not** actual voice quality or speech correspondence.

Primary documentation checked on 16 October 2026: [dialogue endpoint/limits](https://elevenlabs.io/docs/api-reference/text-to-dialogue/convert), [API base pricing](https://elevenlabs.io/pricing/api), [history-item audio retrieval](https://elevenlabs.io/docs/api-reference/history/get-audio).

## Verification and remaining action

Tests cover exact speech/voices; changed-input and corrupted-clip holds; budget/character/operation gates; all-four-speaker audition; explicit acceptance and clip reuse; five/fifteen-minute assembly; unknown outcomes; GET/receipt recovery; concurrency and expired leases; provider errors; excessive reported charges; continuity fallback; owner-only playback/ranges; stale-text playback rejection; and actual page controls. The full suite retains V1 regression checks.

[Verification record](pilots/pharma-process-audio-01/verification.json): **197 tests pass**, including 18 new audio/route/UI checks. TypeScript, browser-script syntax, whitespace checks and the verified Worker build pass. Existing Python/CJS experiments were not changed or rerun. Browser QA was skipped because the required browser-control skill was unavailable; no substitute browser path was used.

Resolve metadata access, verify the existing voices/model and account-specific rate, then configure the server snapshot and authorize at most $1.49 within the unchanged combined cap. Create and listen to the audition before accepting the remainder. Task 15 completes only after accepted text/audio correspondence, voices/transitions and measured duration pass. Task 16 remains broader deployment/device/background-playback and rollback verification. Browser and actual audio/device QA were not performed here.

## Live audition follow-up — 16 October 2026

The [five-minute pharmaceutical audition](pilots/pharma-process-audio-01/pharma-process-audition.mp3) now exists and is paused for listener acceptance. The historical HTTP 401 hold above is resolved: the user approved the three metadata/recovery scopes, and saved settings plus successful reads verify access. Four exact premade voices and v4 are available.

The API's dollar rate ($0.08 per 1,000 characters) is verified on the official pricing page and signed-in account's API table. Catalog token factors multiplied by Creative/display-credit conversion are not an API dollar quote. The complete plan reserves $1.241920002 inside the unchanged $1.49 allowance; no key limit was raised. Three POSTs produced the 305.711-second audition; a settled balance read confirms 1,029 units used (about $0.37456 of purchased-credit face value, not an invoice). The first balance snapshot lagged the final response, and both snapshots remain saved.

[Audition verification](pilots/pharma-process-audio-01/audition-verification.json) records MP3 integrity, full ffmpeg decode, all 35 artifact references, exact unchanged source text/research, and 201 passing tests. A targeted regression ensures provider billing units are not mistaken for spoken characters or API dollars. Earlier raw records are retained alongside the documented meter-label correction. Task 15 remains incomplete until the user accepts the voices/transitions, the remaining sections are rendered using these saved clips, and final duration/speech correspondence pass. No production paid-audio enablement was changed.
