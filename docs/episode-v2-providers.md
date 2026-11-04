# Version 2 provider calls and usage

Task 03 adds a mockable OpenAI Responses adapter, role settings and a serializable usage ledger. `providers.ts`, `model-policy.ts` and `usage.ts` are under `lib/episode-v2/`. Existing v1 generation and ElevenLabs calls keep their current path. Task 04 supplies durable D1 attempt storage and recovery; Task 13 enables new v2 jobs.

## Verified provider capabilities

Official documentation was retrieved on **15 October 2026**. The initial catalog supports `gpt-6.1-sol` and `gpt-6-luna`. Both document structured outputs and hosted web search through Responses. Sol supports `low`, `medium`, `high`, `xhigh` and `max`; Luna also supports `none`. This verifies published capabilities, not access for the configured account or the quality of a podcast run.

Sources: [Sol model](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [Luna model](https://developers.openai.com/api/docs/models/gpt-6-luna), [reasoning guide](https://developers.openai.com/api/docs/guides/reasoning), [Responses reference](https://developers.openai.com/api/reference/typescript/resources/responses/methods/create), [web search](https://developers.openai.com/api/docs/guides/tools-web-search), [pricing](https://developers.openai.com/api/docs/pricing).

The adapter explicitly requests Standard reasoning mode and the default service tier. It omits temperature and top-p, caps output tokens including reasoning, limits hosted tool calls, disables automatic truncation and retains the response for later ID-based reconciliation. Direct synchronous callers retain a maximum 90-second local timeout. The Task 04 [durable runner](episode-v2-recovery.md) uses background submission and short ID-based polling instead.

## Default model policy

| Role | Model | Effort | Maximum output tokens |
| --- | --- | --- | ---: |
| Producer, evidence synthesis, review | Sol | xhigh | 16,384 |
| Guest preparation and guest speech | Sol | xhigh | 8,192 |
| Casting, host preparation, editing, local repair | Sol | high | 8,192 |
| Host speech and routing | Sol | medium | 4,096 |
| Source discovery and reading | Luna | high | 8,192 |
| Brief contribution request | Luna | low | 2,048 |

These are configurable pilot choices, not measured quality rankings. The default initial input allowance is 96,000 tokens. A conservative UTF-8 byte bound plus a framing margin rejects oversized text/JSON requests before submission; it is not a measured tokenizer count. Tool-expanded input is reserved separately as described below. The current verified catalog limits output to 128,000 tokens and hosted calls to four per response. Only research and source roles may receive web tools, so speaking roles cannot initiate live research.

On 16 October 2026, the user requested Extra High guests. New episodes now use `xhigh` for all three guests' preparation and dialogue, retaining the same 8,192-token output maxima, input bounds, Standard mode and default service tier. Host effort remains Medium. Existing saved job policies and completed audio are preserved. The app's shared $5 ceiling and audio reserve remain in force. See [storytelling research and the upgrade record](dialogue-storytelling-research.md); no live quality or cost comparison was run for this settings change.

`createModelPolicy` returns a fresh policy and rejects unknown settings, invalid efforts and tools on other roles. Each attempt saves the actual settings used. A job can save its complete policy in `state.modelPolicy`; the adapter takes that saved policy when resuming rather than relying on later defaults.

## Adapter interface

`createProviderAdapter({ apiKey, policy, fetch, now })` accepts injected transport and clock functions. Its `execute(request, ledger, persist)` method takes an attempt ID, role, instructions, input, strict JSON schema and a parser for the returned value. Supported kinds are `structured`, `research`, and `source` (with an exact source URL). The parser can use the existing artifact schemas.

`persist` is mandatory and is awaited before fetch and after settlement. It must save the entire ledger under the job's current lock/version. Its optional second argument carries a successfully parsed result so the runner can save artifacts atomically with settlement. `retrieve(request, ledger, persist)` GETs the response ID already saved in that attempt, using its saved settings, without reserving or submitting another operation. Retrieval failures remain uncertain even for HTTP 404; they do not prove the original work was rejected. The adapter never retries a provider operation or guesses how to repair partial JSON. Attempt IDs are unique and cannot be silently reused.

A research result must include an observed completed search. Source access must include an observed completed `open_page` of the requested URL, preserving meaningful query parameters. Search snippets, a different page and failed opens do not count. Task 06 may explicitly opt in to accepting an observed failed exact-page open solely to record inaccessible access; its reader rejects any accompanying claim of read passages. Returned action/source metadata records access honestly. Opening a page does not establish full-paper coverage or prove that a quoted passage is correct; extraction and coverage assessment remain research-stage responsibilities.

## Usage records and prices

An attempt records its role and bucket, requested/actual model, response/request IDs, settings and maxima, latency, outcome, reported token/tool counts, safe errors and a dated price snapshot. Prompts, provider error bodies, API keys and model reasoning text are not copied into the ledger. Reasoning-token counts are recorded separately but are already included in reported output tokens and are not charged twice.

The initial Standard/global price snapshot uses these published USD rates per million tokens:

| Model | Input | Cached input | Cache write | Output |
| --- | ---: | ---: | ---: | ---: |
| Sol | 2.00 | 0.10 | 2.50 | 10.00 |
| Luna | 0.10 | 0.01 | 0.125 | 0.50 |

The snapshot includes the documented long-context threshold/multipliers and the $0.01 search-call rate. It excludes regional, Fast, Ultrafast, Flex and Batch adjustments because this adapter does not request those modes. Each record retains its own rates and version so later price-table edits do not rewrite an earlier attempt's assumptions. No prices for ElevenLabs are invented here.

`reported` contains only observed counts. Missing counts are null, including on an HTTP rejection without usage. `estimatedUsd` is a calculation from reported usage and that attempt's price snapshot; it stays null when required details are missing. `billedUsd` remains null because a Responses result is not an invoice. `unknownCosts` explains reporting gaps. Estimated hosted search charges count search actions; the allowance conservatively covers every web action. Aggregate input across a research response can select a conservative long-context rate even when individual internal calls may be shorter.

## Reservations and separate allowances

`createUsageLedger` requires an explicit spending ceiling and separate research, text, review and audio allocations. Their sum cannot exceed the ceiling. A null ceiling authorizes no call. The role determines the bucket; text cannot borrow the review or audio allowance. Operation, search and source-reading counters are checked before submission. Saved ledger limits must agree with the episode configuration.

Before fetch, the adapter reserves the configured maximum output, input and tool cost. Plain text uses the configured input allowance. Hosted retrieval can expand context internally, so its reservation covers the model's full documented context for every possible tool round and final pass, plus the maximum tool fees and long-context/write rates. This is deliberately conservative and can require substantially more headroom than the eventual estimate. Each hosted request temporarily reserves both search and source-reading counter slots because the model chooses its web action; unused slots are released after observed actions are recorded. Leave search headroom when planning source opens.

After a terminal result, reported input/output/tool counts reduce the held allowance conservatively. Missing cache details retain a worst-case token charge; entirely missing usage retains the full reservation. Known pre-execution HTTP rejections release their money/tool reservation while remaining counted as attempted operations. Uncertain/pending requests retain their full reservation and block new operations. Work exceeding a configured bound is recorded and blocks further calls for review.

Task 04 supplies conditional D1 reservation/result persistence, saved attempt identities and stale-response rejection through the durable runner. The adapter's in-memory ledger alone is not a distributed lock; concurrent workers must use that runner/integration. The audio allocation is protected here; the existing voice path is connected in Task 15.

## Verification

Run `node --experimental-strip-types --test tests/episode-v2-providers.test.ts tests/episode-v2-contracts.test.ts tests/server-pipeline.test.ts tests/dialogue.test.ts`.

The suite has **53 passing checks**, including 15 new provider/accounting checks. Coverage includes pre-fetch persistence, reconciliation, cached/write/reasoning tokens, redacted quota/rate errors, incomplete or invalid output, ambiguous server failures/timeouts, unknown usage, pending responses, count/money limits, source-open evidence and persistence failures. All transports are mocked. Published model access, real latency and podcast quality remain live-pilot questions.
