# Pharmaceutical process development and chemistry — 15-minute run

> Subsequent editorial review identified factual framing and story-selection issues. Read [the correction record](corrections.md) before using this pilot. The original generated text and machine review below are preserved; they are not a current broadcast-readiness endorsement.

**Complete:** the 15-minute text run reached an accepted text checkpoint on 15 October 2026. The final script has **1,908 words**, about **14–16 minutes** at a calm speaking pace, with an **acceptable** whole-episode review. The conservative allowance is **$1.806268125 of the approved $5**, including the abandoned operation's full reservation; actual billed charges remain unknown. No audio was generated.

[Read the transcript](transcript.md) · [Assessment](assessment.md) · [Measurements](pilot-summary.json) · [Recovery record](recovery-notes.md)

The user approved the $5 ceiling at 7:51:58 p.m. America/New_York, then authorized abandoning the missing source result while retaining its reservation at 8:42:08 p.m. The workspace initially was unavailable, then a local-state interruption stopped source reading. Recovery preserved the original episode and continued with other sources. The original [interruption snapshot](interruption-report.json) remains historical evidence, and the preflight remains the original zero-call preparation record.

The new `fifteen-minute-pilot-v1` profile selects 900 seconds, a 45–60-second introduction and a soft whole-episode target of 1,650–2,100 spoken words. The guest speaking prompt remains version 1.2.0. The intended format is text for editorial assessment; actual spoken duration is unmeasured until audio exists.

The approved invocation from the repository root was:

```bash
node --env-file=.env.local --experimental-strip-types scripts/run-text-pilot.ts --run --minutes 15 --topic 'pharmaceutical process development and chemistry' --ceiling 5 --out docs/pilots/pharma-process-15m-01
```

This command records the original invocation; the run is now complete and should not be regenerated. Recovery used an isolated ignored runtime directory to avoid workspace file replacement, then copied the complete accepted artifacts here. The original job ID, topic, duration and ceiling were retained. `authorization.json` and `recovery-authorization.json` record the two user decisions.

Assess the resulting transcript for distinct intellectual voices, actual responses to available speech, spoken clarity, useful insight and calibrated confidence. Record whole-episode review, word count, estimated spoken duration, usage and any recovery. Keep the earlier firefly transcript unchanged. Neither preflight nor passing mocked checks establishes live dialogue quality.

## Preparation verification

Completed on 15 October 2026, starting from source commit `e585740e214d28d289c5e8782fee14adf4a05e43`.

- Added an explicit 15-minute configuration while retaining the five-minute configuration and default. Mixed profile/length/target combinations are rejected. New runs still require an explicit spending ceiling; audio allocation remains zero. Longer discussion has bounded caps of 128 provider operations, 64 spoken turns and nine optional contribution-request rounds; source-search, evidence and review safeguards are retained.
- Removed conflicting fixed five-minute wording from operational prompts and advanced their prompt versions. Saved framework excerpts are unchanged. Guest dialogue remains on version 1.2.0. Evidence and preparation context now carry the actual selected length. The runner checks the saved duration alongside topic and spending ceiling before resuming.
- `node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts`: **170 passed**, zero failed, skipped or cancelled. Five new checks cover profile consistency and budget gating, durable 15-minute commissioning, downstream request context, zero-call CLI preflight and rejection of unsupported durations. An initial authored fixture attempted to re-prepare an already saved guest note; the existing guard correctly rejected it, and the test was corrected to use fresh preparation state.
- TypeScript checking, the verified five-phase production build and `git diff --check` passed. No dependencies changed.
- The saved topic preflight retains its original null ceiling and zero provider calls. The completed live run and subsequent verification are documented in the assessment above.
