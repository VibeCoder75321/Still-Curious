# Editorial engagement update — 16 October 2026

The pharmaceutical pilot exposed a selection and interaction problem. Its source excerpts already contained a striking development that did not reach the story or dialogue. Its three guests had different disciplines, but shared a cautious explanatory pattern; one guest appeared only once, and the host mediated every exchange. The listener's ratings are editorial judgments, not numerical acceptance criteria. See the [pilot correction record](pilots/pharma-process-15m-01/corrections.md).

## Production changes

| Area | Implemented behavior |
| --- | --- |
| Commission and research | Seek the central puzzle or consequential development without assuming a breakthrough in advance. Passage selection preserves the decisive development and supported outcome, alongside qualifications. Research receives the stable episode request timestamp; historical status is distinguished from webpage updates, with relevant later work prioritised within existing allowances. |
| Evidence selection | Lead the existing common briefing with the strongest verified thread and its claim/story IDs. Select a revealing mechanism when no documented discovery story exists. Distinguish established outcomes, inference, genuinely open questions and information this pack has not investigated. |
| Cast and preparation | Use existing intellectual tendencies, methods and confidence style to specify what each guest notices first, pursues and explains. Prepare a selected contribution to the central puzzle, not a spoken recital of all evidential checks. Host preparation identifies a useful entry and possible return for each specialist. |
| Conversation | Shorten host framing to one live question; favour a direct handoff when another guest can develop an actual point. Guests may respond concisely or ask a useful follow-up grounded in supplied speech. Supported conclusions can be stated plainly; repeated limitations need a new reason. |
| Editing and review | Evaluate story payoff, memorable insight, voice, meaningful interaction and pacing in the existing summary/notes. Cut redundant framing and caveats without inventing speech. Modest weaknesses remain notes; material failures use existing bounded corrections or a hold. An absent exchange cannot be manufactured by editing. |

## Participation context

`conversation-observations.ts` derives counts from the exact accepted speech: guest turns and words, last turn, other guest turns since their last appearance, guests not yet heard, host words and adjacent turns by different guests. An absent guest's gap counts all accepted guest turns so far. Silent control operations are not spoken turns.

The host receives these observations alongside the full transcript. They highlight a guest who has not entered or has disappeared while others continue; the host must inspect the words to assess substance. No threshold automatically chooses a speaker, forces an interruption, prevents a necessary ending or changes the budget. An addressed guest's owed response and the existing closure rules retain priority. Direct yields use the existing host action and specific `pointToAddress`; optional bidding still consumes its normal bounded operations.

Editing receives observations of accepted speech. Review receives freshly calculated observations of the edited version, so cuts cannot leave stale participation counts. Adjacency is explicitly a structural observation, not proof of responsive engagement. The five editorial notes require concrete evidence from the exchange; they do not assign scores or demand equal airtime.

## Compatibility and bounds

The four on-air characters, stage order, floor-routing reducers, output schemas, source traceability, frozen evidence, private preparation boundaries, turn limits and financial allocations are unchanged. Every guest and bidder still sees only their own private preparation plus shared evidence and exact accepted dialogue. The host sees all preparations. No new model stage, automatic research round, compulsory bid or regeneration loop is added.

Known preparation prompt revisions 1.0.0, 1.1.0 and 1.2.0 share the same artifact schemas and remain readable. The compatibility list is explicit: unknown versions and mismatched prompt identities still block, and exact evidence/cast/input references and hashes remain checked. Completed artifacts are not retroactively regenerated. An unfinished operation with a changed request fingerprint still holds rather than submitting a replacement request.

New operations record host/guest prompt 1.3.0; producer, discovery, source reading, evidence, casting, guest/host preparation, editing and review 1.2.0; contribution requests and local repair 1.1.0. Exact historical framework excerpts and their source hashes are unchanged.

## Verification

- All 179 regression tests pass, including four new cases covering absent/returning guest observations, host-only participation context, compatible saved preparations with future-version rejection, and an editorial hold using counts from edited speech without creating new turns.
- TypeScript checking, the verified five-phase production build and whitespace checks passed. No dependencies changed. No interface layout changed; browser or audio playback verification was not performed.
- No paid episode or audio generation was performed. The existing pharmaceutical run remains within its original $5 cap, with no additional pilot provider operations.

These checks establish context delivery, routing compatibility and bounded review behavior. They do not prove that a model selects a better story, follows the new guidance, or produces more natural audio. A subsequent live pilot should be judged for a delivered central payoff, meaningful participation from all three guests, direct engagement with actual contributions and appropriate confidence. The original pilot remains an auditable baseline with an explicit correction notice, not evidence that these changes have already succeeded.
