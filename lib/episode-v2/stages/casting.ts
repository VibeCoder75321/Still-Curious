import { castSchema, type EpisodeV2Job } from "../contracts.ts";
import { requireFrozenEvidence } from "../evidence-foundation.ts";
import { artifactEnvelope, artifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "../stage-helpers.ts";
import { CASTING_GUIDANCE_VERSION, CASTING_INSTRUCTIONS, CASTING_JSON_SCHEMA, CASTING_PROMPT, castingInput, castingOutputSchema } from "../prompts/casting.ts";
import { FRAMEWORK_VERSION } from "../prompts/producer.ts";
import type { StepPlan } from "../runner.ts";
import { buildPersonalityManifest } from "../personality.ts";
import { buildCoherentManifest } from "../coherent-personality.ts";
import { DISCUSSION_VERSION } from "../discussion-design.ts";
import { GUEST_RUNTIME_CONTRACT } from "../prompts/personality-guest.ts";
import { PERSONALITY_CASTING_INSTRUCTIONS, PERSONALITY_CASTING_JSON_SCHEMA, PERSONALITY_CASTING_PROMPT, personalityCastingOutputSchema } from "../prompts/personality-casting.ts";

export const CASTING_STEP_KEY = "casting.cast:1";
export const CAST_ID = "cast:1";

/** One immutable cast is reused throughout this episode; its identities are assigned by the server. */
export async function createCastingPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  const evidence = await requireFrozenEvidence(job, read);
  const brief = await requireLatestArtifact(job, read, "episode_brief");
  const personalized = !!job.state.personalitySeed;
  const coherent = job.state.discussionVersion === DISCUSSION_VERSION;
  const outputSchema = personalized ? personalityCastingOutputSchema : castingOutputSchema;
  if ((job.state.artifacts[CAST_ID] || job.state.artifactBlobs?.[CAST_ID])
    && job.state.execution?.steps[CASTING_STEP_KEY]?.phase !== "completed") {
    throw new StageBlockedError("The saved cast needs reconciliation before its characters can be regenerated.");
  }
  return {
    key: CASTING_STEP_KEY, step: { stage: "casting", substep: "cast" }, inputs: [artifactRef(brief), artifactRef(evidence)],
    prompt: coherent ? { ...PERSONALITY_CASTING_PROMPT, version: DISCUSSION_VERSION } : personalized ? PERSONALITY_CASTING_PROMPT : CASTING_PROMPT, editorialVersion: `framework-${FRAMEWORK_VERSION}/${CASTING_GUIDANCE_VERSION}`,
    request: {
      kind: "structured", role: "casting", instructions: personalized ? PERSONALITY_CASTING_INSTRUCTIONS : CASTING_INSTRUCTIONS,
      input: personalized ? JSON.stringify({ ...JSON.parse(castingInput(job, brief, evidence)), personalitySeed: job.state.personalitySeed }) : castingInput(job, brief, evidence),
      schemaName: "still_curious_casting_v1", jsonSchema: personalized ? PERSONALITY_CASTING_JSON_SCHEMA : CASTING_JSON_SCHEMA, parse: value => outputSchema.parse(value),
    },
    finish(result, savedJob) {
      const output = outputSchema.parse(result.value);
      const claims = new Set(evidence.data.claims.filter(claim => claim.supportStatus !== "outside_material_read").map(claim => claim.id));
      if (output.guests.some(guest => guest.evidencePerspective.sharedClaimIds.some(id => !claims.has(id)))) {
        throw new Error("A cast perspective references a claim outside the frozen evidence.");
      }
      const shared = output.guests[0].evidencePerspective.sharedClaimIds.filter(id => output.guests.every(guest => guest.evidencePerspective.sharedClaimIds.includes(id)));
      if (!shared.length) throw new Error("All three specialists need enough overlap to engage at least one common evidence claim.");
      const cast = castSchema.parse({
        ...artifactEnvelope(result, savedJob, "cast", 1, CAST_ID),
        data: {
          host: { speaker: "host", ...output.host },
          guests: output.guests.map((guest, index) => ({ ...guest, fictional: true, speaker: `expert${index + 1}` })),
          evidencePack: artifactRef(evidence), perspectiveComparison: output.perspectiveComparison,
          ...(personalized ? { personality: (coherent ? buildCoherentManifest : buildPersonalityManifest)(savedJob.id, savedJob.topic,
            output.guests.map((guest, index) => ({ id: `expert${index + 1}` as "expert1" | "expert2" | "expert3", name: guest.name, expertise: guest.expertise.join("; ") })),
            savedJob.state.personalitySeed!, GUEST_RUNTIME_CONTRACT) } : {}),
        },
      });
      return { artifacts: [cast], next: { stage: "preparation", substep: "expert1" },
        progress: { message: "Three fictional specialists cast from the frozen evidence", completed: 5 } };
    },
  };
}
