# Complete five- and fifteen-minute episodes in the app

**Current UX:** the [listening library update](listening-library.md) replaces the budget form with a fixed, server-enforced $5 cap and a shared Now Playing section. The original setup below is retained as implementation history.

Enabled 16 October 2026 at the user's request. The current app uses V2 for both selectable durations. Legacy five-minute jobs and playback remain supported. No agents, research prompts, guest prompts, factual safeguards or source interfaces changed.

## User flow

1. Enter a topic and select **5 min** or **15 min**.
2. Enter the total API spending limit. The form starts at $5.00; submitting authorizes that cap. Leaving it blank saves a paused project without provider calls.
3. Reserve audio inside that total (initially $1.50). The remaining amount is allocated to research, writing and review. Neither a preview nor audio is an additional charge outside the total.
4. **Preview voices first** is optional and unchecked. Normal creation automatically hands the exact accepted reviewed script to full audio. The optional preview pauses after the opening includes all four speakers; continuing reuses the saved clips.
5. A completed episode plays in the result panel and Saved episodes, with seek/range playback, speed controls and the sleep timer. Playback requires an explicit play gesture.

**Stop after the script** retains the previous text-only workflow. An existing reviewed script can also generate full audio through its audio form, with an optional voice preview. Previewing remains a useful quality check for new voices, difficult pronunciation or changed delivery; it is not a factual-review substitute or a technical prerequisite.

## Durable authorization and compatibility

A complete episode records `requestedAudio: {allowanceUsd, auditionFirst}`. The initial ledger reserves that amount for audio and divides only the remaining cap among research, text and review. Starting a previously unbudgeted job preserves this allocation. Invalid/non-cent amounts or an audio allowance consuming the total are rejected before creation.

At the accepted text checkpoint, the advance route uses a separate lease to call `authorizeAudio` with the creation request. This makes no provider call. The entire pinned audio plan must fit the explicit allowance and shared episode cap before any audio POST. Text checkpoints for complete episodes retain the active slot during hand-off. Material review holds and uncertain paid operations do not authorize audio.

An explicit full-audio choice pins `auditionRequired: false` and records `auditionWaivedAt`; it does not claim the listener heard or accepted a preview. That choice is part of the plan hash. Existing plans without these fields preserve their previous audition/acceptance requirement and hashes. Explicit invalidation removes the old automatic request and requires a new authorization, retaining previous reservations.

The app API accepts fifteen-minute V2 jobs and passes the selected duration through to the existing profile. V1's creation interface stays five-minute. Authentication, same-origin checks, owner-scoped records/playback, script/version/hash checks, provider-operation bounds, explicit caps, no-duplicate-submission recovery and final duration checks remain enforced.

## Production settings

Environment revision 7 enables `V2_TEXT_PILOT_ENABLED`, `V2_AUDIO_ENABLED`, the v4 model and a dated server-only price snapshot. Existing API keys and the exact four default voice IDs are preserved. The snapshot uses the verified $0.08 per 1,000-character API dollar rate, including the verified absence of custom voice premiums. The code requires price re-verification within 30 days; it does not infer API dollars from display credits. No key quota, subscription, top-up or Site audience was changed.

## Verification

206 TypeScript tests pass. New checks exercise actual creation/control/advance/playback routes for fifteen-minute jobs with both optional-preview settings, audio reservations before and after setting a budget, unchanged caps, four saved clips, valid final duration, private byte-range playback and no regeneration after completion. The existing suite separately covers the research-to-reviewed-text pipeline, factual holds, unknown outcomes, concurrency, V1 compatibility and guest dialogue.

Tests execute the actual shipped browser script against a DOM harness: the 15-minute selection reaches the server payload, full audio is the default, optional audition is explicit, the result becomes playable and speed controls work. Invalid audio/total allocations send no POST. TypeScript, browser-script syntax and whitespace checks pass. The production build is required before publication.

Browser and real-device playback QA are unverified: this environment lacks the required control-browser skill, so no replacement browser path was used. No new paid episode or provider synthesis was submitted during this implementation. The earlier pharmaceutical audition remains its own saved run; this change does not silently regenerate it.

The live HTTP check verified 15-minute server capability and audio enablement, and caught a legacy `public/index.html` overriding the Worker-rendered screen. That obsolete static page was removed; a regression ensures `client/index.html` remains the sole screen source. Publication verification checks the live page for the actual duration and optional-preview controls.
