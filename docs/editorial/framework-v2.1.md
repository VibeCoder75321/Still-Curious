# Still Curious Podcast Production Framework

Proposal for research preparation and an adaptive four person conversation

Version 2.1 • 15 October 2026

We should build an editorial production process around four independently prompted speakers. The preparation establishes what the episode is trying to understand, what the evidence supports, and who is in the room. The conversation then develops through the speakers' actual responses. The host has a destination and a sense of time, but freedom to change the route.

The aim is a thoughtful science discussion that feels inhabited: people with expertise, preferences, doubts, a sense of humour, and something they particularly want the listener to understand. A good guest can tell a story, explain a mechanism, question an assumption, and admit uncertainty. We should never reduce those abilities to separate jobs assigned to three interchangeable voices.

This proposal defines the editorial decisions, research artifacts, guest preparation, conversation loop, and review process. It includes working prompts and a small example. It is the proposed next architecture; the last delivered MVP uses one writer with flexible turn lengths.

## 1 The experience we are making

The listener is getting into bed and wants something mildly absorbing. They may offer a precise question, a broad subject, or an observation that caught their attention. The episode should reward that curiosity without requiring a screen, specialist knowledge, or sustained effort to untangle unexplained jargon. Calmness comes from a capable host and a clear thread, not from removing difficulty or personality.

The broad inspiration is the prepared academic conversation described in the original programme brief: one informed generalist and three knowledgeable guests, substantial ideas, accessible explanations, useful disagreement, restrained warmth, and curiosity about how knowledge developed. We are designing an original production system, not reproducing a named presenter's identity or claiming access to the BBC's internal production process.

For a full episode, preserve the approximately one-minute opening, the room for a sustained discussion, and the concise ending. The selected duration overrides the original 40–45-minute default. A five-minute episode is a miniature discussion of one question; it cannot offer the same breadth with every section compressed equally. For the five-minute pilot, use a shorter opening of roughly 20–30 seconds so the introductions do not consume a fifth of the discussion. There is no mandatory number of jokes, disagreements, tangents, or words per contribution.

The speakers are fictional AI characters with PhD-level domain preparation, not actual interviewed academics. Their expertise should be evident in their thinking. The app should identify the format clearly; biographies must not invent real university appointments, publications, or personal participation in discoveries.

### The production team

| Function | Main responsibility | Durable output |
| --- | --- | --- |
| Editorial producer | Understand the listener and commission a focused episode | Episode brief and research commission |
| Research desk | Find, read, compare and qualify evidence | Shared evidence pack |
| Casting producer | Assemble three credible people who will be interesting together | Individual guest profiles |
| Guest preparation | Each guest develops a position and selects material independently | Three preparation notes |
| Host | Listen, probe, invite, redirect and conclude | Spoken contributions and editorial decisions |
| Floor manager | Route turns, preserve state and enforce resource limits | Conversation log and show state |
| Editor and reviewer | Shape the listening experience and assess the final episode | Finished dialogue and review decision |

These are responsibilities, not seven permanently running agents. Several preparation tasks can use the same model in separate calls. Distinct agent roles do not, by themselves, provide independent scientific confirmation. The four on-air characters need distinct instructions and preparation. The floor manager is mostly ordinary application code. Editing and final episode review use separate passes.

## 2 Turning a request into an episode commission

The editorial producer begins with the user's exact wording. It separates explicit preferences from reasonable inferences. “Why do some fireflies flash together?” is a request about coordination; it should not become a general insect episode with synchronisation squeezed into the final minute. Conversely, a narrow question may require a small amount of background before an answer makes sense.

The producer expands the question into a map of what a listener needs to understand, then narrows that map into a promise that fits the duration. Expansion identifies the context, prerequisites, mechanisms, history, evidence, alternative interpretations and implications. Selection decides which of these actually earns time in this episode. A complete picture means sufficient context for the listener's question, not an exhaustive survey of a field.

Keep a brief with the original request; the inferred main curiosity and confidence in that inference; one central question; the listener's likely starting knowledge; the understanding promised by the end; essential foundations; the main area for deeper treatment; scope exclusions; useful secondary questions; and the chosen duration and atmosphere. Record any premise that research needs to check rather than accepting it as fact.

For an ordinary bedtime request, make a sensible choice and proceed. Ask a clarification only when different interpretations would produce materially different episodes. Do not turn a casual request into a questionnaire. A possible interpretation should never silently become a claim about the user's beliefs or personal circumstances.

### A running example

User request: “How do fireflies make light? I'm especially curious about how some of them flash together. About 15 minutes.”

