import type { EpisodeV2Job } from "./contracts.ts";
import type { EpisodeDatabase } from "./persistence.ts";
import { allowanceUsed } from "./usage.ts";
import { audioHeldUsd } from "./audio-state.ts";

export const INVITE_ALLOWANCE_MICROUSD = 5_000_000;
const units = (usd: number) => Math.ceil(usd * 1_000_000);
export class InviteAllowanceError extends Error {
  constructor() { super("Your invitation's total creation allowance is used or reserved by a saved episode."); }
}
export function isEpisodeOwner(userId: string, ownerId?: string) {
  if (!ownerId?.trim()) throw new Error("The creation owner is not configured.");
  return userId === ownerId;
}
export async function remainingInviteAllowance(db: EpisodeDatabase, userId: string, ownerId?: string) {
  if (isEpisodeOwner(userId, ownerId)) return null;
  const row = await db.prepare("SELECT COALESCE(SUM(amount_microusd), 0) AS held FROM episode_allowance_holds WHERE user_id = ?")
    .bind(userId).first<{ held: number }>();
  return Math.max(0, INVITE_ALLOWANCE_MICROUSD - (row?.held ?? 0)) / 1_000_000;
}
/** One atomic statement reserves the whole job ceiling across all this visitor's episodes. */
export async function reserveInviteAllowance(db: EpisodeDatabase, job: EpisodeV2Job, ownerId?: string) {
  if (isEpisodeOwner(job.userId, ownerId)) return;
  const amount = units(job.config.limits.spendCeilingUsd ?? 0);
  const result = await db.prepare(`INSERT INTO episode_allowance_holds (episode_id, user_id, amount_microusd)
    SELECT ?, ?, ? WHERE ? + COALESCE((SELECT SUM(amount_microusd) FROM episode_allowance_holds WHERE user_id = ? AND episode_id != ?), 0) <= ?
    ON CONFLICT(episode_id) DO UPDATE SET amount_microusd = excluded.amount_microusd WHERE user_id = excluded.user_id`)
    .bind(job.id, job.userId, amount, amount, job.userId, job.id, INVITE_ALLOWANCE_MICROUSD).run();
  if (!result.meta.changes) throw new InviteAllowanceError();
}
export async function assertInviteReservation(db: EpisodeDatabase, job: EpisodeV2Job, ownerId?: string) {
  if (isEpisodeOwner(job.userId, ownerId)) return;
  const row = await db.prepare("SELECT amount_microusd FROM episode_allowance_holds WHERE episode_id = ? AND user_id = ?")
    .bind(job.id, job.userId).first<{ amount_microusd: number }>();
  if (!row || row.amount_microusd < units(job.config.limits.spendCeilingUsd ?? 0)) throw new InviteAllowanceError();
}
export async function releaseUncreatedReservation(db: EpisodeDatabase, id: string, userId: string) {
  await db.prepare("DELETE FROM episode_allowance_holds WHERE episode_id = ? AND user_id = ? AND NOT EXISTS (SELECT 1 FROM episodes WHERE id = ?)")
    .bind(id, userId, id).run();
}
/** Refund unused authorization only after a final stop; unknown paid work keeps its reservation. */
export async function settleInviteAllowance(db: EpisodeDatabase, job: EpisodeV2Job, ownerId?: string) {
  if (isEpisodeOwner(job.userId, ownerId)) return;
  if (!(job.status === "ready" || job.status === "failed" || job.pause?.code === "cancelled")) return;
  if (job.state.usageLedger?.records.some(record => record.boundExceeded)) return;
  const held = units((job.state.usageLedger ? allowanceUsed(job.state.usageLedger) : 0) + audioHeldUsd(job.state.audioPipeline));
  await db.prepare(`UPDATE episode_allowance_holds SET amount_microusd = MIN(amount_microusd, ?)
    WHERE episode_id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM episodes WHERE id = ? AND user_id = ?
    AND (status IN ('ready', 'failed') OR (status = 'paused' AND json_extract(job_json, '$.pause.code') = 'cancelled')) AND job_json = ?)`)
    .bind(held, job.id, job.userId, job.id, job.userId, JSON.stringify(job)).run();
}
