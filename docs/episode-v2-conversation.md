# Version 2 conversation orchestration

The [editorial engagement update](editorial-engagement-update.md) adds host participation context and prioritises responsive handoffs using the existing actions. It leaves the floor reducers, response obligations and budget limits described below unchanged.

Task 11 connects the speaking roles to the existing durable runner. The registered handlers now run a prepared episode from `conversation.host` through a closed, accepted transcript and `editing.edit`. Task 12 now supplies [editing and whole-episode review](episode-v2-post-production.md), reaching the accepted-text checkpoint. New episode creation in the interface remains version 1 until Task 13.

## Saved operations and floor routing

`conversation.ts` builds one provider operation for the saved substep. Its stable key combines that substep with the next conversation-operation number. The existing runner reserves usage before submission and atomically accepts the result, immutable transcript snapshot, provider metadata and next substep. Interrupted work with a saved response ID uses GET; a missing response ID never authorizes a replacement POST.

`conversation-state.ts` contains pure reducers for host actions, invited guest contributions and listening requests. They clone the previous state and preserve every prior spoken word. The server assigns new turn IDs and speaker identities. A silent host action and a contribution request each save a new snapshot without adding an audio turn.

| Operation | Saved result and next route |
| --- | --- |
| Host asks or yields | Optional host speech plus a specific guest invitation. A yield may be silent. |
| Host continues | Own speech followed by another host decision. Global operation and episode limits still apply. |
| Invited guest responds | Own speech, optional stance update and any addressed guest's response opportunity, then host. |
| Host collects requests | Silent decision followed by separate listening-guest substeps, then host. |
| Listening guest bids | One brief offered point or a saved pass. No speech is accepted. |
| Host closes | Optional closing speech, no next speaker and a transition to `editing.edit`. |

A guest who addresses or challenges another guest can identify that response opportunity in a control field. The host must offer the response or explicitly ask a clarification first; the owed reply remains saved. Further addressed guests are queued rather than silently replacing the first opportunity. These fields describe the actual contribution and do not require a disagreement. The scheduler validates the saved invitation and next speaker before accepting a guest contribution.

## Optional requests and parked points

The host may request bids after a guest contribution when time, turns, request rounds and provider headroom allow. The two listening guests each have a separate saved operation. Passing is normal and does not trigger an invented dispute or force a turn.

The host can accept one available point, park it or decline it. Acceptance must invite that request's guest. A parked point, or an offer whose spoken context has changed, is refreshed in its own listening operation and returned to the host for a new decision. It cannot become speech on the strength of the old bid. Refreshes consume the same configured request-round allowance.

When the accepted guest actually contributes, the request records its accepted turn ID and becomes used. A later host decision can record whether that contribution helped and why. This is an editorial assessment saved for review, not an independently measured listener-quality score.

## Limits and remaining allowance

Each snapshot saves current topic, unresolved questions, detour return point, next speaker, response opportunities, request state and remaining limits. The duration estimate uses the exact accepted word count at 145 words per minute. It guides the host; speech is not truncated and individual contributions have no word quota.

The conversation respects the configured turn count, contribution-request rounds, provider-operation cap and separate spending allocations. A host is prompted to close when roughly 20 seconds, two turn slots or insufficient further-exchange headroom remain. Guest and bid preflight checks retain enough worst-case allowance to return to the host. If the next saved operation cannot fit, the job pauses with its exact exchange and next speaker. It does not start a retry loop or borrow review/audio funds.

Preflight inputs exclude the current unfinished operation's reservation when rebuilding that same request. This reconstructs its original allowance view and preserves the request fingerprint during response-ID retrieval. Settled usage and remaining allowances are saved after acceptance.

A host response that violates required closure, a saved invitation or request rules is not partially accepted. Its known provider metadata is retained for review without an automatic regeneration call. A silent initial close cannot create an empty episode.

## Private storage and input boundaries

With private object storage available, every immutable transcript snapshot is stored there with its owned content hash and a small index in the episode row. This avoids putting a growing copy of the whole conversation into the bounded job JSON after every silent decision or bid. The existing artifact reader verifies ownership, size, hash and exact version. Offline tests may retain their small snapshots inline when no bucket is supplied.

Every speaking request uses the current frozen research and the latest accepted transcript. Guests see their own private preparation; other guests' positions are learned through accepted speech. The host sees all preparation notes and live control information. No web tool is available to any conversation role. New host/guest prompt versions add bid decisions, response opportunities and concise usefulness feedback while retaining the earlier output shape for saved-fixture compatibility.

## Verification limits

The offline scenario uses authored speech and mocked provider responses with the production SQL against in-memory SQLite. It exercises a challenge, silent yield, reply, tangent and return, listening offers/passes, request acceptance, usefulness feedback and closure. Additional cases cover clarification queues, parked-point refresh, interruption, private snapshot reads and exhausted allowances.

These checks establish routing, storage and recovery behavior. They do not establish the naturalness, scientific accuracy, real duration or usefulness of a generated conversation. The measured text pilot remains Task 14; audio and real-device playback are later work.