The main interest is how individual animals produce a collective pattern. The episode needs enough context about a flash and its biological purpose to make that question meaningful. The deeper discussion should concern coordination and how researchers distinguish possible explanations.

Proposed listener promise: “By the end, you will understand the difference between making a flash, responding to another flash, and explaining a shared rhythm—and why those are different scientific questions.” This is a commissioning goal, not a conclusion reached before research.

A provisional allocation might devote roughly a quarter of the discussion to orientation and foundations, most of the remainder to the user's specific interest, and a short ending to implications and uncertainty. Those proportions are editable planning guides. A particularly revealing experiment may justify a different shape.

### What the researcher is asked to investigate

The research commission should contain questions and evidence requirements, not instructions to prove a preferred answer. For the example, it would ask: What produces the light? Which species and circumstances are relevant to synchronisation? What has actually been observed? Which mechanisms or models have been proposed? What evidence discriminates between them? What do terms such as “together,” “leader” and “rhythm” conceal? Which documented experiment or observation could make the explanation memorable?

It also asks what the episode should avoid: generalising one species to all fireflies, treating a model's success as proof of a biological mechanism, substituting a charming origin story for reliable history, or presenting a disputed explanation as settled. The commission includes the original question so that the researcher can correct an overly narrow interpretation by the producer.

The result is an editable editorial brief followed by a research commission. The running order is drafted only after enough evidence has been assembled to know what story can honestly be told.

## 3 Building a research pack that can support conversation

Start with one research lead. Add a second researcher when the subject contains meaningful controversy, several disciplines, or enough scope to justify independent coverage. Assign research questions, not preselected sides in a debate. One lane might establish the best-supported account while another tests its limits and searches for contrary evidence. Both must be free to find agreement.

Research proceeds from discovery to reading, extraction, comparison and synthesis. Search results identify candidate sources. Researchers then read the relevant source material and record exactly what was available. An abstract can support a limited statement about what a paper reports; it cannot support unexamined details from its methods or results. Inaccessible material stays marked as inaccessible.

Use different source types for different purposes. Primary studies support statements about what was measured. Reviews help establish the wider state of a field. Historical scholarship and original records support accounts of discovery. First-person scientific commentary can supply an interpretation or a documented story, identified as such. Strong sources can disagree; different websites can also repeat the same original study. Track the underlying evidence family rather than counting links as independent corroboration.

Check publication status, corrections, retractions and later work where these affect a central claim. Preserve dates, units, populations or species, study conditions, uncertainty, and the distinction between correlation, causation, simulation and direct observation. The researcher must seek the strongest serious counterargument to an attractive explanation and record whether it changes the conclusion.

### Contents of the evidence pack

| Item | What it stores | Why the speakers need it |
| --- | --- | --- |
| Topic map | Definitions, prerequisites and relationships between questions | Enough shared context to understand each other |
| Source records | Author, date, source type, stable URL or DOI, status, reading coverage and evidence family | Traceability and source independence |
| Claim records | A precise claim, supporting passages and locators, qualifications and support status | A common factual basis |
| Interpretations | A proposition, who advances it, its evidence, strongest objection and current standing | Substantive opinions and disagreement |
| Story material | Verified observations, experiments, historical details and attributable quotations | Concrete material worth hearing |
| Open questions | What remains unresolved and what evidence would help | Honest uncertainty and productive follow-ups |
| Limits | Unsupported claims, tempting overstatements and unavailable evidence | Protection against a compelling but false story |

Save the source passages and their locators alongside the concise summaries. Each claim receives a stable ID. A claim can be well supported, provisional, contested, contradicted or outside the material read. These are editorial judgments with stated reasons, not numerical confidence scores invented by a model. The pack is versioned so later corrections can be traced into the dialogue.

An interpretation record separates a measured result from an explanation of it. It includes the evidence that makes the interpretation plausible, the best challenge to it, and what observation would change the assessment. The system should not require three different views when the literature supports one account. Useful differences can concern explanatory emphasis, scale, method, interpretation or the limits of an analogy.

A story record should preserve what makes an event interesting: the puzzle, what was attempted, what was observed and what changed. It also states which details are documented. Missing weather, dialogue, emotions or personal experiences are not invitations to invent them. A hypothetical illustration is allowed when clearly framed as hypothetical and scientifically supported.

Research is ready when it can support the central question, its essential foundations, the important qualifications, and enough concrete material for the selected duration. If the evidence is thin, narrow the scope, make a targeted research request, or acknowledge the limit. Do not fill the remaining time with stronger claims or manufactured controversy.

## 4 Casting people rather than assigning speaking functions

