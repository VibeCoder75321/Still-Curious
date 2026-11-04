import { env } from "cloudflare:workers";
import { decodeStoredEpisodeJob, type StoredEpisodeJob } from "../../lib/episode-v2/contracts";
import { textPilotActions } from "../../lib/episode-v2/app-controls";
import { audioActions, audioConfigured } from "../../lib/episode-v2/audio";
import { audioHeldUsd } from "../../lib/episode-v2/audio-state";
import { APP_EPISODE_CAP_USD } from "../../lib/episode-v2/app-policy";
import { savedStepFailureMessage } from "../../lib/episode-v2/pause-message";

export type EpisodeJob = StoredEpisodeJob;

export function json(data: unknown, status = 200, headers?: HeadersInit) {
  const safeHeaders = new Headers(headers);
  if (!safeHeaders.has("Cache-Control")) safeHeaders.set("Cache-Control", "private, no-store");
  return Response.json(data, { status, headers: safeHeaders });
}

export function userIdFrom(request: Request) {
  return request.headers.get("oai-authenticated-user-id")?.trim() || null;
}

export function hasSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

export function database() {
  if (!env.DB) throw new Error("D1 database binding is unavailable.");
  return env.DB;
}

export function bucket() {
  if (!env.BUCKET) throw new Error("R2 audio binding is unavailable.");
  return env.BUCKET;
}

