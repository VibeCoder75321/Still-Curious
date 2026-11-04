import { advanceV2Job } from "./runner.ts";
import { advanceAudio, startRequestedAudio } from "./audio.ts";
import { createD1EpisodeStore } from "./persistence.ts";
import { APP_EPISODE_CAP_USD } from "./app-policy.ts";
import { assertInviteReservation, settleInviteAllowance } from "./invite-budget.ts";

/** Shared by signed-in controls and the server scheduler; identity always comes from saved ownership. */
export async function advanceEpisode(id: string, userId: string, env: Cloudflare.Env) {
  if (!env.DB) throw new Error("Episode storage is unavailable.");
  const store = createD1EpisodeStore(env.DB), initial = await store.read(id, userId);
  if (!initial) return { job: null, disposition: "waiting" as const };
  if (initial.archivedAt !== undefined) return { job: initial, disposition: "waiting" as const };
  if ((initial.config.limits.spendCeilingUsd ?? 0) > APP_EPISODE_CAP_USD) throw new Error("Episode exceeds the app limit.");
  if (initial.status === "ready" || initial.status === "failed") {
    await settleInviteAllowance(env.DB, initial, env.EPISODE_OWNER_USER_ID);
    return { job: initial, disposition: "waiting" as const };
  }
  await assertInviteReservation(env.DB, initial, env.EPISODE_OWNER_USER_ID);
  let result = ["tts", "assembling"].includes(initial.stage)
    ? await advanceAudio({ id, userId, store, env })
    : await advanceV2Job(id, userId, { DB: env.DB, BUCKET: env.BUCKET, OPENAI_API_KEY: env.OPENAI_API_KEY });
  if (result.job?.requestedAudio && result.job.pause?.code === "text_checkpoint" && !result.job.state.audioPipeline?.current)
    result = await startRequestedAudio(id, userId, store, env);
  if (result.job) await settleInviteAllowance(env.DB, result.job, env.EPISODE_OWNER_USER_ID);
  return result;
}
