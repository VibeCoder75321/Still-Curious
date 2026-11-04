# Version 2 editing and proportionate review

The [editorial engagement update](editorial-engagement-update.md) extends review to story, insight, voice, interaction and pacing in the existing summary/notes. Material editorial failures use the same bounded correction or hold outcomes; they never authorize invented guest exchanges.

Task 12 turns a closed conversation into an explicitly accepted final script. It preserves the original transcript and uses the existing durable provider/accounting path for editing, review, bounded repair and any consequential source lookup. New episode creation in the interface remains version 1 until Task 13; the measured live text pilot remains Task 14.

## Light editing

`stages/editing.ts` reads the latest closed transcript through the owned artifact reader, including private object storage. Its prompt asks for small improvements to repetition, clarity, transitions and whole-episode length while preserving individual voices, uncertainty and the exchange that actually happened.

The model returns patches, not a replacement dialogue. Each patch names an existing turn and an exact unique substring, its replacement and a reason. Code retains every byte outside that substring, preserves turn order and speaker identity, and rejects unknown/ambiguous targets. Removing a whole turn requires its complete original text. An edit cannot insert a speaker, invent a turn or remove the entire episode.

The saved `edit_report` identifies the untouched original transcript and the edited turns. Later repairs create another immutable report linked to its previous edit and the exact review that requested it.

## Whole-episode judgment

`stages/review.ts` reviews the complete edited episode against the brief, frozen evidence, source passages and any clearly identified post-conversation supplement. It focuses on the central explanation, overall listener impression, memorable stories and striking details.

| Outcome | Behavior |
| --- | --- |
| `acceptable` | Save the specific review and its exact final script atomically, then pause at the text checkpoint. Harmless imprecision and reasonable uncertainty can remain. |
| `acceptable_with_local_edit` | Correct only the flagged passage, then review the changed episode and nearby coherence. |
| `revise_section` | Correct only the affected section, or hold a consequential problem that cannot safely be fixed. |

The prompts do not assign an accuracy percentage, require per-turn factual labels or audit every casual remark. A generic caveat does not cure a materially false central explanation. No outcome routes back to conversation generation.

## Bounded correction

`stages/local-repair.ts` handles both repair modes. Local patches can touch only the issue's named turns. Section patches may also touch their immediate neighbours when a correction needs a coherent nearby response. All other text remains exact. The model can remove an unsupported anecdote; it cannot invent firsthand experience or a new consensus to make the dialogue work.

A successful repair records every issue it claims to resolve and a nearby-coherence check. A separate review then judges the complete revised episode. That review does not accept the repair's own resolved label as approval. If a material issue remains, the edited version and review are held without another automatic rewrite.

A repair may explicitly hold with no patches when the evidence cannot resolve the issue or the necessary change exceeds its boundary. The original exchange remains available. Configured edit, review, local-repair and section-revision caps are enforced before further operations. No failed or held result triggers a blind retry.

## Consequential source lookup

An initial review may identify one exact URL and focused question tied to a material issue. `stages/review-lookup.ts` uses the existing verified source-opening adapter after the conversation. The optional configuration field `maxPostConversationSourceReads` defaults to one and can be zero; the existing overall source-read and spending allowances also apply.

The source must actually be opened at the requested URL to be treated as read. A failed attempt can only record inaccessible coverage and no read passages. The new `review_evidence` artifact retains that exact review/issue, question, source identity, publication metadata, limitations and saved passages.

This supplement does not revise the original source records or frozen evidence pack. It is supplied to the bounded repair and recheck, with exact provenance references. An inaccessible or exhausted lookup does not establish the disputed claim; the issue can remain held. No web access is added to the conversation itself.

## Exact approval and recovery

Only an acceptable review creates the new final script. Its speech is copied directly from that review's exact edited version. `assertFinalScriptApproved(final, review, edit)` checks the specific review/edit versions and exact accepted turns. The optional third argument strengthens this gate while preserving the earlier two-argument contract for saved-v2 compatibility. The future audio connection must read and check all three exact artifacts rather than choose the newest script heuristically.

Repaired issues remain traceable through the edit chain and initial review. A final recheck with no material issues has its own review reference; the final script does not pretend to be approved by an earlier, different review. The job saves an explicit `state.finalScript` and pauses at `ready_for_audio.wait` with the `text_checkpoint` reason. Audio spending is not started by this task.

Each editing, lookup, repair or review operation has its own stable durable key. A queued result resumes by its saved provider response ID and keeps its original reservation. Acceptance saves the new artifacts, usage and next step together. The original conversation and prior edits remain immutable across restart and failure.

## Verification limits

Authored fixtures and mocked providers cover an acceptable episode with minor imprecision, an exact local overstatement correction and an invented firsthand anecdote. They also cover review/repair limits, material holds, rejected changes outside the affected section, pending-response restart, private transcript reads, both read and inaccessible source supplements, and rejected final-script substitution.

These checks establish bounds, traceability and approval behavior. They do not measure live editorial judgment or scientific accuracy; those remain pilot questions. No numerical accuracy target or automatic whole-conversation regeneration is introduced.
