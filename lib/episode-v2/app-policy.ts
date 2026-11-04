import { parseTextPilotBudget } from "./app-controls.ts";
import { allowanceUsed } from "./usage.ts";
import { audioHeldUsd } from "./audio-state.ts";
import type { EpisodeV2Job } from "./contracts.ts";

/** Operator policy: controls stay off the listening screen and cannot raise the episode cap. */
export const APP_EPISODE_CAP_USD = 5;
export const APP_AUDIO_ALLOWANCE_USD = 1.5;
export function appBudget(value: unknown = APP_EPISODE_CAP_USD): number | null {
  if (value === null) return null; // Retain explicitly saved, unstarted projects.
  const amount = parseTextPilotBudget(value);
  if (amount > APP_EPISODE_CAP_USD) throw new Error("This app's episode limit is fixed. It cannot be increased from a request.");
  return amount;
}
export function availableAudioAllowance(job: EpisodeV2Job) {
  if (!job.state.usageLedger) return 0;
  const remaining = (job.config.limits.spendCeilingUsd ?? 0) - allowanceUsed(job.state.usageLedger!) - audioHeldUsd(job.state.audioPipeline);
  return Math.max(0, Math.min(APP_AUDIO_ALLOWANCE_USD, Math.floor((remaining + 1e-9) * 100) / 100));
}
