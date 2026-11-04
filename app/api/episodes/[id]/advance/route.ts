import { env } from "cloudflare:workers";
import { advanceJob } from "../../../../../lib/episode-service";
import { advanceEpisode } from "../../../../../lib/episode-v2/advance-episode";
import { APP_EPISODE_CAP_USD } from "../../../../../lib/episode-v2/app-policy";
import { hasSameOrigin, json, ownedJob, publicJob, userIdFrom, type EpisodeJob } from "../../../_episodes";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return json({ error: "This request must come from the same site." }, 403);
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to continue this episode." }, 401);
  if (!env.DB) return json({ error: "Episode storage is unavailable." }, 503);
  const { id } = await context.params;
  let initial;
  try { initial = await ownedJob(id, userId); }
  catch { return json({ error: "The saved episode could not be read safely." }, 503); }
  if (!initial) return json({ error: "Episode not found." }, 404);
  if (initial.pipelineVersion === 2) {
    if (initial.status === "ready" || initial.status === "failed") return json(publicJob(initial));
    if ((initial.config.limits.spendCeilingUsd ?? 0) > APP_EPISODE_CAP_USD) return json({ error: "This earlier episode uses a different production limit. Start a new episode with the current workflow." }, 409);
    try {
      const result = await advanceEpisode(id, userId, env);
      return result.job ? json(publicJob(result.job), ["busy", "stale"].includes(result.disposition) ? 409 : 200)
        : json({ error: "Episode not found." }, 404);
    } catch {
      return json({ error: "The saved episode could not be advanced safely. No automatic resubmission was attempted." }, 503);
    }
  }
  if (initial.status === "running") return json({ error: "This earlier generation workflow is no longer available. Your saved episodes remain playable." }, 409);
  const now = Date.now();
  const lockToken = crypto.randomUUID();
  const acquired = await env.DB
    .prepare(
      "UPDATE episodes SET lock_token = ?, lock_until = ? WHERE id = ? AND user_id = ? AND status = 'running' AND lock_token IS NULL",
    )
    .bind(lockToken, now + 5 * 60_000, id, userId)
    .run();
  if (!acquired.meta.changes) {
    const existing = await ownedJob(id, userId);
    if (!existing) return json({ error: "Episode not found." }, 404);
    if (existing.status !== "running") return json(publicJob(existing));
    const row = await env.DB
      .prepare("SELECT lock_token, lock_until FROM episodes WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .first<{ lock_token: string | null; lock_until: number | null }>();
    if (row?.lock_token && row.lock_until !== null && row.lock_until <= now) {
      existing.status = "failed";
      existing.stage = "failed";
      existing.error = "Processing stopped after an interruption. It was not retried because a paid request may have completed.";
      existing.errorAmbiguous = true;
      existing.updatedAt = now;
      const stopped = await env.DB
        .prepare(
          "UPDATE episodes SET status = 'failed', active_user_id = NULL, job_json = ?, updated_at = ?, lock_token = NULL, lock_until = NULL WHERE id = ? AND user_id = ? AND status = 'running' AND lock_token = ? AND lock_until <= ?",
        )
        .bind(JSON.stringify(existing), now, id, userId, row.lock_token, now)
        .run();
      if (stopped.meta.changes) return json(publicJob(existing), 409);
      return json({ error: "This episode stopped after an interruption and cannot safely retry." }, 409);
    }
    return json({ error: "This episode is already being advanced." }, 409);
  }

  let job = await ownedJob(id, userId);
  if (!job) return json({ error: "Episode not found." }, 404);
  try {
    job = (await advanceJob(job, env)) as EpisodeJob;
    await saveLocked(job, lockToken);
    return json(publicJob(job));
  } catch {
    // An error after calling a provider may be ambiguous. Mark the job failed so
    // another request cannot unknowingly repeat that paid operation.
    job.status = "failed";
    job.error = "The episode could not continue safely. Start a new episode to try again.";
    job.updatedAt = Date.now();
    try {
      await saveLocked(job, lockToken);
    } catch {
      // The lease will expire if persistence itself is unavailable.
    }
    return json(publicJob(job), 502);
  }
}

async function saveLocked(job: EpisodeJob, lockToken: string) {
  job.updatedAt = Date.now();
  const result = await env.DB!
    .prepare(
      "UPDATE episodes SET status = ?, active_user_id = ?, job_json = ?, updated_at = ?, lock_token = NULL, lock_until = NULL WHERE id = ? AND user_id = ? AND lock_token = ?",
    )
    .bind(
      job.status,
      job.status === "running" ? job.userId : null,
      JSON.stringify(job),
      job.updatedAt,
      job.id,
      job.userId,
      lockToken,
    )
    .run();
  if (!result.meta.changes) throw new Error("Episode lock was lost.");
}