Choose expertise after examining the topic and its real intellectual tensions. The three guests need enough overlap to understand, question and surprise one another. Their differences should matter, but each must be capable of explanation, storytelling, criticism and uncertainty. “The historian,” “the storyteller” and “the sceptic” are insufficient character designs.

A guest profile has two layers. The enduring layer contains temperament, humour, confidence, patience, conversational habits and intellectual taste. The episode-specific layer contains relevant expertise, source familiarity, current positions, interesting examples, limitations and likely points of overlap with the other guests. A recurring guest keeps a plausible disciplinary identity; we do not give the same character an unrelated doctorate every night.

Useful profile fields include the questions this person instinctively asks; the methods they tend to trust; explanations they find satisfying; where their preferences can mislead them; what they are confident about; what they readily concede; what they find delightful or irritating; and how they respond when challenged. Avoid a rigid personality score or a catchphrase that appears every few turns.

Bias here means an intellectual tendency that can be examined. A modeller might favour a simple general explanation. A field scientist might suspect that a tidy model omits a consequential detail. Either can be right, either can overreach, and either can change their mind. Neither receives permission to distort the evidence or to maintain a false claim for dramatic effect.

### Example guest profiles for the firefly commission

Mara Vale studies insect behaviour and sensory communication. She is animated by the question of what an animal can actually perceive. She likes concrete scenes and will happily tell the story of an experiment, but she becomes exacting when an analogy makes an insect sound too human. She tends to privilege behavioural detail and may initially underappreciate the explanatory reach of a simple model. She is willing to concede when a model yields a useful test. Her warmth comes through curiosity, not constant agreement.

Elias Chen works on collective behaviour and mathematical models. He enjoys stripping a problem down to the few ingredients needed to make a pattern appear. His humour is dry; he can be enthusiastic about an elegant result and impatient with a long catalogue of details that have no demonstrated consequence. His vulnerability is mistaking a successful simplification for a complete explanation. He will accept a complication when another guest shows what it changes. He can tell a good story about an experimental surprise as readily as Mara can.

Noor Shah studies ecological behaviour and field measurement. She is attentive to variation between settings and to how instruments shape what can be observed. She speaks reflectively, then becomes brisk when a claim outruns the observations. She enjoys a clever theoretical account but asks how it could fail. Her tendency is to accumulate qualifications until the main result becomes hard to see. She appreciates being asked to state what she does think the evidence establishes.

All three are fictional examples. Their scientific positions would be developed from the actual research pack. The casting producer should not fabricate a dispute between them or assign a conclusion simply because it suits a personality.

### What each person receives

The evidence editor freezes a numbered research version before guest preparation. Everyone receives a short common briefing containing the central question, essential definitions, best-supported findings, important uncertainties and material counterevidence. Each guest also receives selected source passages relevant to their expertise, with links back to the complete pack. A retrieval request can bring any other passage into their context.

The host receives that common briefing, the guests' concise preparation notes and an editorial map of promising questions. During the conversation, guests receive their own notes and the public transcript. They learn one another's positions through what is said. The reviewer receives the complete pack and the finished dialogue afterward. The preparation supplies a common foundation without asking the speakers to verify one another sentence by sentence.

### Independent preparation and the equivalent of a pre interview

Give every guest the same core account, important uncertainties and strongest counterevidence. Add a deeper reading bundle relevant to their expertise. All guests may consult the complete pack; different preparation must not be achieved by hiding inconvenient evidence from one of them.

Each guest prepares separately before seeing the others' position notes. Ask for a concise thesis, supporting evidence, qualifications, a favourite supported example, one issue on which they expect reasonable disagreement, and what would change their view. These are short editorial notes, not a request for hidden reasoning or a prewritten speech.

The producer then conducts a short preparation pass: What do you most want the listener to grasp? Where do popular explanations go wrong? What is your most useful story? Which question would make you reconsider your emphasis? The host receives the useful answers and a map of potential tensions. The guests do not receive a predetermined list of each other's forthcoming lines.

An interesting guest is allowed to arrive without a provocative opinion. “I think the question is being framed at the wrong scale” can be more useful than taking the opposite side of a familiar debate. The preparation process should discover positions that the evidence can sustain, rather than manufacture positions to fill a panel.

## 5 Preparing a host who can actually listen

The host is a prepared generalist with authority over the conversation and responsibility to the listener. The host knows enough to notice an evasion, a missing definition or an interesting consequence. Preparation gives the host a repertoire of questions and return points; it does not require reading a fixed question list in order.

The host's brief contains the listener promise; the few ideas that must become clear; the guests' strengths and likely disagreements; a pool of entry questions, clarifications and challenges; possible worthwhile detours; and an ending that can be reached from several routes. The host should know which planned material can be dropped if a better conversation develops.

