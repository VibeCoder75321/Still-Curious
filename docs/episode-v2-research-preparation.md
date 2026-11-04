# Version 2 research and preparation

Tasks 06–09 extend the durable pipeline from a saved research commission to a flexible host plan. They use the existing provider adapter, owner-scoped artifact storage and usage ledger. New episode creation still runs version 1; the version 2 interface is Task 13 and the first measured live text pilot is Task 14.

## Research: Tasks 06–07

Discovery and reading are separate saved operations. The discovery prompt follows the exact commission and records why the chosen sources cover its questions. Source limits follow the episode configuration, rather than requiring exactly three sources. Each accepted operation produces a new immutable `source_records` snapshot.

Records preserve source URLs and publication metadata, access dates, evidence families, relationships, notices, qualifications and passages with locators. Discovery snippets cannot become body passages without a separate observed page open. Failed access is recorded as inaccessible; an attempted open does not establish that the source was read. The app uses hosted retrieval, with no direct URL fetching in the Worker.

The research loop checks the existing operation, search, read and spending allowances. Reservations remain conservative: hosted tools may perform different actions, so an opening request needs potential search headroom too. Exhausting a search/read allowance ends research with a recorded coverage limitation. A lack of budget for synthesis pauses for an explicit decision; it never borrows the review or audio allowance.

The evidence editor receives only the saved research. It produces a topic map, claims, interpretations, qualified stories, a common briefing and linked specialist extracts. Claim records distinguish observation, inference and interpretation. Reports of the same study are grouped into evidence families rather than treated as independent confirmation.

Central findings must resolve to saved material actually read. A qualified statement about an abstract is permitted; a snippet or inaccessible paper cannot supply central support. Corrections, retractions and expressions of concern remain visible. The resulting scope decision is `sufficient`, `narrowed` or `insufficient`. Insufficient evidence saves the decision and pauses without repeatedly commissioning more research.

Before casting, the pack is frozen against the exact source-record version and a SHA-256 hash of its data. Casting and every preparation step check that foundation. A changed source snapshot, commission or episode brief requires review and replacement of affected preparation. Existing artifacts are retained; the app does not silently rewrite their foundation.

## Casting: Task 08

One saved cast contains a host and three fictional specialists. The server assigns `expert1`, `expert2` and `expert3`; their names and IDs remain stable for the job. Profiles include overlapping expertise, methods, temperament, intellectual tendencies, confidence, humour, blind spots and conditions for revision.

Each profile identifies how it approaches shared evidence, and the saved cast explains the differences between the three perspectives. The prompts forbid fixed content jobs, compulsory disagreement and invented firsthand research. Voice mapping stays separate from the scientific profiles.

## Preparation: Task 09

Each guest preparation is its own durable operation. The provider receives that guest's own profile, the common briefing, the saved evidence and relevant passages, plus versioned programme guidance. Other guests' profiles and private preparation notes are excluded from guest requests.

Guest notes record a position, supporting claim IDs, counterargument, documented story IDs, qualifications, unresolved questions and what would change the guest's view. These references are internal preparation material, not mandatory spoken citation fields.

Only after all three notes are saved does the host receive them together. Its plan contains priorities, questions, possible follow-ups, optional detours, a return point and an ending aim. It supplies neither guest answers nor predetermined conclusions. The next saved step is `conversation.host`, whose speaking handler belongs to Task 10.

Every preparation artifact records exact cast/evidence references and prompt, model and usage provenance. Resuming after two guest preparations requests only the third guest and then the host. A pending provider response is retrieved by its saved ID, without a second submission.

## Verification limits

The automated checks use authored fixtures, mocked provider responses and the production SQL against in-memory SQLite. They verify boundaries, references, durable recovery and bounded execution. They do not establish the quality of live research, accuracy of extracted quotations, naturalness of the cast or usefulness of generated questions. Those require the measured pilot. No live provider request is needed for these four tasks.

The complete original programme brief is still unavailable as a verified verbatim source. Available framework guidance is identified as such; the implementation does not reconstruct the missing original.
