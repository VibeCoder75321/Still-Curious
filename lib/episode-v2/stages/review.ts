import { assertFinalScriptApproved, editReportSchema, finalScriptSchema, reviewSchema, type EpisodeReview, type EpisodeV2Job } from "../contracts.ts";
import { conversationObservations } from "../conversation-observations.ts";
import { artifactRefsOfKind, loadPostProduction, loadReviewEvidence } from "../post-production.ts";
import { REVIEW_INSTRUCTIONS, REVIEW_JSON_SCHEMA, REVIEW_PROMPT, reviewOutputSchema, INTERACTION_JSON_SCHEMA, interactionReviewOutputSchema } from "../prompts/review.ts";
import type { StepPlan } from "../runner.ts";
import { PERSONALITY_REVIEW } from "../personality.ts";
import { isCoherentCast, castPromptVersion } from "../personality-context.ts";
import { INTERACTION_REVIEW_INSTRUCTIONS, validateInteractionReview } from "../discussion-design.ts";
import { artifactEnvelope, artifactRef, latestArtifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "../stage-helpers.ts";

const same = (a: { id: string; version: number }, b: { id: string; version: number }) => a.id === b.id && a.version === b.version;
export async function createReviewPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  const context = await loadPostProduction(job, read), edit = await requireLatestArtifact(job, read, "edit_report");
  const coherent = isCoherentCast(context.cast);
  if (!same(edit.data.transcript, context.transcript)) throw new StageBlockedError("The edited episode does not match the accepted conversation.");
  const recheck = job.substep === "recheck", key = `review.${job.substep}:${edit.version}`;
  const count = Object.values(job.state.execution?.steps ?? {}).filter(step => step.key !== key && step.phase === "completed"
    && step.step.stage === "review" && ["assess", "recheck"].includes(step.step.substep)).length;
  if (count >= job.config.limits.maxReviewPasses) throw new StageBlockedError("The configured whole-episode review allowance is exhausted. Hold the material issue for an editorial decision.", "material_review_issue");
  let previousReview: EpisodeReview | undefined;
  if (recheck) {
    if (!edit.data.repair || edit.data.repair.held || !edit.data.repair.nearbyCoherenceChecked) throw new StageBlockedError("Recheck requires a completed bounded repair and its coherence check.", "material_review_issue");
    const prior = await read(edit.data.repair.review);
    if (prior.kind !== "review") throw new StageBlockedError("The repaired issue's exact review is unavailable.");
    previousReview = prior;
    if (JSON.stringify([...new Set(edit.data.repair.resolvedIssueIds)].sort()) !== JSON.stringify(prior.data.issues.map(issue => issue.id).sort())) throw new StageBlockedError("The repaired version does not account for the exact material issues.", "material_review_issue");
  }
  const supplements = previousReview ? await loadReviewEvidence(job, read, previousReview) : [];
  const passageIds = new Set([...context.sources.data.sources, ...supplements.map(value => value.data.source)]
    .flatMap(source => source.passages.map(passage => JSON.stringify([source.id, passage.id]))));
  const turnIds = new Set(edit.data.editedTurns.map(turn => turn.id));
  const parse = (value: unknown) => {
    const output = coherent ? interactionReviewOutputSchema.parse(value) : reviewOutputSchema.parse(value);
    if (coherent) validateInteractionReview(interactionReviewOutputSchema.parse(value).interactionReview, edit.data.editedTurns);
    if (output.issues.some(issue => issue.turnIds.some(id => !turnIds.has(id)) || issue.passages.some(ref => !passageIds.has(JSON.stringify([ref.sourceId, ref.passageId]))))) throw new Error("A review issue must identify exact edited speech and saved evidence");
    return output;
  };
  const priorHead = latestArtifactRef(job, "review"), version = (priorHead?.version ?? 0) + 1;
  const repairs = await Promise.all(artifactRefsOfKind(job, "edit_report").map(async ref => editReportSchema.parse(await read(ref))));
  return {
    key, step: { stage: "review", substep: recheck ? "recheck" : "assess" },
    inputs: [...context.inputs, ...[edit, ...(previousReview ? [previousReview] : []), ...supplements].map(artifactRef)],
    prompt: context.cast.data.personality ? { ...REVIEW_PROMPT, version: castPromptVersion(context.cast) } : REVIEW_PROMPT, editorialVersion: context.editorialVersion,
    request: { kind: "structured", role: "review", instructions: REVIEW_INSTRUCTIONS + (context.cast.data.personality ? `\n\n${PERSONALITY_REVIEW}` : "") + (coherent ? `\n\n${INTERACTION_REVIEW_INSTRUCTIONS}` : ""),
      input: JSON.stringify({ ...context.commonInput, editedEpisode: { reference: artifactRef(edit), turns: edit.data.editedTurns, summary: edit.data.summary },
        ...(coherent ? { acceptedOriginalTurns: context.transcript.data.turns } : {}),
        participation: conversationObservations(edit.data.editedTurns),
        reviewMode: recheck ? "recheck" : "whole_episode", priorReview: previousReview ?? null, repair: edit.data.repair ?? null,
        supplementalEvidence: supplements, lookupAvailable: !recheck && artifactRefsOfKind(job, "review_evidence").length < (job.config.limits.maxPostConversationSourceReads ?? 1) }),
      schemaName: coherent ? "still_curious_episode_review_v17" : "still_curious_episode_review_v1", jsonSchema: coherent ? INTERACTION_JSON_SCHEMA : REVIEW_JSON_SCHEMA, parse },
    finish(result, savedJob) {
      const output = parse(result.value);
      const review = reviewSchema.parse({ ...artifactEnvelope(result, savedJob, "review", version),
        data: { ...output, editReport: artifactRef(edit), evidencePack: artifactRef(context.evidence) } });
      if (review.data.outcome === "acceptable") {
        const scriptVersion = (latestArtifactRef(savedJob, "final_script")?.version ?? 0) + 1;
        const script = finalScriptSchema.parse({ ...artifactEnvelope(result, savedJob, "final_script", scriptVersion),
          data: { cast: artifactRef(context.cast), editReport: artifactRef(edit), review: artifactRef(review), turns: edit.data.editedTurns,
            resolvedIssueIds: [], nearbyCoherenceChecked: recheck ? edit.data.repair!.nearbyCoherenceChecked : false } });
        assertFinalScriptApproved(script, review, edit);
        return { artifacts: [review, script], next: { stage: "ready_for_audio", substep: "wait" }, finalScript: artifactRef(script),
          pause: { code: "text_checkpoint", reason: "The exact reviewed script is accepted. Review the text pilot before authorizing audio generation." },
          progress: { message: "Reviewed final script accepted at the text checkpoint", textReady: true } };
      }
      const mode = review.data.outcome === "acceptable_with_local_edit" ? "local" : "section";
      const limit = mode === "local" ? savedJob.config.limits.maxLocalRepairPasses : savedJob.config.limits.maxSectionRevisionPasses;
      const used = repairs.filter(report => report.data.repair?.mode === mode).length;
      if (recheck || count + 1 >= savedJob.config.limits.maxReviewPasses || used >= limit) return {
        artifacts: [review], next: { stage: "review", substep: recheck ? "recheck" : "assess" },
        pause: { code: "material_review_issue", reason: "A consequential issue remains and the bounded review/repair allowance cannot safely resolve it. The accepted conversation is preserved." },
        progress: { message: "Material review issue saved for an editorial decision" },
      };
      if (review.data.lookupRequest && artifactRefsOfKind(savedJob, "review_evidence").length >= (savedJob.config.limits.maxPostConversationSourceReads ?? 1)) return {
        artifacts: [review], next: { stage: "review", substep: "assess" }, pause: { code: "material_review_issue", reason: "The consequential source question exceeds the post-conversation lookup allowance." },
      };
      return { artifacts: [review], next: { stage: "review", substep: review.data.lookupRequest ? "lookup" : mode === "local" ? "local_edit" : "section_revision" },
        progress: { message: review.data.lookupRequest ? "One consequential source question saved for bounded lookup" : "Affected passage saved for bounded correction" } };
    },
  };
}