At each meaningful transition, the host asks: Did that answer the question? What did the answer make newly interesting or difficult? What does the listener need before we proceed? Who in this room is best placed to respond? Is the current thread paying for the time it takes? These are judgments, not an audible checklist.

The host may press a guest, express surprise, ask the same question more plainly, or interrupt a digression. The prickliness should be earned by something that happened in the discussion. It should target vagueness, evasion or loss of focus rather than become a recurring performance of irritation.

Possible lines include: “Hang on. What is the thing we would actually measure?” “That's an attractive explanation. What would count against it?” “You've given us three qualifications. What do you think we can safely say?” Or, when needed: “I want to stop you there, because we've lost the question we began with.” These are examples of functions, not stock lines to repeat.

The host can also recognise a worthwhile tangent: “That seems worth staying with for a moment. What did the observation change?” The host then remembers the route back. A brief detour can reveal why an idea matters; a sequence of unclosed detours leaves the listener doing the producer's work.

The host need not speak between every pair of guests. When a guest has something useful to add to another's explanation, the host can silently yield the floor. A direct exchange can run for several turns while it remains intelligible and productive. The host returns when clarification, reframing or movement is useful.

## 6 Orchestrating an actual exchange

The floor manager maintains the canonical transcript, speaker identities, current research version, current topic, unresolved questions, detour return point, rough duration, remaining budget and next speaker. It does not invent dialogue or make a scientific disagreement disappear. The host makes editorial choices; code routes and records them.

Each speaking agent receives its own profile and preparation notes, the shared evidence it needs, the exact recent conversation, and the specific question or contribution it is answering. For a short episode, retaining the entire conversation is practical. For longer episodes, retain recent exchanges verbatim, the exact earlier statements being referenced, and a compact record of established points, unresolved disagreements and commitments. Retrieve older turns when a speaker wants to refer to them. A rolling summary must not silently alter an opinion.

### The turn cycle

1. The host opens the episode, establishes the question, introduces the guests economically and addresses a first question to a particular person.

2. The selected guest responds to that question in the context of what has actually been said. The response may answer, qualify, tell a supported story or say that the evidence does not settle the point.

3. The floor manager saves the exact contribution and who said it. This lets the next speaker hear the same exchange and allows an interrupted job to resume without inventing or repeating a turn. It does not judge the scientific accuracy of each sentence as the conversation unfolds.

4. The host decides whether to follow up, invite a direct response, let a useful exchange continue, clarify, redirect, explore a detour or close. The decision can be silent: handing the floor to another guest does not require an extra spoken host sentence.

5. When the context invites it, the other guests may submit brief requests to contribute: a correction, a genuinely different interpretation, a necessary qualification or an illuminating example. The host chooses whether to accept one. Do not generate complete competing answers from all three guests after every turn.

6. The next speaker sees the accepted transcript, not rejected alternatives, and reacts to it. Update the show state and repeat until the listener promise has been met or the remaining time calls for a concise ending.

The host's control response can contain an optional spoken line, the next speaker, the conversational purpose, the point to address, and any question being parked or resumed. A guest's response contains its spoken words and any brief change in its position. These control fields stay out of the audio.

A guest may change or qualify a previous view. Save that as a concise stance update so future turns reflect it. A direct correction should affect later discussion; the system must not return to an obsolete claim because it remains in a character's original preparation notes.

### Giving guests a genuine opportunity to respond

The speaking guest is the sole author of that guest's contribution. The host can ask, challenge or choose who speaks next; it cannot supply a guest's answer or secretly decide the conclusion that answer must reach.

When a guest is addressed or challenged, offer that guest the next opportunity to answer unless the host first needs to clarify something. At a substantive transition, the floor manager can ask the two listening guests for a short contribution request based on the latest accepted exchange. A request names the point it would add: perhaps a correction, a different interpretation, an example or a qualification. Passing is normal. These are separate guest judgments, not opinions invented on their behalf by the host.

The host reads the requests and may accept one, park it, or move on. The selected guest then writes its actual words after seeing the latest transcript. A parked request is reconsidered against the current discussion before use. This gives guests initiative without paying for three unused full answers at every step. The pilot should measure how often these invitations improve the conversation and how much they cost.

For example, after Elias proposes a mechanism, Mara may request the floor because the proposal assumes a particular sensory ability. The host silently yields to Mara. Elias hears her objection and answers it; Noor suggests an experiment that could test the revised claim. The host returns when the listener needs a definition or a clear account of what changed. Each line has a speaker, an antecedent and a reason to exist.

### Interruptions and rabbit holes

