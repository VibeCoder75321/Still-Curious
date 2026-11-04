import { applyTextPilotControl, textPilotActions } from "./app-controls.ts";
import { RETIRED_ATTEMPT_IDS } from "./library-history.ts";
import { createD1EpisodeStore, type EpisodeDatabase } from "./persistence.ts";

/** Bounded, recoverable owner-requested cleanup. Never submits provider work. */
export async function retirePreviousAttempts(db: EpisodeDatabase, ownerId: string) {
  const store = createD1EpisodeStore(db);
  for (const id of RETIRED_ATTEMPT_IDS) {
    const saved = await store.read(id, ownerId);
    if (!saved || !textPilotActions(saved).cancel) continue;
    const lease = await store.claim(id, ownerId);
    if (!lease) continue; // Retry on the next tick instead of interrupting a writer.
    try {
      if (textPilotActions(lease.job).cancel) {
        await store.save(lease, applyTextPilotControl(lease.job, { action: "cancel" }));
      }
    } finally { await store.release(lease); }
  }
}
