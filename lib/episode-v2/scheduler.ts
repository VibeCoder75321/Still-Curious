import { advanceEpisode } from "./advance-episode.ts";
import { retirePreviousAttempts } from "./retire-attempts.ts";
import { RETIRED_ATTEMPT_IDS } from "./library-history.ts";

export const SCHEDULER_FRESH_MS = 120_000;
const RUN_MS = 8 * 60_000, LEASE_MS = 10 * 60_000;
export async function backgroundSchedulerActive(db?: Cloudflare.Env["DB"], now = Date.now()) {
  if (!db) return false;
  try {
    const row = await db.prepare("SELECT last_tick FROM episode_scheduler_health WHERE id = 1").first<{ last_tick: number }>();
    return !!row && row.last_tick <= now && now - row.last_tick < SCHEDULER_FRESH_MS;
  } catch { return false; }
}

/** No public worker endpoint and no caller-supplied owner IDs. Holds and budgets remain authoritative. */
export async function runEpisodeScheduler(env: Cloudflare.Env, options: {
  now?: () => number; wait?: (ms: number) => Promise<void>; advance?: typeof advanceEpisode; maxRunMs?: number;
} = {}) {
  if (!env.DB || !env.EPISODE_OWNER_USER_ID) return { claimed: false, operations: 0 };
  const now = options.now ?? Date.now, wait = options.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const advance = options.advance ?? advanceEpisode, started = now(), token = crypto.randomUUID();
  const claimed = await env.DB.prepare(`INSERT INTO episode_scheduler_health (id, last_tick, lease_token, lease_until)
    VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET last_tick = excluded.last_tick,
    lease_token = excluded.lease_token, lease_until = excluded.lease_until WHERE lease_until IS NULL OR lease_until <= ?`)
    .bind(started, token, started + LEASE_MS, started).run();
  if (!claimed.meta.changes) return { claimed: false, operations: 0 };
  let operations = 0;
  const skipped = new Set<string>();
  try {
    await retirePreviousAttempts(env.DB, env.EPISODE_OWNER_USER_ID);
    while (now() - started < Math.min(options.maxRunMs ?? RUN_MS, RUN_MS)) {
      const heartbeat = await env.DB.prepare("UPDATE episode_scheduler_health SET last_tick = ? WHERE id = 1 AND lease_token = ? AND lease_until > ?")
        .bind(now(), token, now()).run();
      if (!heartbeat.meta.changes) break;
      const { results } = await env.DB.prepare(`SELECT id, user_id FROM episodes WHERE status = 'running'
        AND json_extract(job_json, '$.pipelineVersion') = 2 ORDER BY updated_at ASC LIMIT 16`).all<{ id: string; user_id: string }>();
      const jobs = results.filter(row => !skipped.has(row.id)
        && !(RETIRED_ATTEMPT_IDS as readonly string[]).includes(row.id));
      if (!jobs.length) break;
      for (const job of jobs) {
        if (now() - started >= Math.min(options.maxRunMs ?? RUN_MS, RUN_MS)) break;
        try { await advance(job.id, job.user_id, env); operations++; }
        catch { skipped.add(job.id); console.error("Episode scheduler: a saved job could not advance safely."); }
      }
      await wait(2000);
    }
  } finally {
    await env.DB.prepare("UPDATE episode_scheduler_health SET last_tick = ?, last_finished = ?, lease_token = NULL, lease_until = NULL WHERE id = 1 AND lease_token = ?")
      .bind(now(), now(), token).run();
  }
  return { claimed: true, operations };
}
