# Firefly text pilot assessment

Accepted for an audio audition on 15 October 2026. Task 14 is complete. This assessment is based on reading every accepted and edited turn, the saved whole-episode review, research qualifications and usage records. No audio has been generated.

## Result

The final script answers how fireflies generate light: specialised cells contain the molecular machinery; luciferase catalyses luciferin chemistry; ATP-dependent activation precedes oxygen chemistry; excited oxyluciferin releases a photon as it moves to a lower-energy state. The episode distinguishes that mechanism from evidence locating an enzyme. The source pack's missing primary biochemical reconstruction is handled transparently, and the proposed omission experiment is explicitly hypothetical.

The whole-episode review returned **acceptable**, with no material issues, repairs, supplementary research or numerical accuracy score. Light editing removed repetitions from the 718-word accepted conversation while retaining all nine turn IDs and speakers. The exact final script links to edit version 1 and review version 1.

- Final length: **600 words**, **3,917 characters**, nine turns; within the 550–700-word planning range and 5,000-character allowance.
- Opening: **59 words**, approximately **26.2 seconds** at 135 words/minute; about 24–30 seconds at 120–150 words/minute.
- Estimated delivery: **266.7 seconds** at 135 words/minute; four to five minutes at 120–150 words/minute. This is a planning estimate. Pauses, pronunciation and actual duration await audio measurement.
- Total run elapsed: **25.65 minutes**, including manual diagnosis and recovery. This first development run is not a clean production-latency benchmark.

[Read the accepted script](transcript.md). [Structured transcript, edit and review](transcript.json). [Research and evidence](research.json).

## Listening and editorial assessment

The explanation is coherent enough to justify an audio trial. Tomas moves from cells to the enzyme, Mira supplies the reaction, and Leena clarifies what an excited molecule means with an energy-step analogy. The host's follow-ups use what was actually said: the location/mechanism distinction prompts the chemistry question, and Mira's excited-state explanation prompts Leena's clarification. The discussion reaches a useful central answer and closes on it.

The voices have distinct scientific interests, although their personalities are only lightly expressed in this short sample. Contributions vary in length. No forced dispute, joke, personal recollection or invented discovery story appears. The language explains the similar names luciferin/luciferase, distinguishes catalyst from emitter, and gives a physical picture that works without a screen.

This is predominantly a host-led interview. There are five host turns and four guest turns, with one guest returning. No guest contribution-request round, silent host yield, bid refresh, parked request or extended tangent occurred. Those optional orchestration behaviors remain unmeasured in live output; they were not forced into this episode. There was no same-evidence V1 comparison or extra paid text experiment. Older sample material was not a controlled comparison.

The tone remains somewhat formal, especially in the final hypothetical-experiment exchange and repeated review/source qualifications. It is acceptable for an audition; the next concrete question is whether the four-voice performance makes the distinctions easy and pleasant to follow at bedtime pace. Do not rerun the conversation simply to manufacture more disagreement or banter.

Research limitations remain: ten candidate records, eight attempted source readings, three inaccessible sources, three partially read sources, two abstract-only sources and two unread snippet candidates. The chemical sequence relies on review accounts; the originally sought primary controlled reconstruction was inaccessible. The listener promise about how researchers established every chemical step was narrowed. The accepted episode discloses the hypothetical nature of its experiment and avoids efficiency percentages, zero-heat claims and unsupported universal organelle claims. This is proportionate whole-episode acceptance, not exhaustive factual certification.

## Measured usage and calculated cost

**Estimated charges: $0.918715**, using the saved `openai-standard-global-2026-10-15` snapshots. The authorized maximum was $5. The conservative allowance consumed is **$1.017926**; this includes worst-case accounting headroom and is not a bill. Actual billed charges are unreported. No audio allowance was used or authorized.

There were **28 logical generation operations and 28 POST submissions**: one producer, two discovery searches, eight source readings, one synthesis, one casting, three guest preparations, one host preparation, five host actions, four guest responses, one edit and one review. Recovery did not duplicate a generation submission. There were **451 runner GET retrievals plus three diagnostic GETs**. Two GET journal entries lack completion timestamps/status after workspace interruptions; their exact HTTP latency/outcome is unknown in that journal. All logical generation records ultimately completed with usage.

Observed tools: **two searches and eight source-reading actions**. One empty over-limit tool attempt is recorded separately as inferred ignored work; it is not treated as a completed page read. See [recovery notes](recovery-notes.md) for the observed shape, narrow parser rule and official documentation source.

Observed input: **361,099 tokens**, including **46,246 cached** and **253,375 cache-write tokens**. Observed output: **57,854 tokens**, including **33,625 reasoning tokens**. Reasoning is a subset of output and must not be added again. All 28 records have complete required token/tool observations and calculated estimates; the final ledger has no `unknownCosts` entries. Billed charges and provider-only processing time remain unknown. Polling, recovery and operator pauses affect the observed latency below.

| Stage | Logical operations | Observed stage elapsed |
| --- | ---: | ---: |
| commission | 1 | 247.6 s |
| research | 11 | 722.3 s |
| casting | 1 | 69.1 s |
| preparation | 4 | 182.1 s |
| conversation | 9 | 148.5 s |
| editing | 1 | 86.7 s |
| review | 1 | 27.7 s |

These stage intervals run from saved attempt creation to final acceptance and can include operator delays. They are not independent measurements of provider compute time. [Detailed usage](usage-report.json), [machine-readable summary](pilot-summary.json), [HTTP journal](http-journal.json) and [diagnostic requests](diagnostic-http-journal.json) preserve the distinction.

## Recovery and verification

The run exposed and repaired two implementation issues: counting an empty unfinished over-limit web attempt as a completed source read, and retaining a local SQLite connection across workspace inode replacement. Completed provider responses were retrieved by known ID after recovery, retaining the same operation records and $5 ceiling. Original held/recovery snapshots are preserved. No accepted dialogue was regenerated, no whole-episode accuracy percentage was used, and the final text required no factual repair.

All **165 TypeScript regression tests** pass, including narrow tool-count recognition and a file-backed SQLite lease test across inode replacement. TypeScript checking, the verified Worker build and whitespace checks pass. The live pilot used the production text modules through the local durable runner; it did not run through the deployed browser. No production jobs, provider credentials or Site audience were changed. Device playback, audio duration and synthesis quality remain untested.

## Next task

**Task 15 — Connect the accepted script to dialogue audio.** Use the specific final-script reference in `job.json`, its exact edit and review, and the existing stable host/expert voice mapping. Pin the script hash, voices, model and chunk plan; retain request/clip recovery and invalidate affected audio on text change. First verify the adapter with mocked resume/mismatch checks, then run a separately authorized short four-voice audition spanning a section boundary. Measure and account for that audition before synthesising this saved script within an agreed audio allowance. The $5 approval for this run was text-only.
