import { transcriptSchema } from "../../lib/episode-v2/contracts.ts";
import { acceptGuest, acceptHost, createConversationData } from "../../lib/episode-v2/conversation-state.ts";
import { artifactRef } from "../../lib/episode-v2/stage-helpers.ts";
import { guestContribution, hostAction } from "./conversation.ts";
import { speakingFixture } from "./speaking.ts";

/** Authored offline examples, closed through the real floor reducers. */
export const postProductionSpeech = {
  opening: "The flashing pattern is an observation in one measured setting. Mara, what does it tell us?",
  qualified: "It shows a shared timing pattern in this setting, while the mechanism remains open.",
  overstatement: "It proves that every flashing insect uses the same mechanism. The shared timing still needs explanation.",
  anecdote: "I discovered this mechanism in the field myself. The recorded pattern still needs a discriminating test.",
  followUp: "Elias, how would a model help distinguish the possible explanations?",
  response: "I would ask the competing explanations to predict different responses before collecting a new observation.",
  ending: "The observation gives us a pattern; the mechanism remains an open question.",
};

export async function postProductionFixture(kind: "acceptable" | "local" | "section" = "acceptable") {
  const fixture = await speakingFixture(false), { job, evidence, cast, hostPlan } = fixture;
  let data = createConversationData(job, { evidencePack: artifactRef(evidence), cast: artifactRef(cast), currentTopic: "Pattern and mechanism", openQuestions: ["Which mechanism predicts the pattern?"] });
  data = acceptHost(data, hostAction({ text: postProductionSpeech.opening }), job).data;
  data = acceptGuest(data, "expert1", guestContribution(kind === "acceptable" ? postProductionSpeech.qualified : kind === "local" ? postProductionSpeech.overstatement : postProductionSpeech.anecdote), job).data;
  data = acceptHost(data, hostAction({ text: postProductionSpeech.followUp, nextSpeaker: "expert2" }), job).data;
  data = acceptGuest(data, "expert2", guestContribution(postProductionSpeech.response), job).data;
  const closed = acceptHost(data, hostAction({ action: "close", nextSpeaker: null, text: postProductionSpeech.ending }), job);
  const transcript = transcriptSchema.parse({ schemaVersion: 2, pipelineVersion: 2, id: "transcript:5", kind: "transcript", version: 5,
    createdAt: evidence.createdAt,
    provenance: { inputVersions: [evidence, cast, hostPlan].map(artifactRef), editorialVersion: "authored-closed-fixture", prompt: null, modelConfiguration: null, usageRecordIds: [] }, data: closed.data });
  job.state.artifacts[transcript.id] = transcript;
  job.stage = closed.next.stage; job.substep = closed.next.substep;
  return { ...fixture, transcript };
}

export const acceptableReview = () => ({ outcome: "acceptable", summary: "The episode is accurate enough as a whole; the limited setting and open mechanism are clear.", notes: ["A minor colloquial imprecision does not mislead the listener and needs no change."], issues: [], lookupRequest: null });
export const materialReview = (outcome: "acceptable_with_local_edit" | "revise_section" = "acceptable_with_local_edit") => ({
  outcome, summary: outcome === "revise_section" ? "The invented firsthand story needs correction in its affected section." : "One universal claim overstates the evidence.", notes: [],
  issues: [{ id: "issue-1", turnIds: ["turn-2"], concern: outcome === "revise_section" ? "The fictional specialist claims an invented firsthand discovery." : "A single setting cannot establish a universal mechanism.", evidenceNote: "The saved evidence records one setting and leaves mechanism open.", passages: [{ sourceId: "study1", passageId: "body1" }], recommendedChange: "Retain the supported observation and remove the unsupported claim." }], lookupRequest: null,
});
export const lightEdit = () => ({ patches: [], summary: "The short exchange is coherent; retain the accepted words." });
export const repairOutput = (before: string, after: string | null, turnId = "turn-2") => ({ status: "repaired", patches: [{ turnId, before, after, reason: "Remove the unsupported assertion while retaining the observation." }], summary: "Corrected the affected claim and reread the surrounding exchange.", resolvedIssueIds: ["issue-1"], nearbyCoherenceChecked: true });
