import type { ContributionRequest, GuestContribution, HostAction } from "../../lib/episode-v2/roles/contracts.ts";
import { hostActionFixture, speakingFixture } from "./speaking.ts";

/** Authored, offline routing example. The source material is deliberately synthetic. */
export const conversationScenario = {
  introduction: "A field of flashing insects can look like a shared clock. Today we will separate the pattern we can observe from the mechanism that might explain it. Mara, which observation would let us start making that distinction?",
  challenge: "The pattern is real within this setting, but reproducing it does not identify a mechanism. Elias, your model needs a prediction that a competing explanation would not share.",
  reply: "That is a fair constraint. I would compare responses to an altered stimulus, using the corrected magnitude. A model that only reproduces the original pattern has not yet passed that test.",
  tangent: "Noor, before returning to that test, how would you compare two settings without mistaking a measurement change for a biological difference?",
  tangentReply: "I would first calibrate the recording and define the same observation in both settings. The correction is a useful reminder that a measured magnitude can change while the reported direction remains.",
  offeredPoint: "A stimulus intervention can separate the candidate explanations without assuming that a shared pattern identifies one mechanism.",
  invitation: "Mara, bring that intervention back to our starting question. What would make it discriminate between the explanations?",
  contribution: "Make the explanations predict different responses before collecting the new observation. Then the result can favour one explanation while leaving its wider generality open.",
  ending: "We have returned to the distinction between a shared rhythm and its explanation. The observation gives us a pattern; a discriminating test would tell us more about the mechanism. That question remains open.",
};

export function hostAction(overrides: Partial<HostAction> = {}): HostAction {
  return { ...structuredClone(hostActionFixture), requestDecisions: [], requestFeedback: [], clarificationNeeded: false, ...overrides };
}

export function guestContribution(text: string, addressedGuest: GuestContribution["addressedGuest"] = null): GuestContribution {
  return { text, stanceUpdate: null, addressedGuest };
}

export const conversationFixture = () => speakingFixture(false);

/** Select the request that the host actually received, rather than inventing its ID. */
export function offeredRequest(input: Record<string, any>, speaker = "expert1") {
  const request = input.contributionRequests.find((request: { speaker: string; status: string }) => request.speaker === speaker && ["offered", "parked", "accepted", "used"].includes(request.status));
  if (!request) throw new Error(`The fixture expected a saved request for ${speaker}`);
  return request as { id: string; speaker: string; point: string; status: string };
}

export function scenarioOutput(index: number, input: Record<string, any>): HostAction | GuestContribution | ContributionRequest {
  const scenario = conversationScenario;
  switch (index) {
    case 0: return hostAction({ text: scenario.introduction });
    case 1: return guestContribution(scenario.challenge, { speaker: "expert2", reason: "The model's discriminating prediction was directly challenged." });
    case 2: return hostAction({ action: "yield", text: null, nextSpeaker: "expert2", purpose: "Give the challenged guest a response opportunity." });
    case 3: return { ...guestContribution(scenario.reply), stanceUpdate: "Require a discriminating prediction and use the corrected magnitude." };
    case 4: return hostAction({ text: scenario.tangent, nextSpeaker: "expert3", currentTopic: "Comparing settings", detourReturnPoint: "Return to the distinction between a shared rhythm and its mechanism." });
    case 5: return guestContribution(scenario.tangentReply);
    case 6: return hostAction({ action: "request_contributions", text: null, nextSpeaker: null, purpose: "Listen for a useful point before returning to the main question.", detourReturnPoint: "Return to the distinction between a shared rhythm and its mechanism." });
    case 7: return { decision: "contribute", point: scenario.offeredPoint };
    case 8: return { decision: "pass", point: null };
    case 9: return hostAction({ text: scenario.invitation, requestDecisions: [{ requestId: offeredRequest(input).id, decision: "accept" }], detourReturnPoint: null });
    case 10: return guestContribution(scenario.contribution);
    case 11: return hostAction({ action: "close", text: scenario.ending, nextSpeaker: null, purpose: "Return to the central question and close with the remaining uncertainty.", detourReturnPoint: null,
      requestFeedback: [{ requestId: offeredRequest(input).id, useful: true, reason: "The accepted contribution supplied the discriminating-test criterion at the return point." }] });
    default: throw new Error(`No authored output for operation ${index}`);
  }
}
