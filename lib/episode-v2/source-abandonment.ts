import { episodeV2JobSchema, sourceRecordsSchema, assertStepTransition, type EpisodeV2Job, type SourceRecords } from "./contracts.ts";
import { artifactRef, latestArtifactRef } from "./stage-helpers.ts";
import { researchNext } from "./research-storage.ts";

/** Explicit operator decision only: keep unknown charges reserved; accept no reading result. */
export function prepareSourceAbandonment(job: EpisodeV2Job, previous: SourceRecords, decision: {
  stepKey: string; at: string; reason: string; authorization: string;
}): EpisodeV2Job {
  episodeV2JobSchema.parse(job); sourceRecordsSchema.parse(previous);
  const next = structuredClone(job), attempt = next.state.execution?.steps[decision.stepKey];
  const record = next.state.usageLedger?.records.find(value => value.id === attempt?.usageRecordId);
  const latest = latestArtifactRef(job, "source_records"), metadata = previous.data.research;
  const sourceId = metadata?.pendingSourceIds[0];
  if (job.status !== "paused" || job.pause?.code !== "ambiguous_provider_result" || job.stage !== "research" || job.substep !== "read"
    || attempt?.phase !== "uncertain" || attempt.step.stage !== "research" || attempt.step.substep !== "read"
    || !record || record.role !== "source" || !["reserved", "uncertain"].includes(record.outcome) || record.responseId || record.abandonment || record.boundExceeded
    || !sourceId || !metadata || latest?.id !== previous.id || latest.version !== previous.version
    || decision.stepKey !== `research.read:${previous.version + 1}:${sourceId}`
    || !attempt.inputs.some(ref => ref.kind === "source_records" && ref.id === previous.id && ref.version === previous.version)
    || !decision.reason.trim() || !decision.authorization.trim() || !Number.isFinite(Date.parse(decision.at))) {
    throw new Error("Only the current unknown source-reading result may be explicitly abandoned with recorded authorization");
  }
  record.outcome = "uncertain";
  record.abandonment = { at: decision.at, sourceId, reason: decision.reason, authorization: decision.authorization };
  record.allowanceUsd = record.reservedUsd;
  record.unknownCosts = [...new Set([...record.unknownCosts, "Abandoned result: actual usage and charges remain unknown; full allowance retained."])];
  attempt.phase = "failed"; attempt.resultRefs = []; attempt.reason = "Explicitly abandoned unknown source result; do not retry.";
  attempt.updatedAt = Date.parse(decision.at); delete attempt.nextPollAt;
  const data = structuredClone(previous.data), research = data.research!;
  research.pendingSourceIds = research.pendingSourceIds.filter(id => id !== sourceId);
  research.skippedSourceIds = [...(research.skippedSourceIds ?? []), sourceId];
  const note = `No reading result accepted for ${sourceId}: ${decision.reason}`;
  research.gaps = [...research.gaps, note];
  data.sources.find(source => source.id === sourceId)!.accessNote += ` ${note}`;
  const step = researchNext(next, research);
  const artifact = sourceRecordsSchema.parse({
    ...previous, id: `source-records:${previous.version + 1}`, version: previous.version + 1, createdAt: decision.at, data,
    provenance: { inputVersions: [artifactRef(previous)], editorialVersion: "operator-source-abandonment-v1", prompt: null,
      modelConfiguration: null, usageRecordIds: [] },
  });
  next.state.artifacts[artifact.id] = artifact;
  next.status = "running"; delete next.pause;
  assertStepTransition({ stage: "research", substep: "read" }, step);
  next.stage = step.stage; next.substep = step.substep;
  next.progress = { message: "Unknown source result abandoned by approved recovery; full allowance retained." };
  return episodeV2JobSchema.parse(next);
}