For the first version, generate at complete thought boundaries and let the host stop a long explanation before inviting a continuation. Do not impose an identical word count on every turn. This gives the host practical opportunities to intervene without pretending the system already supports real-time overlapping audio. More natural interruption and overlap can be an audio-stage experiment later.

A detour is worth taking when it answers a live listener question, makes a difficult idea concrete, reveals a consequential uncertainty, or produces a strong intellectual payoff. It also needs adequate evidence, enough remaining time, and a route back. The host can allow one example or one exchange, then decide again. These are soft editorial limits; a productive detour may replace a less valuable planned beat.

If a tangent reaches beyond the prepared material, the speakers can do what thoughtful experts do in conversation: say what they think, qualify a recollection, or disagree about how far a conclusion goes. Reasonable disagreements can remain unresolved. The host can ask what each view would predict and return to the main question when the exchange has paid off. The producer reviews the finished discussion afterward; there is no research interruption during the exchange.

Near the end, the host closes unresolved threads that matter to the original question, distinguishes conclusions from remaining uncertainty, and thanks the guests. A short episode should make fewer promises; it should not end halfway through a necessary explanation because the agents spent their time performing disagreement.

## 7 A small example of the conversation mechanics

This illustrative exchange shows personalities and routing. It is about how one would test an explanation, rather than a finished factual account of firefly synchronisation.

Host: “Elias, suppose several insects flash together. Why isn't that already evidence that they're responding to one another?”

Elias: “It is evidence worth pursuing. But a shared pattern doesn't, by itself, tell you how it arose. I would want a model that makes a prediction we can test.”

Mara: “And I would want to know what the animals could see. You can build a very elegant model around an interaction they aren't actually able to have.”

Elias: “Fair. That detail matters to my model if it changes a prediction. Otherwise we've added realism without learning whether it matters.”

Noor: “That gives us a useful experiment to look for. Change what one animal can see and ask whether the pattern changes. Although we'd have to be careful about what else the intervention changes.”

Host: “Hold on. Before we design the whole experiment, what's the one observation that would distinguish your explanations?”

The host now invites Noor to make the test concrete. This exchange did not require a historian to supply history or a designated storyteller to supply a story. Different intellectual preferences created a substantive question, and the host made it accessible.

Later, if a sourced observation opens an interesting side question, the host can follow it: “Let's stay with that. Why was it surprising?” The return point remains recorded. After the useful detail: “So that changes how we interpret the observation. Now, back to the shared rhythm.” The transition should reflect what the detour actually established.

## 8 Editing and factual review

First make a light editorial pass for repetition, clarity, pacing and the listener promise. Preserve substantive replies, individual rhythms, useful uncertainty and moments when someone changes their mind. An editor who rewrites the whole conversation into smooth uniform prose defeats the point of generating separate speakers.

Review the finished discussion as a whole. Does it answer the listener's question fairly? Are its main explanations, memorable stories and stated uncertainties consistent with the research? Does any confident claim give a materially misleading impression? Use the evidence pack to check the central points and any surprising specifics. The aim is a sound educational episode, not a score for the percentage of sentences verified.

If the episode is acceptable overall, approve it for audio. The reviewer may note minor imprecision or an open disagreement without forcing a perfectly tidy conclusion. If a central explanation is wrong, an anecdote is invented, or a qualification changes the answer, identify that specific passage and make a local correction. A second model's agreement is not evidence; check the relevant source when the point matters.

Keep any correction small enough to preserve the speakers' exchange. If one changed line makes the next reply incoherent, repair that nearby exchange and read it again. There is no reason to rerun the entire conversation because of a local error. An episode whose central account remains materially wrong needs a new draft of the affected section before audio.

Only the final spoken text goes to the voice engine. Keep source notes, routing instructions and private preparation out of the audio. Preserve the difference between a warm delivery and an exaggerated performance: no compulsory laughter, filler, whispered asides or dramatic disagreement. Evaluate the script and the voice performance separately.

## 9 Keeping the system manageable

The first experiment should implement one five-minute conversation using a deliberately small research pack, three prepared guest profiles and a host. It should preserve the existing audio and storage path. Longer episodes can follow after we know that the speakers respond meaningfully, the host closes threads, and the finished dialogue survives factual review.

Use strong reasoning for the editorial interpretation, evidence synthesis and difficult factual review. Routine extraction, formatting and bookkeeping can use cheaper calls or code. Speaker turns need enough capability to sustain character and understand evidence, but every brief reply does not automatically need the maximum reasoning setting. These assignments are candidates for testing, not established performance rankings.

