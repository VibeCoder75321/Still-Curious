# Editorial inputs

This folder preserves the source material for the Still Curious version 2 implementation. Start with the framework and the [implementation log](../implementation-v2.md).

## Authority and provenance

1. The user's explicit corrections and instructions govern the implementation.
2. [Framework v2.1](Still_Curious_Podcast_Framework_v2_1.docx) is the revised framework accepted in this conversation. [framework-v2.1.md](framework-v2.1.md) is a complete text extraction from that DOCX, including both tables, for coding agents to read. It is not a new editorial rewrite.
3. [Implementation Task Pack v1](Still_Curious_Implementation_Task_Pack_v1.docx) supplies the ordered implementation assignments. This copy comes from the attachment supplied for Task 01.

[sources.json](sources.json) records versions, SHA-256 checksums, source descriptions and the supplied file identities. The framework DOCX was copied from the existing conversation workspace. The earlier `podcast-framework/framework-content.md` was not imported: its builder applies later revisions, so that source alone is not the final v2.1 text.

The full original user programme brief is **not available as a verified verbatim source** in the inspected workspace or repository. Existing prompts, proposal summaries and this framework must not be relabelled as that original. Infrastructure work can proceed from framework v2.1. When the original is supplied, preserve it as a separate versioned input with provenance; do not overwrite the framework or silently replace the original with a condensed prompt.

## Decisions carried forward

- One prepared host and three distinct fictional specialists. Each speaker writes their own contribution after seeing the accepted conversation. Intellectual temperament and overlapping expertise matter; guests have no rigid speaking functions.
- The host manages questions. Guests respond, qualify and challenge; there is no requirement for a guest to ask another guest a question. Optional brief contribution requests and silent yields allow guest initiative.
- Preserve the exact transcript and speaker identities for continuity and recovery. Do not require citations on each spoken turn or perform live claim auditing.
- Do not interrupt the conversation for web research or real-time fact-checking. Speakers can qualify recollections and leave reasonable disagreements open. A caveat does not establish that a claim is true.
- Review the episode as a whole. Accept an overall sound episode, make small local edits, or revise the affected section for a consequential error. Do not use an accuracy percentage or regenerate the entire conversation for a local problem.
- Start with a five-minute pilot and a roughly 20–30-second introduction. Contributions vary in length. Preserve enough allowance for editing, review and audio.

These points are an operational guide; the complete framework remains available above. The runtime prompts and validation still reflect the existing version 1 implementation until the later tasks change them.

## Historical material

`docs/proposed_pipeline.md` is an earlier proposal, superseded by framework v2.1. In particular, its mandatory turn-level claim IDs, exhaustive verification rules and one-minute pilot opening must not be copied into version 2. Its model names, prices and allowances are historical planning assumptions, not current verified configuration or measured costs.

`docs/mvp_plan.md` and `docs/generation.md` describe earlier implementation work. Use the implementation log's source map and the actual code to identify the production path.
