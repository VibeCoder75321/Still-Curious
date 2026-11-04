import { env } from "cloudflare:workers";
import { decodeStoredEpisodeJob } from "../../../../../lib/episode-v2/contracts";
import { settleInviteAllowance } from "../../../../../lib/episode-v2/invite-budget";
import { hasSameOrigin, json, publicJob, userIdFrom } from "../../../_episodes";

/** Archive is a reversible listing change. Stopping never discards paid-work records. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return json({ error: "This request must come from the same site." }, 403);
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to manage your episodes." }, 401);
  if (!env.DB) return json({ error: "Episode storage is unavailable." }, 503);
  let action: "archive" | "restore";
  try {
    const body = await request.json() as Record<string, unknown>;
    if (!body || Object.keys(body).length !== 1 || typeof body.action !== "string" || !["archive", "restore"].includes(body.action)) throw new Error();
    action = body.action as typeof action;
  } catch { return json({ error: "Choose archive or restore." }, 400); }
  const { id } = await context.params;
  try {
    const row = await env.DB.prepare("SELECT job_json FROM episodes WHERE id = ? AND user_id = ?").bind(id, userId).first<{ job_json: string }>();
    if (!row) return json({ error: "Episode not found." }, 404);
    const job = decodeStoredEpisodeJob(row.job_json);
    if ((action === "archive") === (job.archivedAt !== undefined)) return json(publicJob(job));
    const now = Date.now();
    if (action === "archive") {
      job.archiveContext = { status: job.status, stage: job.stage, recordedAt: now,
        ...(job.pipelineVersion === 2 ? { substep: job.substep, ...(job.pause ? { pause: structuredClone(job.pause) } : {}) } : {}) };
      job.archivedAt = now;
      if (job.status === "running" || job.status === "paused") {
        if (job.pipelineVersion !== 2) return json({ error: "This older attempt cannot be stopped here." }, 409);
        job.status = "paused";
        job.pause = { code: "cancelled", reason: "Stopped and archived by you. Saved work and usage records are preserved." };
      }
    } else delete job.archivedAt; // Restoring never resumes a stopped job or makes paid requests.
    job.updatedAt = now;
    if (job.pipelineVersion === 2 && job.state.execution) job.state.execution.revision++;
    const next = decodeStoredEpisodeJob(job);
    const saved = await env.DB.prepare(`UPDATE episodes SET job_json = ?, status = ?, active_user_id = NULL, updated_at = ?, lock_token = NULL, lock_until = NULL
      WHERE id = ? AND user_id = ? AND job_json = ? AND (lock_token IS NULL OR lock_until <= ?)`)
      .bind(JSON.stringify(next), next.status, now, id, userId, row.job_json, now).run();
    if (!saved.meta.changes) return json({ error: "This episode is finishing a step. Try again shortly." }, 409);
    if (next.pipelineVersion === 2) await settleInviteAllowance(env.DB, next, env.EPISODE_OWNER_USER_ID);
    return json(publicJob(next));
  } catch { return json({ error: "The episode change could not be confirmed." }, 503); }
}
