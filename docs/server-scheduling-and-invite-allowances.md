# Server scheduling and invitation allowances

17 October 2026 UTC. Requested: continue episode creation with the page closed, and limit each invited person to $5 total across episodes. No invitation or audience change is part of this implementation.

## Invitation accounting

`EPISODE_OWNER_USER_ID` is a server secret containing the existing owner's verified, Site-scoped visitor ID. It is not a ChatGPT account ID or a browser-supplied option. The owner retains the $5 per-episode ceiling; every other signed-in visitor shares one lifetime $5 creation allowance across their episodes. Missing owner configuration disables creation rather than exempting everyone.

`episode_allowance_holds` reserves the full authorized episode ceiling before an episode is inserted. A single conditional SQL upsert enforces the cumulative limit atomically. A simultaneous request cannot allocate the same remaining allowance. Request bodies cannot change identity or the lifetime limit. Individual episode ceilings are reduced to the visitor's remaining whole-cent allowance when necessary. Recorded episodes must still leave room for writing as well as audio.

Creation failure cleans up a reservation only when no episode with that ID exists. An uncertain acknowledgement cannot refund a committed episode. Controls reserve any renewed/increased authorization before saving it. The shared advance function checks the saved reservation before provider work. A finished or cancelled episode returns unused authorization only against its exact persisted final snapshot. Spent amounts remain accounted for; unknown operations and audio reservations remain held. Amounts use integer millionths of dollars and conservative usage accounting, not an invoice reconciliation. There is no periodic reset.

## Server worker

`advanceEpisode` unifies manual and scheduled V2 advancement, retaining existing text checkpoints, automatic audio handoff, ownership, recovery fingerprints, leases and cost checks. It never fabricates a visitor header or expands a provider credential's permissions.

The Worker exports a `scheduled` handler. The Wrangler build requests a once-per-minute Cron Trigger. Each invocation claims a database scheduler lease, processes running saved V2 jobs for at most eight minutes plus an in-flight operation, and releases the lease. Existing per-job leases prevent overlapping browser and server operations from duplicating paid submissions. A pending response is polled through the existing runner. Paused errors, user pauses, auditions and cancellations are not automatically resumed. The global lease expires after ten minutes so an interrupted invocation can recover on a later trigger.

`episode_scheduler_health` records the genuine scheduled-handler heartbeat. Capabilities advertise `background_processing: true` only with a heartbeat less than two minutes old. The browser then only reads progress. Without a verified live scheduler, the existing browser driver remains available and the screen continues to say it must stay open. Adding a handler and a Wrangler trigger does not establish that the hosting platform registered that trigger.

## Hosting acceptance

The Sites connector provisions D1/R2 but exposes no queue, Durable Object or Cron Trigger management operation. Its documented cloud tasks have an hourly maximum frequency; those tasks are not used as a minute-by-minute episode engine. Uploading a Wrangler config is not independent proof of platform registration. After publication, inspect the persisted scheduler heartbeat through the native database reader and correlate scheduled events in Worker logs. If absent, report server scheduling as prepared but unactivated; do not claim background creation works, create an unauthenticated updater, relay requests in a recursive loop, or substitute a temporary local process.

No new paid episode is necessary for verification. Budget tests exercise cumulative limits, concurrent reservations, owner exemption, visitor isolation, reservation cleanup, and conservative cancellation settlement. Scheduler tests advance persisted authored jobs without a browser, verify lease exclusion and expiry recovery, and preserve error holds. Existing route/audio tests cover the shared advancement function and private playback.

Verification before publication: 194 V2 tests passed; the UI suite then passed with two additional background-monitoring cases, for 196 covered checks in total. TypeScript, whitespace and Drizzle schema/snapshot consistency checks passed. The production build is required during packaging. Browser automation QA is unavailable in this environment; UI behavior is exercised through the existing DOM harness. Provider calls in these checks use authored test responses.
