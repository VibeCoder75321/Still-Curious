import type { EpisodeV2Job, GuestSpeaker } from "../contracts.ts";
import { GUEST_INSTRUCTIONS, GUEST_PROMPT } from "../prompts/guest.ts";
import type { ArtifactReader } from "../stage-helpers.ts";
import { GUEST_CONTRIBUTION_JSON_SCHEMA, guestContributionSchema, type GuestContribution, type RolePlan } from "./contracts.ts";
import { guestRoleContext } from "./context.ts";
import { PERSONALITY_GUEST_PROMPT } from "../prompts/personality-guest.ts";

export async function createGuestRolePlan(job: EpisodeV2Job, read: ArtifactReader, speaker: GuestSpeaker): Promise<RolePlan<GuestContribution>> {
  const context = await guestRoleContext(job, read, speaker);
  return { speaker, inputs: context.inputs, editorialVersion: context.editorialVersion, prompt: context.personality ? { ...PERSONALITY_GUEST_PROMPT, version: context.promptVersion } : GUEST_PROMPT,
    request: { kind: "structured", role: "guest", instructions: context.personality?.prompt ?? GUEST_INSTRUCTIONS, input: JSON.stringify(context.input),
      schemaName: "still_curious_guest_contribution_v1", jsonSchema: GUEST_CONTRIBUTION_JSON_SCHEMA, parse: value => guestContributionSchema.parse(value) } };
}
