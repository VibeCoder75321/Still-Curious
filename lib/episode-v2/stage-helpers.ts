import type { ArtifactRef, EpisodeArtifact, EpisodeV2Job } from "./contracts.ts";
import type { ProviderResult } from "./providers.ts";

export type ArtifactReader = (ref: ArtifactRef) => Promise<EpisodeArtifact>;
export class StageBlockedError extends Error {
  readonly code: "needs_input" | "budget" | "material_review_issue";
  constructor(reason: string, code: "needs_input" | "budget" | "material_review_issue" = "needs_input") {
    super(reason); this.name = "StageBlockedError"; this.code = code;
  }
}
export function artifactRef<A extends EpisodeArtifact>(artifact: A): { id: string; kind: A["kind"]; version: number } {
  return { id: artifact.id, kind: artifact.kind, version: artifact.version };
}
/** All snapshots are immutable. Reject ambiguous heads rather than guessing by wall-clock time. */
export function latestArtifactRef<K extends EpisodeArtifact["kind"]>(job: EpisodeV2Job, kind: K): (ArtifactRef & { kind: K }) | undefined {
  const refs = [...Object.values(job.state.artifacts).map(artifactRef),
    ...Object.values(job.state.artifactBlobs ?? {}).map(blob => blob.artifact)]
    .filter(ref => ref.kind === kind).sort((a, b) => b.version - a.version);
  if (refs[0] && refs.some(ref => ref.version === refs[0].version && ref.id !== refs[0].id)) {
    throw new StageBlockedError(`Resolve the competing ${kind} versions before continuing.`);
  }
  return refs[0] as (ArtifactRef & { kind: K }) | undefined;
}
export async function requireLatestArtifact<K extends EpisodeArtifact["kind"]>(job: EpisodeV2Job, read: ArtifactReader, kind: K): Promise<Extract<EpisodeArtifact, { kind: K }>> {
  const ref = latestArtifactRef(job, kind);
  if (!ref) throw new StageBlockedError(`The saved ${kind} input is missing.`);
  const artifact = await read(ref);
  if (artifact.kind !== kind || artifact.id !== ref.id || artifact.version !== ref.version) throw new StageBlockedError(`The saved ${kind} input does not match its version.`);
  return artifact as Extract<EpisodeArtifact, { kind: K }>;
}
export function artifactEnvelope<K extends EpisodeArtifact["kind"]>(result: ProviderResult<unknown>, job: EpisodeV2Job, kind: K, version: number, id = `${kind.replaceAll("_", "-")}:${version}`) {
  const usage = job.state.usageLedger?.records.find(record => record.id === result.usageRecordId);
  if (!usage?.finishedAt) throw new Error("An artifact needs its settled provider usage record");
  return {
    schemaVersion: 2 as const, pipelineVersion: 2 as const, id, kind, version, createdAt: usage.finishedAt,
    provenance: { inputVersions: [] as ArtifactRef[], editorialVersion: "pending", prompt: null, modelConfiguration: null, usageRecordIds: [] as string[] },
  };
}
