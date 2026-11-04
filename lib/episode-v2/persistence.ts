import { artifactSchema, episodeV2JobSchema, type ArtifactRef, type EpisodeArtifact, type EpisodeV2Job } from "./contracts.ts";

export const MAX_JOB_BYTES = 512 * 1024;
export const MAX_ARTIFACT_BYTES = 256 * 1024;
export const INLINE_RESEARCH_BYTES = 32 * 1024;
export const LEASE_MS = 5 * 60_000;
const bytes = (value: string) => new TextEncoder().encode(value);

export class StaleEpisodeError extends Error {
  constructor() { super("The episode or its lock changed; this result was not accepted"); this.name = "StaleEpisodeError"; }
}
type Statement = {
  bind(...values: (string | number | null)[]): Statement;
  run(): Promise<{ meta: { changes: number } }>;
  first<T>(): Promise<T | null>;
};
export type EpisodeDatabase = { prepare(sql: string): Statement };
export type ArtifactBucket = {
  put(key: string, value: string, options?: { httpMetadata: { contentType: string; cacheControl: string } }): Promise<unknown>;
  get(key: string): Promise<{ size: number; arrayBuffer(): Promise<ArrayBuffer> } | null>;
};
export type EpisodeLease = { id: string; userId: string; token: string; revision: number; json: string; job: EpisodeV2Job };
export interface EpisodeStore {
  read(id: string, userId: string): Promise<EpisodeV2Job | null>;
  claim(id: string, userId: string): Promise<EpisodeLease | null>;
  save(lease: EpisodeLease, job: EpisodeV2Job): Promise<void>;
  release(lease: EpisodeLease): Promise<void>;
}

/** Existing D1 columns are sufficient: the JSON revision and exact snapshot form the CAS. */
export function createD1EpisodeStore(db: EpisodeDatabase, options: { now?: () => number; token?: () => string } = {}): EpisodeStore {
  const now = options.now ?? Date.now, token = options.token ?? (() => crypto.randomUUID());
  return {
    async read(id, userId) {
      const row = await db.prepare("SELECT job_json FROM episodes WHERE id = ? AND user_id = ?").bind(id, userId).first<{ job_json: string }>();
      return row ? episodeV2JobSchema.parse(JSON.parse(row.job_json)) : null;
    },
    async claim(id, userId) {
      const lockToken = token(), at = now();
      const changed = await db.prepare("UPDATE episodes SET lock_token = ?, lock_until = ? WHERE id = ? AND user_id = ? AND status IN ('running', 'paused') AND json_extract(job_json, '$.pipelineVersion') = 2 AND (lock_token IS NULL OR lock_until <= ?)")
        .bind(lockToken, at + LEASE_MS, id, userId, at).run();
      if (!changed.meta.changes) return null;
      const row = await db.prepare("SELECT job_json FROM episodes WHERE id = ? AND user_id = ? AND lock_token = ?")
        .bind(id, userId, lockToken).first<{ job_json: string }>();
      if (!row) throw new StaleEpisodeError();
      const job = episodeV2JobSchema.parse(JSON.parse(row.job_json));
      return { id, userId, token: lockToken, revision: job.state.execution?.revision ?? 0, json: row.job_json, job };
    },
    async save(lease, job) {
      if (job.id !== lease.id || job.userId !== lease.userId || (job.state.execution?.revision ?? 0) !== lease.revision) throw new StaleEpisodeError();
      job.state.execution ??= { revision: 0, steps: {} };
      job.state.execution.revision = lease.revision + 1; job.updatedAt = now();
      episodeV2JobSchema.parse(job);
      const json = JSON.stringify(job);
      if (bytes(json).length > MAX_JOB_BYTES) throw new Error("Episode state exceeds its private storage allowance");
      const active = job.status === "running" || (job.status === "paused" && (!(["cancelled", "text_checkpoint"].includes(job.pause!.code))
        || (job.pause!.code === "text_checkpoint" && !!job.requestedAudio)));
      const changed = await db.prepare("UPDATE episodes SET status = ?, active_user_id = ?, job_json = ?, updated_at = ? WHERE id = ? AND user_id = ? AND lock_token = ? AND lock_until > ? AND COALESCE(json_extract(job_json, '$.state.execution.revision'), 0) = ? AND job_json = ?")
        .bind(job.status, active ? job.userId : null, json, now(), job.id, job.userId, lease.token, now(), lease.revision, lease.json).run();
      if (!changed.meta.changes) throw new StaleEpisodeError();
      lease.revision = job.state.execution.revision; lease.json = json; lease.job = job;
    },
    async release(lease) {
      await db.prepare("UPDATE episodes SET lock_token = NULL, lock_until = NULL WHERE id = ? AND user_id = ? AND lock_token = ?")
        .bind(lease.id, lease.userId, lease.token).run();
    },
  };
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("Step inputs must be JSON values");
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, v]) => `${JSON.stringify(key)}:${canonicalJson(v)}`).join(",")}}`;
}
export async function sha256(value: string | ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", typeof value === "string" ? bytes(value) : value);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, "0")).join("");
}
const objectKey = (job: EpisodeV2Job, hash: string) => `episodes/${encodeURIComponent(job.userId)}/${encodeURIComponent(job.id)}/artifacts/${hash}.json`;

export async function saveArtifact(job: EpisodeV2Job, value: EpisodeArtifact, bucket?: ArtifactBucket): Promise<ArtifactRef> {
  const item = artifactSchema.parse(value);
  if (job.state.artifacts[item.id] || job.state.artifactBlobs?.[item.id]) throw new Error("Artifacts are immutable; use a new ID for a revised version");
  const json = canonicalJson(item), size = bytes(json).length;
  if (size > MAX_ARTIFACT_BYTES) throw new Error("Artifact exceeds its private storage allowance");
  const reference = { id: item.id, kind: item.kind, version: item.version };
  if (((item.kind === "source_records" || item.kind === "evidence_pack") && size > INLINE_RESEARCH_BYTES)
    || (item.kind === "transcript" && bucket)) {
    if (!bucket) throw new Error("Private research storage is unavailable");
    const hash = await sha256(json), key = objectKey(job, hash);
    await bucket.put(key, json, { httpMetadata: { contentType: "application/json", cacheControl: "private, no-store" } });
    job.state.artifactBlobs ??= {};
    job.state.artifactBlobs[item.id] = { artifact: reference, sha256: hash, bytes: size, key };
  } else job.state.artifacts[item.id] = item;
  return reference;
}

export async function readArtifact(job: EpisodeV2Job, reference: ArtifactRef, bucket?: ArtifactBucket): Promise<EpisodeArtifact> {
  let item = job.state.artifacts[reference.id];
  if (!item) {
    const blob = job.state.artifactBlobs?.[reference.id];
    if (!blob || !bucket || blob.key !== objectKey(job, blob.sha256)) throw new Error("Owned artifact is unavailable");
    const saved = await bucket.get(blob.key);
    if (!saved || saved.size !== blob.bytes || saved.size > MAX_ARTIFACT_BYTES) throw new Error("Saved artifact size does not match");
    const data = await saved.arrayBuffer();
    if (data.byteLength !== blob.bytes || await sha256(data) !== blob.sha256) throw new Error("Saved artifact failed its integrity check");
    item = artifactSchema.parse(JSON.parse(new TextDecoder().decode(data)));
  }
  if (item.id !== reference.id || item.kind !== reference.kind || item.version !== reference.version) throw new Error("Artifact input version does not match");
  return item;
}