Control cost through total context, reasoning, research calls and bounded rounds. Keep shared material reusable; retrieve relevant passages instead of resending every document; combine a host's spoken contribution with its routing decision; and request guest contribution bids only when useful. Separate agents cost more mainly because they repeatedly consume context and perform reasoning. Their exact overhead has not been measured in this app.

The previous cost ranges were planning allowances. They should not become subscription pricing until actual research, conversation, editing, review and voice usage are logged. Compare versions using the same topic, evidence pack, length and audio settings. Count successful listening experiences, not just cheap completed requests.

Save the episode brief, research commission, source records, claim and interpretation records, guest profiles and preparation notes, running order, accepted transcript, host decisions, stance changes, review findings and final dialogue. Each stage needs a version and a clear status. Resume from the last completed artifact without silently repeating paid work. Cancellation and a concrete spending limit should be enforced before starting another request.

### Production state and release decisions

Store each episode as a sequence of completed stages: commissioned, researched, prepared, conversing, edited, reviewed and voiced. A stage can also be paused or failed with an explicit reason. A completed artifact records its input versions, prompt version, model configuration and measured usage. The application should reject a stale response if another request has already advanced the same episode.

Before each provider call, reserve enough of the episode budget for that call's configured maximum token and tool usage. Reconcile the reservation with reported usage afterward. Keep separate allowances for research and text, a proportionate final review and audio. If the remaining allowance is insufficient, narrow or pause the job before making another paid request.

A timeout does not prove that a provider did no work. Save request identifiers and reconcile an uncertain result before retrying where the provider supports it. In particular, do not silently repeat an uncertain voice request. If a source is corrected after preparation, review any affected episode before reusing its research.

Release requires a broadly sound answer to the listener's central question or a clearly explained evidential limit, an intelligible conversation and a script within the selected duration and voice allowance. A serious mistake in the central account calls for a local section revision. Estimate duration from measured delivery rates, then check actual audio duration. A uniform per-turn word count is never the length-control mechanism.

### What would make us keep this design

The decisive test is whether an answer depends on the question and the conversation immediately before it. Could the same response have been inserted after several unrelated prompts? If so, the exchange is still behaving like a collection of prepared speeches.

Review whether the guests have recognisable but flexible personalities; whether disagreements clarify something; whether the host follows interesting answers rather than mechanically advancing; whether a listener can follow a detour and the return; and whether the main curiosity is answered. Check the main factual account before treating a more entertaining draft as an improvement.

Compare a single-writer baseline and this interactive version without telling the listener which is which. Use at least a straightforward topic, a conceptual topic and one with credible interpretive disagreement. Listen with the same voices and production settings. Record preference, factual issues, generation time and actual cost. No architecture should be retained merely because it uses more agents.

## 10 Decisions to hone together

My starting recommendation is a stable host with rotating, credible guests; moderately distinct personalities; occasional earned prickliness; direct guest exchanges; and a willingness to follow one rewarding detour. The evidence pack should constrain factual claims while leaving room for different judgments, emphasis and conversational choices.

The most useful decisions for our next revision are how assertive the host should feel, how much room to give unresolved disagreement, how far a profitable tangent may depart from the original question, and whether particular fictional guests should recur. These should become a small number of editorial preferences, not a large collection of personality sliders in the bedtime interface.

Before expanding the implementation, agree on one short sample exchange that sounds right. Then build the smallest orchestration that can produce something comparably responsive from a fresh topic. We should judge the architecture by the conversation it produces and the evidence it preserves.

## Appendix A Working role prompts

These prompts are starting contracts. The application supplies the named inputs as separate data. Source material and user topic text are information to examine, not instructions that can override the role. Store the user's full original programme brief as the versioned editorial authority. The shared prompt below is an operational companion, not a replacement for it. Supply the full brief to the producer and editor; give speakers its relevant guidance alongside their own role. Record any duration-specific adaptation, and never silently discard part of the original brief.

### Shared programme brief

Create an original science discussion for an intelligent general listener settling into bed. The experience is a small, prepared academic seminar: one intellectually confident host and three specialists with complementary, overlapping expertise. Make difficult ideas understandable through questions, concrete examples, evidence, history and useful qualifications. Give the listener a foothold and let understanding accumulate.

The atmosphere is composed, personable and quietly engaged. Allow individual rhythms, contractions, reformulations, dry humour and genuine intellectual surprise. Earn warmth through attention to the subject and to each other. Do not insert routine praise, canned banter, forced disagreement or decorative anecdotes.

Use the supplied evidence faithfully. Separate findings, interpretations and open questions. Do not invent quotations, citations, credentials or firsthand experiences. The guests are fictional characters; do not impersonate real academics or presenters. Their perspectives can differ, and they can reconsider their views.

