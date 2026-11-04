# Dialogue, storytelling and the Extra High guest update

16 October 2026. The user requested stronger guest reasoning and asked what creative practitioners have learned about engaging dialogue that stays on topic.

## Implemented settings change

New episodes use GPT-6.1 Sol at Extra High (`xhigh`) for both `guest_preparation` and `guest`. Their existing 8,192 maximum output tokens, including reasoning, stay in place; Extra High does not implicitly double that allowance. Producer, evidence synthesis and final review already use Extra High. The host remains Medium. No prompt, output schema, stage, agent count, routing logic, length constraint, provider credential or audience is changed.

`createTextPilot` saves a complete model policy when creating the job; `createPodcast` uses the same constructor. The runner and provider adapter honor a saved policy. Earlier episodes therefore keep their recorded settings, completed work and recovery fingerprints rather than silently changing mid-conversation. New jobs receive the new guest defaults. The $5 app ceiling, separate audio reserve, reservations before paid submission and uncertain-result holds remain in force.

OpenAI's [Sol model documentation](https://developers.openai.com/api/docs/models/gpt-6.1-sol) supports `high` and `xhigh` at the same Standard token rates. [Reasoning documentation](https://developers.openai.com/api/docs/guides/reasoning) explains that reasoning tokens are billable output and recommends evaluating whether higher effort earns its cost. Extra High is not a demonstrated improvement in podcast storytelling.

## Primary sources and lessons

These are sources about production practice and creative systems, not evidence that a specific prompt or reasoning setting improves this app.

