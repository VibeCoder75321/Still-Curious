import type { EpisodeV2Job, GuestSpeaker } from "../contracts.ts";
import { CONTRIBUTION_REQUEST_INSTRUCTIONS, CONTRIBUTION_REQUEST_PROMPT } from "../prompts/contribution-request.ts";
import type { ArtifactReader } from "../stage-helpers.ts";
import { CONTRIBUTION_REQUEST_JSON_SCHEMA, contributionRequestSchema, type ContributionRequest, type RolePlan } from "./contracts.ts";
import { guestRoleContext } from "./context.ts";
import { PERSONALITY_PRIORITY } from "../personality.ts";

export async function createContributionRequestPlan(job: EpisodeV2Job, read: ArtifactReader, speaker: GuestSpeaker): Promise<RolePlan<ContributionRequest>> {
  const context = await guestRoleContext(job, read, speaker);
  return { speaker, inputs: context.inputs, editorialVersion: context.editorialVersion, prompt: context.personality ? { ...CONTRIBUTION_REQUEST_PROMPT, version: context.promptVersion } : CONTRIBUTION_REQUEST_PROMPT,
    request: { kind: "structured", role: "contribution_request", instructions: CONTRIBUTION_REQUEST_INSTRUCTIONS + (context.personality ? `\n\n${PERSONALITY_PRIORITY}\nUse ownProfile.personalityGuidance to shape what you would contribute. This is only a bounded bid, not your spoken turn; retain the bid schema and pass when you have no useful point.` : ""),
      input: JSON.stringify(context.input), schemaName: "still_curious_contribution_request_v1",
      jsonSchema: CONTRIBUTION_REQUEST_JSON_SCHEMA, parse: value => contributionRequestSchema.parse(value) } };
}