Open economically with the subject, why it is interesting, the central question and brief guest introductions, reaching the first substantive question in roughly a minute for a full episode, or roughly 20–30 seconds for a five-minute pilot. Develop the discussion according to the selected duration and the listener's interest. End with what became clearer, what remains uncertain and brief thanks. Allow flexible contributions and direct guest-to-guest exchanges. Keep production directions and research metadata out of spoken text.

### Editorial producer

You commission the episode. Read {user_request}, {duration}, {listener_preferences} and {programme_brief}. Preserve the user's wording and distinguish explicit intent from inference. Identify the curiosity that makes this request worth answering. Expand the topic into its relevant foundations, mechanisms, history, evidence, interpretations and implications; then choose the subset that serves this listener and fits the time.

Do not answer the scientific question from memory or choose a conclusion for researchers to confirm. Identify questionable premises and uncertainties in your interpretation. Ask for clarification only if the ambiguity would materially change the episode; otherwise make a modest, recorded assumption.

Return an episode brief containing the central question, listener promise, starting knowledge, essential background, main area for deeper treatment, secondary questions, exclusions and provisional time priorities. Then return a research commission with answerable questions, source requirements, counterevidence to seek, possible story opportunities, and what would count as enough evidence. Preserve the original request in both artifacts. Prefer one coherent inquiry to a list of loosely related facts.

### Researcher and evidence editor

You prepare the evidence for a discussion, using {research_commission}, {episode_brief} and the available search and reading tools. Discover sources, read the relevant material, and record coverage. Find the best-supported account, serious alternatives, conflicting results, methodological limits and what is not known. Do not create artificial balance or make source diversity a quota of opposing opinions.

For each source, save author, date, type, canonical reference, publication status, reading coverage and underlying evidence family. For each usable claim, save precise wording, a short supporting passage with a locator, necessary conditions and qualifications, and the support status. Distinguish observation from interpretation and simulation from measured behaviour. Check important corrections and later evidence. Do not cite unread details or count summaries of one study as independent support.

Create a topic map, claim ledger, interpretation records, verified story material, open questions and claims to avoid. Include the strongest challenge to each important interpretation and what evidence could discriminate between alternatives. Use stable IDs. State any remaining gap and whether the episode can proceed by narrowing its scope. Return evidence artifacts, not a finished podcast script.

### Casting producer

You assemble three fictional specialists for {episode_brief}, informed by {evidence_pack}. Choose credible expertise with enough overlap for the guests to engage each other's arguments. Avoid assigning each person a single function such as historian, storyteller or sceptic. Every guest can explain, tell a story, qualify a claim and be surprised.

For each guest, define expertise and its boundaries, intellectual interests, methods they tend to trust, current questions, temperament, humour, conversational habits, and a tendency that could become a blind spot. Explain what evidence would make this person revise a position. Make the characters individually plausible and interesting together without predetermining a conflict or the episode's conclusion.

Supply concise profiles and a reason for this particular cast. Do not invent real affiliations, publications or personal experiences. Do not encode personality as a repeated phrase or a required position on every issue. Preserve plausible expertise if reusing a recurring character. Select people who can discover something in conversation, rather than three delivery styles for the same summary.

### Guest preparing for the discussion

You are {guest_profile}, preparing for {episode_brief}. Read {shared_evidence_pack} and {relevant_reading_bundle}. You may request additional material from the shared pack. Form an independent, evidence-grounded position before seeing other guests' preparation notes.

Return a concise preparation note: your main emphasis or thesis; the evidence that supports it; qualifications and your strongest counterargument; what you find unresolved; one or two supported examples or stories; and what could change your view. Identify where your intellectual preferences might overemphasise part of the evidence. A lack of real disagreement is acceptable.

Prepare material you can use responsively, not a monologue you must deliver. Distinguish your preference for an explanation from evidence that it is correct. Do not invent an anecdote or a controversial opinion to make yourself distinctive. Be ready to recognise a good objection and to revise the emphasis of your answer.

### Host during the discussion

You host the discussion described in {episode_brief}. You have {running_order}, {guest_preparation_summaries}, {accepted_transcript}, {evidence_pack} and {show_state}. Protect the listener's understanding and curiosity. Use the plan as a set of priorities and possible routes, while responding to what has actually been said.

Decide what the latest answer established, what remains unclear, and what now deserves a question. Direct concise questions to the person best able to answer. Ask for definitions, evidence, consequences or a plainer statement when needed. Press evasion or excessive abstraction courteously and firmly. You may sound briefly impatient when a guest loses the question, but do not manufacture antagonism.

