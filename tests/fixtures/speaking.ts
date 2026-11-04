import { guestPreparationSchema, hostPlanSchema, transcriptSchema } from "../../lib/episode-v2/contracts.ts";
import { GUEST_PREPARATION_PROMPT } from "../../lib/episode-v2/prompts/guest-preparation.ts";
import { HOST_PREPARATION_PROMPT } from "../../lib/episode-v2/prompts/host-preparation.ts";
import { artifactRef } from "../../lib/episode-v2/stage-helpers.ts";
import { editorialContext, GUEST_SPEAKERS, guestPreparationId, HOST_PLAN_ID } from "../../lib/episode-v2/stages/preparation.ts";
import type { GuestContribution, HostAction } from "../../lib/episode-v2/roles/contracts.ts";
import { guestPreparationFixtures, hostPreparationFixture, preparationFixture } from "./preparation.ts";

/** Authored dialogue for role boundaries, not a live generated or scientifically reviewed episode. */
export const hostActionFixture: HostAction = {
  text: "Mara, what can one insect's response tell us that the shared rhythm alone cannot?",
  action: "ask", nextSpeaker: "expert1", purpose: "Separate the observation from its proposed mechanism.",
  pointToAddress: "Which observation would discriminate between possible mechanisms?", currentTopic: "Observation and mechanism",
  unresolvedQuestions: ["Which mechanism predicts the pattern?"], detourReturnPoint: null,
};
export const guestContributionFixture: GuestContribution = {
  text: "The shared rhythm gives us a pattern to explain. To distinguish mechanisms, I would want a controlled change that makes the explanations predict different responses. The correction limits the reported magnitude, so I would not rely on the original estimate.",
  stanceUpdate: "Use the corrected magnitude rather than the original estimate.",
};

export async function speakingFixture(withTranscript = true) {
  const fixture = await preparationFixture(), { job, brief, cast, evidence, sources } = fixture;
  const { editorialVersion } = await editorialContext(job, brief);
  const envelope = { schemaVersion: 2, pipelineVersion: 2, version: 1, createdAt: evidence.createdAt };
  const preparations = GUEST_SPEAKERS.map(speaker => guestPreparationSchema.parse({
    ...envelope, id: guestPreparationId(speaker), kind: "guest_preparation",
    provenance: { inputVersions: [brief, evidence, cast, sources].map(artifactRef), editorialVersion,
      prompt: GUEST_PREPARATION_PROMPT, modelConfiguration: { model: "gpt-6.1-sol", reasoningEffort: "high" }, usageRecordIds: [] },
    data: { speaker, cast: artifactRef(cast), evidencePack: artifactRef(evidence), ...structuredClone(guestPreparationFixtures[speaker]) },
  }));
  const hostPlan = hostPlanSchema.parse({
    ...envelope, id: HOST_PLAN_ID, kind: "host_plan",
    provenance: { inputVersions: [brief, evidence, cast, ...preparations].map(artifactRef), editorialVersion,
      prompt: HOST_PREPARATION_PROMPT, modelConfiguration: { model: "gpt-6.1-sol", reasoningEffort: "high" }, usageRecordIds: [] },
    data: { episodeBrief: artifactRef(brief), evidencePack: artifactRef(evidence), cast: artifactRef(cast),
      guestPreparations: Object.fromEntries(preparations.map(note => [note.data.speaker, artifactRef(note)])), ...structuredClone(hostPreparationFixture) },
  });
  for (const artifact of [...preparations, hostPlan]) job.state.artifacts[artifact.id] = artifact;
  const transcript = transcriptSchema.parse({
    ...envelope, id: "transcript:1", kind: "transcript",
    provenance: { inputVersions: [evidence, cast, hostPlan].map(artifactRef), editorialVersion,
      prompt: null, modelConfiguration: null, usageRecordIds: [] },
    data: { evidencePack: artifactRef(evidence), cast: artifactRef(cast),
      turns: [
        { id: "turn-1", speaker: "host", text: "What can a shared flashing pattern establish, before we explain its mechanism?" },
        { id: "turn-2", speaker: "expert2", text: "The initial report described a large change. A model could reproduce that pattern." },
        { id: "turn-3", speaker: "expert3", text: "A correction reduced the magnitude. We should use that qualified estimate, and remember this was one setting." },
        { id: "turn-4", speaker: "host", text: "Mara, given that correction, what observation could distinguish the proposed mechanisms?" },
      ],
      stanceUpdates: [{ speaker: "expert2", afterTurnId: "turn-3", update: "Use the correction's smaller magnitude in any model comparison." }],
      hostDecisions: [{ afterTurnId: "turn-4", action: "ask", nextSpeaker: "expert1", purpose: "Find a discriminating observation, retaining the correction." }],
      showState: { currentTopic: "Observation and mechanism", unresolvedQuestions: ["Which mechanism predicts the pattern?"], detourReturnPoint: null, nextSpeaker: "expert1", estimatedSpokenSeconds: 53 },
    },
  });
  if (withTranscript) job.state.artifacts[transcript.id] = transcript;
  job.stage = "conversation"; job.substep = "host";
  return { ...fixture, preparations, hostPlan, transcript };
}
