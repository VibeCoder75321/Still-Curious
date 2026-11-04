import { episodeV2JobSchema, type EpisodeV2Job } from "./contracts.ts";
import { createEpisodeConfig, type EpisodeLength } from "./config.ts";
import { createModelPolicy } from "./model-policy.ts";
import { createUsageLedger, type UsageLedger } from "./usage.ts";
import { audioActions } from "./audio.ts";

/** Dollar authorization is explicit, finite, and expressed to the cent. */
export function parseTextPilotBudget(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.01 || value > 1000
    || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) {
    throw new Error("Enter a spending limit from $0.01 to $1,000, in whole cents.");
  }
  return Math.round(value * 100) / 100;
}

function allocations(ceiling: number | null, audioAllowance = 0): UsageLedger["allocations"] {
  // Millionths of a dollar preserve the exact 35/45/20 allocation for cent limits.
  if (ceiling !== null && audioAllowance >= ceiling) throw new Error("Leave part of the total spending limit for research and writing.");
  const units = Math.round((ceiling === null ? 0 : ceiling - audioAllowance) * 1_000_000);
  const research = Math.floor(units * 0.35), text = Math.floor(units * 0.45);
  return { research: research / 1_000_000, text: text / 1_000_000, review: (units - research - text) / 1_000_000, audio: ceiling === null ? 0 : audioAllowance };
}

/** One explicit cap covers research, writing, review and the requested audio. */
export function createPodcast(input: Parameters<typeof createTextPilot>[0] & { audioAllowanceUsd: number; auditionFirst?: boolean }): EpisodeV2Job {
  const job = createTextPilot(input);
  const allowanceUsd = parseTextPilotBudget(input.audioAllowanceUsd);
  delete job.textOnly;
  job.requestedAudio = { allowanceUsd, auditionFirst: input.auditionFirst === true };
  job.state.usageLedger!.allocations = allocations(job.config.limits.spendCeilingUsd, allowanceUsd);
  return episodeV2JobSchema.parse(job);
}

export function createTextPilot(input: {
  id: string; userId: string; topic: string; lengthMinutes?: EpisodeLength; spendCeilingUsd?: number | null; now: number;
}): EpisodeV2Job {
  const ceiling = input.spendCeilingUsd == null ? null : parseTextPilotBudget(input.spendCeilingUsd);
  const config = createEpisodeConfig(input.lengthMinutes, { spendCeilingUsd: ceiling });
  return episodeV2JobSchema.parse({
    schemaVersion: 2, pipelineVersion: 2, textOnly: true,
    id: input.id, userId: input.userId, topic: input.topic, title: input.topic,
    lengthMinutes: config.lengthMinutes, status: ceiling === null ? "paused" : "running", stage: "commission", substep: "produce",
    config, progress: { message: ceiling === null ? "Set a spending limit to start the text pilot." : "Ready to begin the text pilot.", completed: 0 },
    state: { artifacts: {}, sources: [], personalitySeed: crypto.randomUUID(), discussionVersion: "1.7.0", modelPolicy: createModelPolicy(), usageLedger: createUsageLedger({
      spendCeilingUsd: ceiling, allocations: allocations(ceiling), maxOperations: config.limits.maxProviderOperations,
      maxSearchCalls: config.limits.maxSearchCalls, maxSourceReads: config.limits.maxSourceReads,
    }) },
    ...(ceiling === null ? { pause: { code: "budget", reason: "Set an explicit spending limit before generation can begin." } } : {}),
    createdAt: input.now, updatedAt: input.now,
  });
}

function unfinished(job: EpisodeV2Job) {
  const records = job.state.usageLedger?.records ?? [];
  return records.filter(record => ["reserved", "pending", "uncertain"].includes(record.outcome) && !record.abandonment);
}
function unfinishedAttempts(job: EpisodeV2Job) {
  return Object.values(job.state.execution?.steps ?? {}).filter(attempt => ["submitted", "pending", "uncertain"].includes(attempt.phase));
}
function canReconcile(job: EpisodeV2Job) {
  const records = unfinished(job);
  if (job.state.usageLedger?.records.some(record => record.boundExceeded)) return false;
  if (records.some(record => !record.responseId)) return false;
  const attempts = unfinishedAttempts(job);
  return attempts.every(attempt => records.some(record => record.id === attempt.usageRecordId && !!record.responseId))
    && records.every(record => attempts.some(attempt => attempt.usageRecordId === record.id));
}

export function textPilotActions(job: EpisodeV2Job) {
  const cancelled = job.pause?.code === "cancelled", checkpoint = job.pause?.code === "text_checkpoint";
  const paused = job.status === "paused";
  return {
    pause: job.status === "running",
    resume: canReconcile(job) && (job.status === "running" || (paused && (job.pause?.code === "user_paused"
      || (job.pause?.code === "ambiguous_provider_result" && (unfinished(job).length > 0 || audioActions(job).recoverAudio))))),
    cancel: (job.status === "running" || paused) && !cancelled && (!checkpoint || !!job.requestedAudio),
    setBudget: paused && job.pause?.code === "budget" && !!job.state.usageLedger && !job.state.audioPipeline
      && unfinished(job).length === 0 && unfinishedAttempts(job).length === 0
      && !job.state.usageLedger.records.some(record => record.boundExceeded),
  };
}

export type TextPilotControl = { action: "pause" | "resume" | "cancel" | "set_budget"; spendCeilingUsd?: unknown };
/** Pure state transition: callers must hold and save through the episode lease. */
export function applyTextPilotControl(job: EpisodeV2Job, control: TextPilotControl): EpisodeV2Job {
  const next = structuredClone(job), actions = textPilotActions(job);
  if (control.action === "pause" && job.status === "paused") return next;
  if (control.action === "pause" && actions.pause) {
    next.status = "paused"; next.pause = { code: "user_paused", reason: "Paused by you. Saved work and any pending provider response are preserved." };
  } else if (control.action === "resume" && actions.resume) {
    next.status = "running"; delete next.pause;
  } else if (control.action === "cancel" && actions.cancel) {
    next.status = "paused"; next.pause = { code: "cancelled", reason: "Cancelled by you. Saved work and usage records are preserved." };
  } else if (control.action === "set_budget" && actions.setBudget) {
    const ceiling = parseTextPilotBudget(control.spendCeilingUsd), previous = job.config.limits.spendCeilingUsd;
    if (previous !== null && ceiling <= previous) throw new Error("The new spending limit must exceed the existing limit.");
    next.config.limits.spendCeilingUsd = ceiling;
    next.state.usageLedger!.spendCeilingUsd = ceiling;
    next.state.usageLedger!.allocations = allocations(ceiling, next.requestedAudio?.allowanceUsd);
    next.status = "running"; delete next.pause;
  } else throw new Error("This action is unavailable for the episode's current state.");
  return episodeV2JobSchema.parse(next);
}