1. **Ira Glass, [Transom Manifesto](https://transom.org/2004/ira-glass/) (2004).** Glass describes a radio story as concrete events and reflection on their meaning. He also describes retelling a draft aloud and pruning material that weakens its central idea. Application here: return from an abstract explanation to a documented development or a revealing mechanism, then explain its consequence. Fictional specialists cannot acquire invented experiences, quotes or research history to supply a narrative.
2. **Rob Rosenthal, [Tips to Elevate Your Reporting and Storytelling from Ira Glass](https://transom.org/2024/tips-to-elevate-your-reporting-and-storytelling-from-ira-glass/) (2024).** Rosenthal discusses varying predictable narrator/quote patterns, retaining a question and its responsive answer, and giving sections a clear focus. Application here: use an actual guest observation for a direct handoff when another perspective adds understanding. Do not manufacture interaction by alternating labels, inserting agreement or forcing every guest to ask questions.
3. **Mirowski, Mathewson, Pittman and Evans, [Co-Writing Screenplays and Theatre Scripts with Language Models](https://arxiv.org/abs/2209.14958), published at CHI 2023; [creator documentation](https://github.com/google-deepmind/dramatron).** Dramatron uses hierarchical context from an overall premise through characters and story structure to dialogue. Fifteen industry professionals co-wrote with the system. The creators explicitly distinguish this from autonomous writing and report formulaic outputs and substantial human editing. Application here: keep the shared listener question and supported development available as local exchanges unfold, while allowing the participants to discover the route through them. This is an inference for nonfiction discussion, not a podcast benchmark or a reason to import fictional plot formulas.

## What the current pipeline already does

| Production principle | Existing implementation | Useful check on the next episode |
| --- | --- | --- |
| Keep a central listener question and payoff | Producer commission, evidence common briefing and host preparation prioritize the strongest verified puzzle. | Can a listener name the question and what became clearer? Does the ending deliver the opening promise? |
| Connect concrete developments with explanation | Evidence stories preserve supported events; guests select revealing mechanisms and practical implications. | Does an explanation make a documented detail more meaningful, or merely add facts? When history is thin, does the mechanism carry the interest? |
| Make the next contribution respond to this conversation | Host and guests receive the exact accepted transcript; direct yields and a specific point to address are already supported. | Identify exchanges where a guest refines or extends another's actual point. Adjacent guest turns and speaker counts alone do not establish interaction. |
| Keep each expert's way of thinking distinct | Cast and private preparation specify intellectual instincts; guest prompts preserve them. | Without labels, can a listener distinguish what each guest notices and how they explain it? |
| Keep digressions useful and bounded | Host state includes the current topic, unresolved questions and a detour return point. | Does a detour change the listener's understanding of the main question? Return or stop when it no longer does. |
| Edit for a listener hearing it once | Editing and whole-episode review already assess payoff, insight, voice, interaction and pacing. | Remove redundant setup and repeated caution; retain qualifications that materially change the account. Do not require an accuracy percentage or regenerate a satisfactory episode. |

The production lesson is selective material, responsive listening and editorial judgment. Adding another long list of naturalness instructions would largely repeat what is already supplied. This update changes guest effort only; it does not claim that the existing prompts reliably achieve their aims.

## Cost interpretation and next useful comparison

The latest 15-minute research-reuse pilot records $0.4534355 for eleven guest contributions, including 7,270 reasoning tokens, and $0.1200405 for three guest preparations, including 2,177 reasoning tokens. At the saved and currently verified $10 per million Sol output tokens, doubling their combined reasoning adds $0.09447; tripling adds $0.18894, holding input, visible output and other operations constant. Those are scenarios, not measured Extra High multipliers or invoices. Rendering similar-length speech uses the same Eleven v4 rate.

A useful subsequent comparison would use the same verified research, personas and task context, compare High against Extra High without changing host or editing settings, and assess distinct voices, responsive exchanges, conceptual payoff, topical focus, runtime and logged cost. An independent frozen-context guest comparison isolates response differences; a whole-episode comparison also exposes changes in the conversation path and cannot perfectly isolate their cause. Read the scripts before paying to render audio. A later host-effort comparison should be separate. No paid episode or audio generation was requested or performed for this configuration update.

## Verification

All 39 focused provider, preparation, conversation and complete-audio route checks pass using offline fixtures, including the actual outgoing Extra High guest request and the existing cap enforcement. TypeScript and whitespace checks pass. A no-network constructor check confirms both new episode lengths use Extra High guests with a $5 ceiling and $1.50 protected audio reserve; decoding the saved pharmaceutical pilot retains High for its guest settings. Packaging requires the production build. No listener-quality comparison is claimed by these configuration and integration checks.

## Follow-up: incorporate the production lessons

16 October 2026, after the settings-only update above. The user requested implementation within the existing provider setup and declined a Claude switch.

[PodBench](https://arxiv.org/html/2601.14903v1) separates instruction adherence from podcast script quality, assessing content substance, narrative engagement and conversational naturalness. This informs our review dimensions; we have not run its benchmark, imported its scoring thresholds or established that these changes improve listener ratings. Its published model comparison does not settle the choice among the current models.

### Changes in the running pipeline

- **Host preparation 1.3.0:** the existing `priorities` strings now form a compact listening plan: central Question, supported Payoff, a few Developments linked to saved evidence IDs, and Optional material to drop. These are production notes, not spoken labels or a rigid plot. `returnPoint` and `endingAim` keep the inquiry focused. The original schema and limits remain intact.
- **Host 1.4.0:** use accepted speech to assess what is already explained and what useful step remains. The existing `purpose` records that next editorial intention, with the relevant turn ID when following a contribution. Keep unresolved questions current. Allow a short clarification, consequence or direct guest handoff instead of resetting to a broad interview question. No new counters, quotas, calls or hidden reasoning fields.
- **Guest 1.4.0:** connect a selected detail to its explanatory meaning. When a point is established, add the specialist's next useful insight instead of another recap. Perspective comes from the existing profile and private preparation. References to others still require their actual accepted words.
- **Editing 1.3.0 and review 1.3.0:** compare the intended question/payoff with the delivered exchange; a better supported route discovered during conversation is welcome. Preserve short responsive exchanges and the explanatory details that matter. Review distinguishes factual soundness from listening quality and grounds its existing Story, Insight, Voices, Interaction and Pacing notes in actual turns or omissions. Minor stylistic weaknesses remain nonblocking.

### Context and provenance

Post-production now receives a compact `narrativePlan` projection from the exact host-plan reference pinned in the accepted transcript's provenance, not whichever plan is newest. Editing, review and bounded repair include this reference in their own recorded inputs. The projection includes priorities, return point and ending aim; private guest notes and planned answers are not added. An unavailable or mismatched pinned plan blocks before a provider call. Legacy transcripts without a pinned plan remain reviewable, with `narrativePlan: null` and the episode brief as context.

Host-preparation versions 1.0–1.3 remain readable because their output schema is unchanged. Other prompt versions are incremented for provenance. Post-production context is versioned `post-production-2`. Existing episode artifacts and audio are not rewritten. Source evidence still governs claims; a narrative plan or routing intention is never proof that a guest delivered an insight.

### Scope, cost and verification

Models and effort remain unchanged, including Sol Extra High guest preparation/dialogue. The four speaking identities, independent guest contexts, routing rules, output schemas, duration controls, bounded repairs, audio workflow and $5 ceiling with protected audio reserve remain in place. There is no extra model pass or automatic full-episode regeneration. Slightly expanded prompts and post-production context can add input tokens within the existing reservation and cap checks; this is not a claim of identical cost.

Offline verification covers the plan reaching both editor and reviewer with recorded provenance, pinned-plan selection over newer versions, legacy behavior, mismatched foundations, historical preparation compatibility, independent guest contexts, bounded repair/recheck, and the 15-minute app-to-audio flow. Tests exercise plumbing and safeguards, not generated storytelling quality. A subsequent episode needs editorial listening to establish whether the changes produce a better conversation. No paid generation is part of this implementation.

All 42 focused checks pass (`episode-v2-editorial`, `episode-v2-preparation`, `episode-v2-conversation`, `episode-v2-post-production`, and `episode-v2-audio-routes`), as do TypeScript and whitespace checks. Publication runs the production build. No interface layout changed; browser QA was not performed.
