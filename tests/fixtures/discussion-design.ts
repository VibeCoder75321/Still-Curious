import type { GuestSpeaker } from "../../lib/episode-v2/contracts.ts";
import type { Position } from "../../lib/episode-v2/discussion-design.ts";
import { guestPreparationFixtures, hostPreparationFixture } from "./preparation.ts";

// Authored offline notes: fixture transport validates wiring, not model quality.
const positions: Record<GuestSpeaker, Position> = {
  expert1: { priority: "Explain individual response", judgment: "The measured shared pattern is the phenomenon to explain, not evidence for a unique mechanism.",
    tradeoff: "Starting at the individual scale makes the causal question clear but leaves a collective description incomplete.",
    strongestAlternative: "A collective model can give useful predictions before the response mechanism is settled.",
    concession: "A descriptive model is valuable without being a causal account.", claimIds: ["c1"] },
  expert2: { priority: "Make collective predictions", judgment: "The corrected pattern gives a model something definite to reproduce.",
    tradeoff: "A simple description can be tractable while leaving out individual detail.",
    strongestAlternative: "Several mechanisms may produce the same pattern.",
    concession: "Matching this observation alone does not identify its cause.", claimIds: ["c1"] },
  expert3: { priority: "Keep the result's measured scope visible", judgment: "The corrected finding is meaningful within its measured setting.",
    tradeoff: "A limited claim is defensible but does not answer how widely it generalises.",
    strongestAlternative: "Too much caution obscures the supported observation.",
    concession: "We can state the finding plainly while retaining its scope.", claimIds: ["c1"] },
};
export const positionedPreparation = (speaker: GuestSpeaker) => ({ ...structuredClone(guestPreparationFixtures[speaker]), position: structuredClone(positions[speaker]) });
export const discussionHost = () => ({ ...structuredClone(hostPreparationFixture), discussionPoints: [{
  claimIds: ["c1"], guests: ["expert1", "expert2"] as GuestSpeaker[],
  differentPriorities: "Individual explanation and collective prediction have different uses even while both accept the same observation.",
  invitation: "What does that distinction change about what a model can tell us?",
}] });
export const parallelInteraction = () => ({ assessment: "parallel" as const, exchanges: [], missedOpportunity: "The host could invite a guest to develop the previous specialist's actual claim." });
