import { env } from "cloudflare:workers";
import { applyTextPilotControl, type TextPilotControl } from "../../../../../lib/episode-v2/app-controls";
import { createD1EpisodeStore, StaleEpisodeError, type EpisodeLease } from "../../../../../lib/episode-v2/persistence";
import { hasSameOrigin, json, ownedJob, publicJob, userIdFrom } from "../../../_episodes";
import { applyAudioControl, authorizeAudio } from "../../../../../lib/episode-v2/audio";
import { appBudget, APP_EPISODE_CAP_USD, availableAudioAllowance } from "../../../../../lib/episode-v2/app-policy";
import { reserveInviteAllowance, settleInviteAllowance } from "../../../../../lib/episode-v2/invite-budget";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!hasSameOrigin(request)) return json({ error: "This request must come from the same site." }, 403);
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to control this episode." }, 401);
  if (!env.DB) return json({ error: "Episode storage is unavailable." }, 503);
  let control: { action: TextPilotControl["action"] | "authorize_audio" | "accept_audition" | "invalidate_audio"; spendCeilingUsd?: unknown; audioAllowanceUsd?: number; auditionFirst?: boolean };
  try {
    const value: unknown = await request.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    const body = value as Record<string, unknown>;
    if (typeof body.action !== "string"
      || !["pause", "resume", "cancel", "set_budget", "authorize_audio", "accept_audition", "invalidate_audio"].includes(body.action)
      || Object.keys(body).some(key => !["action", "spendCeilingUsd", "audioAllowanceUsd", "auditionFirst"].includes(key))
      || (body.action !== "set_budget" && "spendCeilingUsd" in body)
      || (body.action !== "authorize_audio" && "audioAllowanceUsd" in body)
      || ("auditionFirst" in body && (body.action !== "authorize_audio" || typeof body.auditionFirst !== "boolean"))
      || ("audioAllowanceUsd" in body && typeof body.audioAllowanceUsd !== "number")) throw new Error();
    control = { action: body.action as typeof control.action, ...(body.action === "set_budget" ? { spendCeilingUsd: body.spendCeilingUsd } : {}),
      ...(body.action === "authorize_audio" ? { audioAllowanceUsd: body.audioAllowanceUsd as number, ...(typeof body.auditionFirst === "boolean" ? { auditionFirst: body.auditionFirst } : {}) } : {}) };
  } catch { return json({ error: "Send a valid episode control action." }, 400); }
  const { id } = await context.params;
  let initial;
  try { initial = await ownedJob(id, userId); }
  catch { return json({ error: "The saved episode could not be loaded safely." }, 503); }
  if (!initial) return json({ error: "Episode not found." }, 404);
  if (initial.archivedAt !== undefined) return json({ error: "Restore this episode before using its controls." }, 409);
  if (initial.pipelineVersion !== 2) return json({ error: "These controls are available for V2 episodes." }, 409);
  if ((initial.config.limits.spendCeilingUsd ?? 0) > APP_EPISODE_CAP_USD && control.action !== "cancel") return json({ error: "This earlier episode uses a different production limit. Start a new episode with the current workflow." }, 409);
  const store = createD1EpisodeStore(env.DB);
  let lease: EpisodeLease | null = null;
  try {
    lease = await store.claim(id, userId);
    if (!lease) return json({ error: "The episode is busy or no longer accepts this action." }, 409);
    if (lease.job.archivedAt !== undefined) return json({ error: "Restore this episode before using its controls." }, 409);
    let next;
    try {
      next = control.action === "authorize_audio" ? await authorizeAudio(lease.job, env, control.audioAllowanceUsd ?? availableAudioAllowance(lease.job), Date.now(), control.auditionFirst ?? false)
        : control.action === "accept_audition" || control.action === "invalidate_audio" ? applyAudioControl(lease.job, control.action)
        : applyTextPilotControl(lease.job, control.action === "set_budget" ? { action: "set_budget", spendCeilingUsd: appBudget(control.spendCeilingUsd) } : control as TextPilotControl);
    }
    catch (error) { return json({ error: error instanceof Error ? error.message : "This action is unavailable." }, 409); }
    if (next.status === "running") await reserveInviteAllowance(env.DB, next, env.EPISODE_OWNER_USER_ID);
    await store.save(lease, next);
    await settleInviteAllowance(env.DB, next, env.EPISODE_OWNER_USER_ID);
    return json(publicJob(next));
  } catch (error) {
    return json({ error: error instanceof StaleEpisodeError ? "The episode changed. Refresh before trying again." : "The episode control could not be saved." }, error instanceof StaleEpisodeError ? 409 : 503);
  } finally { if (lease) await store.release(lease); }
}
