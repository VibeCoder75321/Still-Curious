# Episode personality and discussion design

## Current design: 1.7.0

New jobs persist `state.discussionVersion = "1.7.0"` with their random personality seed. Casting uses `coherent-personality.ts` (`1.7.0-coherent.1`): three different delivery foundations, two secondary variations of at most one point each, and one explicitly described tension per guest. The same ensemble contrast rules below still apply. Foundations are independent of discipline, topic and scientific position. Concrete response examples illustrate cadence; they are not lines to copy or scientific evidence. The complete character and prompt are saved before preparation and reused exactly on resume.

Each guest prepares independently with the same frozen evidence. A required `position` records a priority, supported judgment, accepted trade-off, strongest alternative and concession. Its claim IDs must be a subset of the guest's validated supporting claims. Personality cannot choose the scientific conclusion. Guests never see other guests' private notes.

The host sees the three positions and prepares `discussionPoints`: shared evidence, distinct relevant priorities and an invitation that could connect them. The live host follows actual accepted speech rather than scripting disagreement. Guests can develop, challenge, clarify or revise an actual point and offer an addressed guest a reply. The host receives the requested word range and actual spoken-word progress, and must explain the commissioned essentials before specialist detours. Counts do not substitute for understanding, and hard spending limits still take precedence.

Research discovery and reading prioritise the commissioned basics. Synthesis must map every essential foundation to evidence claim IDs or record a precise gap. A gap forces an insufficient-evidence hold before casting, even when specialist material could support a narrower debate. This prevents an explanation request being silently converted into a discussion of evidence limitations.

Whole-episode review includes `interactionReview`. Every claimed guest exchange needs chronological turn IDs, different guest speakers and literal excerpts of the edited speech. Unknown turns, host-only exchanges, reversed order and invented quotations fail validation. Parallel speech must be reported honestly; a substantial failure can require an editorial hold, while modest weaknesses remain notes. The reviewer also compares accepted original speech with edited speech for loss of voice. Editing and bounded repair retain their existing small-patch limits and personality preservation rules.

Existing unversioned and 1.6 episodes retain their original request context, schemas and saved personalities. No existing episode is rerolled. There is no additional model operation for character generation or interaction review. Model choices, spending caps and audio voices are unchanged.

Verification includes 500 reproducible coherent casts, evidence/position validation, private-note boundaries, host context, grounded interaction evidence, early foundation holds, legacy prompt preservation, and the real creation-to-export HTTP workflow with mocked providers. These checks validate implementation; they do not establish the listening quality of a newly generated episode.

## Original 1.6 integration

The previous design used the supplied **Podcast Guest Personality System 1.6.0**. Its TypeScript port remains available for existing episodes; it does not execute Python or reuse the example fusion cast. Generator implementation version: `1.6.0-ts.1`. The source ZIP SHA-256 is `4743ec932f15b32fc40897752bb9f99eadb752080a164ec10f9dcbbd69986aeb`.

## Lifecycle and saved state

`createTextPilot` (also used by `createPodcast`) creates a fresh cryptographic UUID seed and saves it in `state.personalitySeed` with the job. After research, the casting model chooses fictional identities, expertise and evidence perspectives. It no longer chooses temperament, confidence style or humour for new episodes.

Before private preparation begins, the casting completion samples the ensemble and saves `cast:1.data.personality` atomically with the completed casting attempt and the transition to preparation. This snapshot contains the generator version, episode ID, topic, seed, accepted draw, ten trait values per guest, each guest's exact behavioural guidance and complete dialogue instructions (including the app's output contract), and the host cast brief. Episode leases and compare-and-swap saves prevent concurrent casts. Background retrieval and retries use one existing provider request; no extra model operation is added for personality generation.

Guest turns send their saved individual instructions directly, without the old shared stylistic prompt. Each guest sees only their own profile, trait guidance and private preparation, plus the full accepted exchange and shared evidence. Host preparation and turns see the saved cast brief. Listening bids use each guest's own guidance. Editing, review and bounded repair preserve supported opinion, useful disagreement, humour, expressive language and individual cadence.

Existing jobs without a personality seed retain their legacy request schemas, prompts and context. They are not rerolled or rewritten mid-episode. Previously saved transcripts and audio are unchanged. The model policy, research pipeline, voice mapping and $5 cap are unchanged.

## Sampling and compatibility

The ten 1–5 controls are language richness, verbosity, assertiveness, argumentativeness, directness, warmth, humour, enthusiasm, storytelling and speculative appetite. Candidate ensembles must meet every supplied rule: pairwise absolute distance ≥16; both high (4–5) and low (1–2) language richness; both high and low argumentativeness; at least one high-assertiveness guest; at most one high-verbosity guest. Accepted profiles are shuffled before assignment to identities.

The portable JavaScript sampler uses an FNV-1a seed hash and Mulberry32 stream with modulo-tail rejection. It preserves the supplied sampling constraints and prompt compiler wording, but **a numeric Python seed will not generate the same values in JavaScript**. The separate generator version records that distinction. Both the values and full instructions are saved; resume never recompiles them from the seed. `compileGuest` and `compileHost` are checked against the exact uploaded Python sample.

## Verification

The offline tests cover 500 reproducible varied ensembles, source-sample wording parity, new-job seeds, malformed snapshots, distinct guest instructions, preparation privacy, exact conversation context, legacy behaviour, concurrent casting and background recovery, and the real HTTP creation/advance/export path with mocked providers. Existing ownership, spending, evidence and audio checks remain in the regression suite.

Run:

```sh
node --experimental-strip-types --test tests/episode-v2-*.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

No paid model or audio generation is needed for these checks. Audible distinctiveness, natural disagreement and preservation through editing still require listening to a newly generated episode; offline tests do not establish those subjective outcomes.
