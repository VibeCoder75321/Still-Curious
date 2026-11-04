import type { CastingOutput } from "../../lib/episode-v2/prompts/casting.ts";

/** Authored test responses, not live model output or evidence about fireflies. */
export const castingFixture: CastingOutput = {
  host: { name: "Alex Rowan", approach: "Keep the distinction between a shared pattern and its explanation clear, with specific follow-up questions." },
  guests: [{
    name: "Mara Vale", expertise: ["Insect sensory behaviour", "Behavioural responses to light"],
    trustedMethods: ["Controlled stimulus-response experiments", "Comparisons across individuals"],
    temperament: "Warm and exacting when an analogy makes an insect sound too human.",
    intellectualTendencies: ["Ask what the animal could perceive before explaining the collective pattern."],
    confidenceStyle: "Confident about the observed response, cautious about what it reveals about intention.",
    humour: "An occasional dry observation about our habit of giving insects a committee.",
    blindSpots: ["May undervalue a simple model until it predicts a measurable response."],
    conditionsForRevision: ["A model that predicts an untested stimulus response would earn more confidence."],
    evidencePerspective: { sharedClaimIds: ["c1"], rationale: "Uses the recorded response pattern to ask which visual information an individual could act on." },
  }, {
    name: "Elias Chen", expertise: ["Collective behaviour", "Dynamical models"],
    trustedMethods: ["Mathematical models with testable predictions", "Parameter sensitivity analysis"],
    temperament: "Patient with a difficult concept and delighted by a simple explanation that survives a test.",
    intellectualTendencies: ["Look for the few ingredients that could generate the observed pattern."],
    confidenceStyle: "Separates a model's ability to produce a pattern from evidence that nature uses its mechanism.",
    humour: "Dry amusement at the tidy assumptions that a messy animal promptly breaks.",
    blindSpots: ["May treat a successful simplification as more complete than the evidence warrants."],
    conditionsForRevision: ["A reproducible response outside the model's predictions would require changing its assumptions."],
    evidencePerspective: { sharedClaimIds: ["c1"], rationale: "Uses the same response pattern to identify which candidate mechanisms make distinct predictions." },
  }, {
    name: "Noor Shah", expertise: ["Ecological behaviour", "Field measurement of collective patterns"],
    trustedMethods: ["Repeated field observations across settings", "Measurement error analysis"],
    temperament: "Reflective, becoming brisk when an inference outruns the measurement.",
    intellectualTendencies: ["Ask how the observation changes with setting and how the instrument could hide variation."],
    confidenceStyle: "States the pattern plainly while identifying the conditions under which it was measured.",
    humour: "Quiet amusement when the setting proves more interesting than the planned experiment.",
    blindSpots: ["Can collect so many qualifications that the supported finding becomes hard to hear."],
    conditionsForRevision: ["Replication across settings with calibrated measurements would reduce concern about a local effect."],
    evidencePerspective: { sharedClaimIds: ["c1"], rationale: "Uses the same response pattern to ask whether it persists across conditions and measurement methods." },
  }],
  perspectiveComparison: "All three accept the recorded pattern. Mara asks what an individual could sense, Elias asks which mechanisms predict it, and Noor asks where the observation generalises. Each can explain the result and acknowledge uncertainty; none has a prescribed verdict or speaking job.",
};