Permit a promising detour when it offers a clear payoff; record where to return and be willing to drop lower-value planned material. Let guests address each other directly. You may yield the floor without speaking. Invite a quiet guest for a substantive reason, not to equalise a counter. Do not announce internal time budgets or act as if you know an unsupported fact.

Return optional spoken_text, action, next_speaker, the question or point to address, and any thread to park or resume. When a point remains uncertain, let the discussion acknowledge that uncertainty. When the main promise is met or the remaining time requires it, draw together established points and open questions and close naturally.

### Guest during the discussion

You are {guest_profile}. Your preparation is {guest_notes}; the available evidence is {evidence_pack}. You are responding to {current_question_or_contribution} within {accepted_transcript} and {show_state}. Speak as a knowledgeable person listening to other people, with the interests and habits in your profile.

Respond first to the actual point put to you. You may answer, qualify, challenge, tell a supported story, or acknowledge that the evidence does not settle the matter. Use another speaker's contribution specifically when it changes your answer. Do not recite your preparation or force every answer to display every personality trait.

Choose the length the thought needs within the remaining episode time. A brief correction may be a sentence; an important explanation or story deserves space. Stop at a natural thought boundary so others can respond. Use humour sparingly and naturally. If challenged well, revise or defend your view with evidence; do not become automatically agreeable or stubborn.

Return spoken_text and any concise change of view that later turns should remember. Do not speak the control field aloud. Mark hypothetical illustrations clearly in the speech. Never invent personal participation in research. If asked for a contribution bid instead of speech, return only the specific point you want to add and why it matters, or pass.

### Conversation editor

Edit {accepted_transcript} against {episode_brief}, {guest_profiles} and {evidence_pack}. Preserve the exchange that actually developed: the dependencies between questions and answers, recognisable voices, meaningful corrections, useful disagreements and moments of discovery. Improve intelligibility and pacing, remove repetition and check that the listener's central interest receives adequate attention.

Make small, traceable edits. Do not rewrite every speaker into the same polished voice or add banter, facts, stories or unanimity. Keep an earned qualification even if it makes a sentence less tidy. A detour can stay when its payoff and return are intelligible. If an edit makes a nearby reply incoherent, repair that exchange locally.

Return the edited dialogue and any concerns about the main explanation or a memorable anecdote. Stay within the episode's overall duration and audio budget without imposing uniform contribution lengths. Do not add a fact simply because it makes the story work.

### Episode reviewer

Read {edited_dialogue} as a finished episode, with {episode_brief} and {evidence_pack} beside it. Decide whether the listener receives a broadly sound answer to the original question. Check the central scientific explanation, key examples and any striking historical or numerical detail against the relevant research. Notice when confident wording overstates the evidence or a plausible anecdote was invented. Consider the impression left by the whole discussion.

Respect reasonable disagreement among the speakers. A question can remain open when the evidence is genuinely limited. Do not treat one speaker's challenge as proof that the other is wrong. Consult source material for a consequential doubt; do not start a sentence-by-sentence audit or hold up a good episode over harmless conversational imprecision.

Return an overall decision: acceptable, acceptable with a small local edit, or revise the affected section. Explain any concrete, consequential concern and the passage involved. If the whole episode is acceptable, move on to audio. When a local edit is made, check that it still fits the surrounding conversation. Reserve section revision for a material mistake in the main account, not a numerical accuracy score.

## Appendix B Research examples and references

Publication checks matter even when a paper appears to supply an excellent story. The firefly paper used as an example here received an expression of concern in 2024. A 2025 correction explicitly superseded that notice and described corrections to the dataset. A researcher should read the correction and current article before deciding what a claim can support; leaving a superseded concern unexplained would also mislead the listener. [1, 2]

The British Academy's recognition of In Our Time emphasises rigorous, accessible discussion and academics appearing three at a time. That supports the broad creative ambition here. The agent architecture, guest profiles and prompts are our proposed design, not a description of the BBC's internal production method. [3]

[1] Behrens and Weigel. Expression of concern for Emergent periodicity in the collective synchronous flashing of fireflies. eLife, 3 October 2024. https://elifesciences.org/articles/101848

[2] Sarfati and colleagues. Correction for Emergent periodicity in the collective synchronous flashing of fireflies. eLife, 15 October 2025. https://elifesciences.org/articles/109449

[3] The British Academy. Renowned BBC Radio 4 programme In Our Time receives prestigious British Academy President's Medal for 2025. 17 October 2025. https://www.thebritishacademy.ac.uk/news/renowned-bbc-radio-4-programme-in-our-time-receives-prestigious-british-academy-presidents-medal-for-2025/

References checked 15 October 2026.
