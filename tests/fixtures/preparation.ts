import type { GuestPreparationOutput } from "../../lib/episode-v2/prompts/guest-preparation.ts";
import type { HostPreparationOutput } from "../../lib/episode-v2/prompts/host-preparation.ts";
import { castSchema, type GuestSpeaker } from "../../lib/episode-v2/contracts.ts";
import { artifactRef } from "../../lib/episode-v2/stage-helpers.ts";
import { CASTING_PROMPT, CASTING_GUIDANCE_VERSION } from "../../lib/episode-v2/prompts/casting.ts";
import { FRAMEWORK_VERSION } from "../../lib/episode-v2/prompts/producer.ts";
import { castingFixture } from "./casting.ts";
import { frozenEvidenceFixture } from "./evidence.ts";

/** Authored editorial examples for boundary/recovery checks, not live scientific output. */
export const guestPreparationFixtures: Record<GuestSpeaker, GuestPreparationOutput> = {
  expert1: {
    thesis: "The useful first question is what one insect could perceive from another's flash.",
    supportingClaims: ["c1"], qualifications: ["A recorded pattern does not by itself establish what visual information an individual uses."],
    strongestCounterargument: "The same collective pattern might be produced by more than one response mechanism.",
    examplesOrStories: ["story1"], unresolved: ["Which stimulus would distinguish the candidate sensory responses?"],
    whatWouldChangeMyView: "A controlled stimulus test with a reproducible response inconsistent with the proposed mechanism.",
    possibleOveremphasis: "I may favour an individual response measurement over a useful collective model.",
  },
  expert2: {
    thesis: "A simple model is useful if it makes a discriminating prediction, even when it is incomplete.",
    supportingClaims: ["c1"], qualifications: ["Producing a pattern in a model is not proof that insects use that mechanism."],
    strongestCounterargument: "Several models may fit the same measurement without predicting an untested response.",
    examplesOrStories: [], unresolved: ["Which model prediction would be hardest for its competitors to reproduce?"],
    whatWouldChangeMyView: "A reliable experiment outside the model's predictions would change its assumptions.",
    possibleOveremphasis: "The elegance of a simple model may distract me from biological details.",
  },
  expert3: {
    thesis: "We should ask how far the observed pattern survives changes in setting and measurement.",
    supportingClaims: ["c1"], qualifications: ["The corrected measurement does not license a claim about all firefly species."],
    strongestCounterargument: "Excessive caution about generalisation can hide a robust pattern within the measured setting.",
    examplesOrStories: ["story1"], unresolved: ["Would calibrated observations in a second setting preserve the pattern?"],
    whatWouldChangeMyView: "Replication across settings with calibrated measurements would reduce my concern.",
    possibleOveremphasis: "I can accumulate so many qualifications that the supported result becomes difficult to hear.",
  },
};

export const hostPreparationFixture: HostPreparationOutput = {
  priorities: ["Give the listener a concrete definition of flashing together before comparing explanations.", "Use one discriminating test; drop the modelling detour if the five-minute scope becomes crowded."],
  questions: [
    { question: "Mara, you start with what one insect can perceive. What observation would distinguish a response to another flash from a shared pattern alone?", intendedGuest: "expert1", possibleFollowUps: ["If the same pattern fits two responses, what stimulus would separate them?"] },
    { question: "Elias, what makes a model's prediction discriminating rather than merely a neat reproduction of the pattern?", intendedGuest: "expert2", possibleFollowUps: ["If two models predict the same result, where would you look for a test they disagree on?"] },
    { question: "Noor, you mention calibrated observations in another setting. What would you most want to hold constant before comparing them?", intendedGuest: "expert3", possibleFollowUps: ["If the pattern survives that comparison, which qualification would you relax?"] },
  ],
  possibleDetours: ["A brief explanation of what a model leaves out, if the actual answers make that distinction useful."],
  returnPoint: "Return to the distinction between observing a shared rhythm and explaining the mechanism.",
  endingAim: "Clarify what the conversation has supported about the measured pattern and which proposed explanations still need a test.",
};

export async function preparationFixture() {
  const fixture = await frozenEvidenceFixture();
  const { job, brief, evidence } = fixture;
  const cast = castSchema.parse({
    schemaVersion: 2, pipelineVersion: 2, id: "cast:1", kind: "cast", version: 1, createdAt: evidence.createdAt,
    provenance: {
      inputVersions: [artifactRef(brief), artifactRef(evidence)],
      editorialVersion: `framework-${FRAMEWORK_VERSION}/${CASTING_GUIDANCE_VERSION}`,
      prompt: CASTING_PROMPT, modelConfiguration: { model: "gpt-6.1-sol", reasoningEffort: "high" }, usageRecordIds: [],
    },
    data: {
      evidencePack: artifactRef(evidence), perspectiveComparison: castingFixture.perspectiveComparison,
      host: { speaker: "host", ...castingFixture.host },
      guests: castingFixture.guests.map((guest, index) => ({ ...guest, speaker: `expert${index + 1}`, fictional: true })),
    },
  });
  job.state.artifacts[cast.id] = cast; job.stage = "preparation"; job.substep = "expert1";
  // The job parser clones its artifacts. Return the persisted objects so mutation
  // fixtures exercise the stored input rather than detached pre-parse objects.
  return { ...fixture, cast,
    brief: job.state.artifacts[brief.id] as typeof brief,
    commission: job.state.artifacts[fixture.commission.id] as typeof fixture.commission,
    sources: job.state.artifacts[fixture.sources.id] as typeof fixture.sources,
    evidence: job.state.artifacts[evidence.id] as typeof evidence,
  };
}
