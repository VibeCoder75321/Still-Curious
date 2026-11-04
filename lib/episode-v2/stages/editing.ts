import { castPromptVersion } from "../personality-context.ts";
import { editReportSchema, type EpisodeV2Job } from "../contracts.ts";
import { conversationObservations } from "../conversation-observations.ts";
import { applyTurnPatches, loadPostProduction } from "../post-production.ts";
import {
  EDITING_GUIDANCE_VERSION, EDITING_INSTRUCTIONS, EDITING_JSON_SCHEMA, EDITING_PROMPT, editingOutputSchema,
} from "../prompts/editing.ts";
import type { StepPlan } from "../runner.ts";
import { PERSONALITY_REVIEW } from "../personality.ts";
import {
  artifactEnvelope, artifactRef, latestArtifactRef, StageBlockedError, type ArtifactReader,
} from "../stage-helpers.ts";

/** The accepted recording stays immutable; this report describes only traceable edits to it. */
export async function createEditingPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  if (job.stage !== "editing" || job.substep !== "edit") {
    throw new StageBlockedError("Finish and close the conversation before editing its accepted transcript.");
  }
  const data = await loadPostProduction(job, read);
  const key = `editing.edit:${data.transcript.version}`;
  const completedPasses = Object.values(job.state.execution?.steps ?? {}).filter(attempt =>
    attempt.key !== key && attempt.step.stage === "editing" && attempt.step.substep === "edit" && attempt.phase === "completed").length;
  if (completedPasses >= job.config.limits.maxEditPasses) {
    throw new StageBlockedError("The configured light editing pass allowance is exhausted.", "budget");
  }
  const version = (latestArtifactRef(job, "edit_report")?.version ?? 0) + 1;
  return {
    key, step: { stage: "editing", substep: "edit" },
    inputs: data.inputs,
    prompt: data.cast.data.personality ? { ...EDITING_PROMPT, version: castPromptVersion(data.cast) } : EDITING_PROMPT, editorialVersion: `${data.editorialVersion}/${EDITING_GUIDANCE_VERSION}`,
    request: {
      kind: "structured", role: "editing", instructions: EDITING_INSTRUCTIONS + (data.cast.data.personality ? `\n\n${PERSONALITY_REVIEW}` : ""),
      input: JSON.stringify({
        ...data.commonInput,
        acceptedTranscript: { reference: artifactRef(data.transcript), turns: data.transcript.data.turns },
        participation: conversationObservations(data.transcript.data.turns),
        editingBoundary: { preserveAcceptedRecording: true, maxPasses: job.config.limits.maxEditPasses,
          completedPasses, output: "Small patches to existing turns and an editorial summary" },
      }),
      schemaName: "still_curious_light_editing_v1", jsonSchema: EDITING_JSON_SCHEMA,
      parse: value => editingOutputSchema.parse(value),
    },
    finish(result, savedJob) {
      const output = editingOutputSchema.parse(result.value);
      const { editedTurns, changes } = applyTurnPatches(data.transcript.data.turns, output.patches);
      const report = editReportSchema.parse({
        ...artifactEnvelope(result, savedJob, "edit_report", version),
        data: { transcript: artifactRef(data.transcript), editedTurns, changes, summary: output.summary },
      });
      return {
        artifacts: [report], next: { stage: "review", substep: "assess" },
        progress: { message: "Light edit saved with the accepted conversation preserved", completed: 8 },
      };
    },
  };
}
