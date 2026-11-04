import { castPromptVersion } from "../personality-context.ts";
import { editReportSchema, type ArtifactRef, type EditReport, type EpisodeReview, type EpisodeV2Job, type SpokenTurn } from "../contracts.ts";
import { applyTurnPatches, loadPostProduction, loadReviewEvidence } from "../post-production.ts";
import {
  LOCAL_REPAIR_INSTRUCTIONS, LOCAL_REPAIR_JSON_SCHEMA, LOCAL_REPAIR_PROMPT, localRepairOutputSchema,
  type LocalRepairOutput,
} from "../prompts/local-repair.ts";
import type { StepPlan } from "../runner.ts";
import { PERSONALITY_REVIEW } from "../personality.ts";
import { artifactEnvelope, artifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "../stage-helpers.ts";

const sameRef = (a: ArtifactRef, b: ArtifactRef) => a.id === b.id && a.kind === b.kind && a.version === b.version;
type RepairMode = "local" | "section";

function repairMode(job: EpisodeV2Job): RepairMode {
  if (job.stage !== "review" || !["local_edit", "section_revision"].includes(job.substep)) {
    throw new StageBlockedError("Choose a saved review repair substep before continuing.");
  }
  return job.substep === "local_edit" ? "local" : "section";
}

function allowedRepairTurns(turns: SpokenTurn[], original: SpokenTurn[], review: EpisodeReview, mode: RepairMode): string[] {
  const known = new Set(turns.map(turn => turn.id));
  const affected = new Set(review.data.issues.flatMap(issue => issue.turnIds));
  if ([...affected].some(id => !known.has(id))) {
    throw new StageBlockedError("The saved review refers to a passage absent from its edited episode.");
  }
  if (mode === "section") {
    for (const id of [...affected]) {
      const index = original.findIndex(turn => turn.id === id);
      if (index < 0) throw new StageBlockedError("The affected passage cannot be traced to the original accepted conversation.");
      for (const adjacent of [original[index - 1], original[index + 1]]) {
        if (adjacent && known.has(adjacent.id)) affected.add(adjacent.id);
      }
    }
  }
  return turns.filter(turn => affected.has(turn.id)).map(turn => turn.id);
}

async function completedRepairPasses(job: EpisodeV2Job, read: ArtifactReader, transcript: ArtifactRef, mode: RepairMode): Promise<number> {
  const refs = new Map<string, ArtifactRef>();
  for (const artifact of Object.values(job.state.artifacts)) {
    if (artifact.kind === "edit_report") refs.set(artifact.id, artifactRef(artifact));
  }
  for (const blob of Object.values(job.state.artifactBlobs ?? {})) {
    if (blob.artifact.kind === "edit_report") refs.set(blob.artifact.id, blob.artifact);
  }
  let count = 0;
  for (const ref of refs.values()) {
    const report = await read(ref);
    if (report.kind !== "edit_report" || !sameRef(artifactRef(report), ref)) {
      throw new StageBlockedError("A saved repair report does not match its immutable version.");
    }
    if (sameRef(report.data.transcript, transcript) && report.data.repair?.mode === mode && !report.data.repair.held) count++;
  }
  return count;
}

function validateRepair(value: unknown, review: EpisodeReview): LocalRepairOutput {
  const output = localRepairOutputSchema.parse(value);
  if (output.status === "repaired") {
    const required = new Set(review.data.issues.map(issue => issue.id));
    if (output.resolvedIssueIds.length !== required.size || output.resolvedIssueIds.some(id => !required.has(id))) {
      throw new Error("A repaired episode must explicitly resolve every issue from this review and no other issue");
    }
  }
  return output;
}

/** A bounded correction of the current edited episode; the original conversation remains immutable. */
export async function createRepairPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  const mode = repairMode(job);
  const context = await loadPostProduction(job, read);
  const edit = await requireLatestArtifact(job, read, "edit_report");
  const review = await requireLatestArtifact(job, read, "review");
  if (!sameRef(review.data.editReport, artifactRef(edit)) || !sameRef(edit.data.transcript, artifactRef(context.transcript))
    || !sameRef(review.data.evidencePack, artifactRef(context.evidence))) {
    throw new StageBlockedError("The review, edited episode and frozen evidence must refer to the same saved versions before repair.");
  }
  if (review.data.outcome !== (mode === "local" ? "acceptable_with_local_edit" : "revise_section")) {
    throw new StageBlockedError("The selected repair mode does not match the saved review outcome.");
  }
  const allowance = mode === "local" ? job.config.limits.maxLocalRepairPasses : job.config.limits.maxSectionRevisionPasses;
  if (await completedRepairPasses(job, read, edit.data.transcript, mode) >= allowance) {
    throw new StageBlockedError("The configured repair allowance is exhausted. Review the remaining material issue before continuing.", "material_review_issue");
  }
  const allowedTurnIds = allowedRepairTurns(edit.data.editedTurns, context.transcript.data.turns, review, mode);
  const supplements = await loadReviewEvidence(job, read, review);
  const version = edit.version + 1;
  return {
    key: `review.${job.substep}:${review.version}:${edit.version}`, step: { stage: "review", substep: mode === "local" ? "local_edit" : "section_revision" },
    inputs: [...context.inputs, artifactRef(edit), artifactRef(review), ...supplements.map(artifactRef)],
    prompt: context.cast.data.personality ? { ...LOCAL_REPAIR_PROMPT, version: castPromptVersion(context.cast) } : LOCAL_REPAIR_PROMPT, editorialVersion: context.editorialVersion,
    request: {
      kind: "structured", role: "local_repair", instructions: LOCAL_REPAIR_INSTRUCTIONS + (context.cast.data.personality ? `\n\n${PERSONALITY_REVIEW}` : ""),
      input: JSON.stringify({
        editorialContext: context.commonInput,
        repairMode: mode,
        editedEpisode: { reference: artifactRef(edit), turns: edit.data.editedTurns, summary: edit.data.summary },
        review: { reference: artifactRef(review), ...review.data },
        postConversationEvidence: supplements.map(supplement => ({ reference: artifactRef(supplement), ...supplement.data })),
        allowedTurnIds,
        boundary: "Change only the permitted words or section. Preserve all other episode text and speaker IDs exactly. The accepted original transcript remains saved separately.",
      }),
      schemaName: "still_curious_local_repair_v1", jsonSchema: LOCAL_REPAIR_JSON_SCHEMA,
      parse: value => validateRepair(value, review),
    },
    finish(result, savedJob) {
      const output = validateRepair(result.value, review);
      const held = output.status === "hold";
      const { editedTurns, changes } = applyTurnPatches(edit.data.editedTurns, output.patches, new Set(allowedTurnIds));
      const artifact: EditReport = editReportSchema.parse({
        ...artifactEnvelope(result, savedJob, "edit_report", version),
        data: {
          transcript: edit.data.transcript, previousEditReport: artifactRef(edit), editedTurns, changes,
          summary: output.summary,
          repair: { review: artifactRef(review), mode, resolvedIssueIds: output.resolvedIssueIds, nearbyCoherenceChecked: output.nearbyCoherenceChecked, held, reason: output.summary },
        },
      });
      return held ? {
        artifacts: [artifact], next: { stage: "review", substep: mode === "local" ? "local_edit" : "section_revision" },
        pause: { code: "material_review_issue", reason: output.summary },
        progress: { message: "Unresolved material review issue saved for an explicit editorial decision" },
      } : {
        artifacts: [artifact], next: { stage: "review", substep: "recheck" },
        progress: { message: mode === "local" ? "Affected passage repaired; nearby coherence checked" : "Affected section revised; nearby coherence checked" },
      };
    },
  };
}
