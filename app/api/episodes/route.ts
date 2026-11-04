import { env } from "cloudflare:workers";
import { decodeStoredEpisodeJob } from "../../../lib/episode-v2/contracts";
import { createPodcast, createTextPilot, parseTextPilotBudget } from "../../../lib/episode-v2/app-controls";
import { audioConfigured } from "../../../lib/episode-v2/audio";
import { appBudget, APP_AUDIO_ALLOWANCE_USD } from "../../../lib/episode-v2/app-policy";
import { ARCHIVED_PILOT_EPISODE_IDS } from "../../../lib/episode-v2/library-history";
import { InviteAllowanceError, remainingInviteAllowance, reserveInviteAllowance, releaseUncreatedReservation } from "../../../lib/episode-v2/invite-budget";
import {
  database,
  hasSameOrigin,
  json,
  publicJob,
  storageActive,
  userIdFrom,
  type EpisodeJob,
} from "../_episodes";

export async function GET(request: Request) {
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to view your episodes." }, 401);
  if (!env.DB) return json({ error: "Episode storage is unavailable." }, 503);
  try {
    const { results } = await env.DB
      .prepare(`SELECT job_json FROM episodes WHERE user_id = ? AND id NOT IN (${ARCHIVED_PILOT_EPISODE_IDS.map(() => "?").join(", ")}) ORDER BY updated_at DESC LIMIT 50`)
      .bind(userId, ...ARCHIVED_PILOT_EPISODE_IDS)
      .all<{ job_json: string }>();
    const jobs = results.map((row) => publicJob(decodeStoredEpisodeJob(row.job_json)));
    const archivedEpisodes = jobs.filter(job => job.archivedAt !== undefined);
    return json({ episodes: jobs.filter(job => job.archivedAt === undefined), archivedEpisodes,
      archivedEpisodeIds: [...ARCHIVED_PILOT_EPISODE_IDS, ...archivedEpisodes.map(job => job.id)] });
  } catch {
    return json({ error: "Your saved episodes could not be loaded safely." }, 503);
  }
}

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return json({ error: "This request must come from the same site." }, 403);
  const userId = userIdFrom(request);
  if (!userId) return json({ error: "Sign in to create an episode." }, 401);
  if (!env.DB) return json({ error: "Episode storage is unavailable." }, 503);
  let body: { topic?: unknown; lengthMinutes?: unknown; pipelineVersion?: unknown; textOnly?: unknown; spendCeilingUsd?: unknown; audioAllowanceUsd?: unknown; auditionFirst?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Send a valid JSON request." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Send a valid JSON request." }, 400);
  const topic = typeof body.topic === "string" ? body.topic.trim() : "";
  if (!topic || topic.length > 500) {
    return json({ error: "Enter a topic between 1 and 500 characters." }, 400);
  }
  if (body.lengthMinutes !== 5 && !(body.pipelineVersion === 2 && body.lengthMinutes === 15)) {
    return json({ error: "Choose a five- or fifteen-minute episode." }, 400);
  }
  if (body.pipelineVersion !== undefined && body.pipelineVersion !== 1 && body.pipelineVersion !== 2) {
    return json({ error: "Choose a supported pipeline version." }, 400);
  }
  const v2 = body.pipelineVersion === 2;
  if (!v2) return json({ error: "Create an episode with the current workflow. Earlier episodes remain available to listen to." }, 400);
  if (v2) {
    if (env.V2_TEXT_PILOT_ENABLED !== "true") return json({ error: "The V2 text pilot is unavailable." }, 503);
    if (!env.BUCKET || !env.OPENAI_API_KEY) return json({ error: "The V2 text pilot is not configured." }, 503);
    body.textOnly ??= false;
    if (typeof body.textOnly !== "boolean" || Object.keys(body).some(key => !["topic", "lengthMinutes", "pipelineVersion", "textOnly", "spendCeilingUsd", "audioAllowanceUsd", "auditionFirst"].includes(key))
      || (body.textOnly && ("audioAllowanceUsd" in body || "auditionFirst" in body))
      || (body.auditionFirst !== undefined && typeof body.auditionFirst !== "boolean")) {
      return json({ error: "Choose reviewed text or a complete audio episode with a spending limit." }, 400);
    }
    try {
      body.spendCeilingUsd = appBudget(body.spendCeilingUsd);
      if (!body.textOnly) {
        body.audioAllowanceUsd ??= APP_AUDIO_ALLOWANCE_USD;
        parseTextPilotBudget(body.audioAllowanceUsd);
        if (body.spendCeilingUsd != null && (body.audioAllowanceUsd as number) >= (body.spendCeilingUsd as number)) throw new Error("The audio allowance must leave room in the total limit for research and writing.");
      }
    }
    catch (error) { return json({ error: error instanceof Error ? error.message : "Enter a valid spending limit." }, 400); }
    if (!body.textOnly && !audioConfigured(env)) return json({ error: "Audio generation is temporarily unavailable. You can save a text-only episode." }, 503);
  }

  const now = Date.now();
  try {
    const remaining = await remainingInviteAllowance(database(), userId, env.EPISODE_OWNER_USER_ID);
    if (remaining !== null && body.spendCeilingUsd !== null) {
      const ceiling = Math.min(body.spendCeilingUsd as number, Math.floor((remaining + 1e-9) * 100) / 100);
      if (ceiling < 0.01 || (!body.textOnly && ceiling <= (body.audioAllowanceUsd as number))) return json({ error: "Your invitation has insufficient remaining creation allowance for this episode." }, 409);
      body.spendCeilingUsd = ceiling;
    }
  } catch { return json({ error: "Creation allowances are temporarily unavailable." }, 503); }
  const id = crypto.randomUUID();
  const v2Input = { id, userId, topic, now, lengthMinutes: body.lengthMinutes as 5 | 15, spendCeilingUsd: body.spendCeilingUsd as number | null | undefined };
  const job: EpisodeJob = v2 ? (body.textOnly ? createTextPilot(v2Input) : createPodcast({ ...v2Input,
    audioAllowanceUsd: body.audioAllowanceUsd as number, auditionFirst: body.auditionFirst === true })) : {
    id,
    userId,
    topic,
    title: topic,
    lengthMinutes: 5,
    status: "running",
    stage: "outline",
    progress: { message: "Ready to begin", completed: 0 },
    state: { artifacts: {}, sources: [] },
    createdAt: now,
    updatedAt: now,
  };
  try {
    const active = await database()
      .prepare("SELECT id FROM episodes WHERE user_id = ? AND active_user_id = ? LIMIT 1")
      .bind(userId, userId)
      .first();
    if (active) return json({ error: "Finish your current episode before starting another." }, 409);
    if (job.pipelineVersion === 2) await reserveInviteAllowance(database(), job, env.EPISODE_OWNER_USER_ID);
    await database()
      .prepare(
        "INSERT INTO episodes (id, user_id, active_user_id, status, job_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(id, userId, job.pipelineVersion === 2 || storageActive(job.status) ? userId : null, job.status, JSON.stringify(job), now, now)
      .run();
  } catch (error) {
    // Never refund an uncertain INSERT acknowledgement if the episode actually exists.
    await releaseUncreatedReservation(database(), id, userId).catch(() => {});
    if (error instanceof InviteAllowanceError) return json({ error: error.message }, 409);
    return json({ error: "An episode is already in progress. Finish it before starting another." }, 409);
  }
  return json(job.pipelineVersion === 2 ? publicJob(job) : { id, title: job.title, status: job.status, stage: job.stage }, 201);
}