export async function ownedJob(id: string, userId: string) {
  const row = await database()
    .prepare("SELECT job_json FROM episodes WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<{ job_json: string }>();
  if (!row) return null;
  try {
    return decodeStoredEpisodeJob(row.job_json);
  } catch {
    throw new Error("Stored episode record is invalid.");
  }
}

export function storageActive(status: string, pauseCode?: string) {
  return ["running", "queued", "active"].includes(status)
    || (status === "paused" && !["cancelled", "text_checkpoint"].includes(pauseCode ?? ""));
}

export function publicJob(job: EpisodeJob) {
  const durationSeconds = typeof job.audio?.durationSeconds === "number" ? job.audio.durationSeconds : job.lengthMinutes * 60;
  const base = { id: job.id, topic: job.topic, title: job.title ?? job.topic, overview: job.topic, lengthMinutes: job.lengthMinutes, durationSeconds,
    status: job.status, stage: job.stage, createdAt: job.createdAt, updatedAt: job.updatedAt, ...(job.archivedAt !== undefined ? { archivedAt: job.archivedAt } : {}) };
  if (job.pipelineVersion === 2) {
    const sourceRecord = Object.values(job.state.artifacts).filter(value => value.kind === "source_records").sort((a, b) => b.version - a.version)[0];
    const readingSources = sourceRecord?.kind === "source_records" ? sourceRecord.data.sources.slice(0, 32).map(source => ({ title: source.title, url: source.url })) : [];
    const kinds = [...Object.values(job.state.artifacts).map(value => value.kind), ...Object.values(job.state.artifactBlobs ?? {}).map(value => value.artifact.kind)];
    const textReady = job.stage === "ready_for_audio" && !!job.state.finalScript;
    const labels: Record<string, [string, number]> = { commission: ["Shaping the episode", 5], research: ["Gathering research", 15], casting: ["Choosing specialists", 28],
      preparation: ["Preparing guests and host", 40], conversation: ["Recording the conversation", 60], editing: ["Editing the conversation", 80],
      review: ["Reviewing the episode", 90], ready_for_audio: ["Text ready", 100], tts: ["Recording audio", 94], assembling: ["Putting audio together", 98], ready: ["Ready to listen", 100] };
    const [label, percent] = labels[job.stage] ?? ["Saved episode", 0];
    const pauseReasons: Record<string, string> = {
      budget: "Creation is paused. Your saved progress is safe.",
      user_paused: "Paused by you. Continue when you are ready.", cancelled: "Stopped. Saved work is preserved; any request already submitted may still use its reserved allowance.",
      text_checkpoint: "The reviewed text is saved. You can download it; audio has not been generated.",
      audio_audition: "Listen to the four-voice audition, including its section transition. Accept it to render the remaining sections within the same audio allowance.",
      ambiguous_provider_result: "The last request needs checking. Continue is available only when its saved response can be retrieved safely.",
      needs_input: "This saved step needs attention before it can continue. Download the available text or research to review it.",
      material_review_issue: "A material editorial issue is held for review. The original conversation and research are preserved.",
    };
    return {
      ...base, schemaVersion: 2, pipelineVersion: 2, textOnly: job.textOnly === true, substep: job.substep, sources: readingSources,
      progress: { label, message: label, percent }, textReady, spendLimitUsd: job.config.limits.spendCeilingUsd,
      actions: { ...textPilotActions(job), start: textPilotActions(job).setBudget && (job.config.limits.spendCeilingUsd ?? 0) < APP_EPISODE_CAP_USD,
        ...audioActions(job), authorizeAudio: audioActions(job).authorizeAudio && audioConfigured(env) },
      audioAvailable: audioConfigured(env),
      ...(job.state.audioPipeline ? { audioProgress: { allowanceUsd: job.state.audioPipeline.allowanceUsd, heldUsd: audioHeldUsd(job.state.audioPipeline),
        completedSections: job.state.audioPipeline.current?.records.filter(record => record.phase === "completed").length ?? 0,
        totalSections: job.state.audioPipeline.current?.chunks.length ?? 0 } } : {}),
      ...(job.state.audioPipeline?.current?.audition ? { audition_url: `/api/episodes/${encodeURIComponent(job.id)}/audio?preview=audition`, auditionDurationSeconds: job.state.audioPipeline.current.audition.durationSeconds } : {}),
      ...(job.pause ? { pause: { code: job.pause.code, reason: savedStepFailureMessage(job) ?? pauseReasons[job.pause.code] ?? "The saved episode needs attention." } } : {}),
      ...(job.error ? { error: "This episode could not continue safely. Its saved work is preserved." } : {}),
      ...(kinds.includes("transcript") ? { transcript_url: `/api/episodes/${encodeURIComponent(job.id)}/transcript` } : {}),
      ...(kinds.some(kind => kind === "source_records" || kind === "evidence_pack") ? { research_url: `/api/episodes/${encodeURIComponent(job.id)}/research` } : {}),
      ...(job.status === "ready" && job.audioKey ? { audio_url: `/api/episodes/${encodeURIComponent(job.id)}/audio` } : {}),
    };
  }
  const outline = job.state?.artifacts?.outline as { title?: unknown } | undefined;
  const rawSources = Array.isArray(job.state?.sources) ? job.state.sources : Array.isArray(job.sources) ? job.sources : [];
  const sources = rawSources.filter((value): value is Record<string, unknown> => value !== null && typeof value === "object").slice(0, 32)
    .map(source => ({ title: typeof source.title === "string" ? source.title.slice(0, 500) : "Source", ...(typeof source.url === "string" && /^https?:\/\//i.test(source.url) ? { url: source.url } : {}),
      ...(typeof source.publisher === "string" ? { publisher: source.publisher.slice(0, 200) } : {}) }));
  return {
    ...base, schemaVersion: 1, pipelineVersion: 1,
    title: job.title ?? (typeof outline?.title === "string" ? outline.title : job.topic),
    progress: job.progress, sources,
    ...(job.error ? { error: job.error } : {}), ...(job.errorAmbiguous ? { errorAmbiguous: true } : {}),
    ...(job.providerError ? { providerError: job.providerError } : {}), ...(job.errorAction ? { errorAction: job.errorAction } : {}),
    ...(job.state.artifacts?.dossier ? { dossier_url: `/api/episodes/${encodeURIComponent(job.id)}/research` } : {}),
    ...(job.status === "ready" && job.audioKey
      ? { audio_url: `/api/episodes/${encodeURIComponent(job.id)}/audio` }
      : {}),
  };
}

export async function saveJob(job: EpisodeJob, lockToken?: string) {
  const now = Date.now();
  job.updatedAt = now;
  const activeUserId = storageActive(job.status, job.pipelineVersion === 2 ? job.pause?.code : undefined) ? job.userId : null;
  const query = lockToken
    ? database()
        .prepare(
          "UPDATE episodes SET status = ?, active_user_id = ?, job_json = ?, updated_at = ?, lock_token = NULL, lock_until = NULL WHERE id = ? AND lock_token = ?",
        )
        .bind(job.status, activeUserId, JSON.stringify(job), now, job.id, lockToken)
    : database()
        .prepare(
          "UPDATE episodes SET status = ?, active_user_id = ?, job_json = ?, updated_at = ? WHERE id = ? AND user_id = ?",
        )
        .bind(job.status, activeUserId, JSON.stringify(job), now, job.id, job.userId);
  const result = await query.run();
  if (!result.meta.changes) throw new Error("Episode update lost its ownership or lock.");
}
