import test from "node:test";
import assert from "node:assert/strict";
import { buildCoherentManifest, sampleCoherentCharacters } from "../lib/episode-v2/coherent-personality.ts";
import { validEnsemble, personalityManifestSchema } from "../lib/episode-v2/personality.ts";
import { DISCUSSION_VERSION, interactionReviewSchema, validateInteractionReview } from "../lib/episode-v2/discussion-design.ts";
import { GUEST_RUNTIME_CONTRACT } from "../lib/episode-v2/prompts/personality-guest.ts";
import { createGuestPreparationPlan, createHostPreparationPlan, validateGuestEvidence, validateHostPreparation } from "../lib/episode-v2/stages/preparation.ts";
import { createGuestRolePlan } from "../lib/episode-v2/roles/guest.ts";
import { createHostRolePlan } from "../lib/episode-v2/roles/host.ts";
import { createReviewPlan } from "../lib/episode-v2/stages/review.ts";
import { createEvidencePlan } from "../lib/episode-v2/stages/evidence.ts";
import { createEditingPlan } from "../lib/episode-v2/stages/editing.ts";
import { validateFoundationEvidence } from "../lib/episode-v2/prompts/evidence.ts";
import { castSchema, episodeV2JobSchema, type Cast, type EpisodeV2Job } from "../lib/episode-v2/contracts.ts";
import { quoteOperation } from "../lib/episode-v2/providers.ts";
import { createModelPolicy } from "../lib/episode-v2/model-policy.ts";
import { positionedPreparation, discussionHost, parallelInteraction } from "./fixtures/discussion-design.ts";
import { speakingFixture } from "./fixtures/speaking.ts";
import { postProductionFixture, acceptableReview, lightEdit } from "./fixtures/post-production.ts";
import { evidenceOutputFixture, frozenEvidenceFixture } from "./fixtures/evidence.ts";

const seed = "7f6b5a7b-7ccd-4cbd-b5e4-c1a688f0c769";
function coherent(job: EpisodeV2Job, cast: Cast) {
  job.state.personalitySeed = seed; job.state.discussionVersion = DISCUSSION_VERSION;
  cast.data.personality = buildCoherentManifest(job.id, job.topic, cast.data.guests.map(g => ({ id: g.speaker, name: g.name, expertise: g.expertise.join("; ") })), seed, GUEST_RUNTIME_CONTRACT);
  for (const artifact of Object.values(job.state.artifacts)) {
    if (artifact.kind === "guest_preparation") {
      artifact.data.position = positionedPreparation(artifact.data.speaker).position;
      artifact.provenance.prompt = { id: "independent-guest-preparation", version: DISCUSSION_VERSION };
    }
    if (artifact.kind === "host_plan") {
      artifact.data.discussionPoints = discussionHost().discussionPoints;
      artifact.provenance.prompt = { id: "responsive-host-preparation", version: DISCUSSION_VERSION };
    }
  }
  return cast.data.personality;
}
function resultFor(job: EpisodeV2Job, value: unknown, role: "synthesis" | "editing" | "review") {
  const id = `fixture_${role}`;
  const record = quoteOperation({ id, role, kind: "structured" }, (job.state.modelPolicy ?? createModelPolicy()).roles[role]!, new Date(job.createdAt).toISOString());
  record.finishedAt = record.startedAt; record.outcome = "completed";
  job.state.usageLedger!.records.push(record);
  return { value, usageRecordId: id, actions: [], sources: [] };
}

test("500 coherent casts replay exactly, preserve contrast, and vary every speaker's foundation", () => {
  const seen = new Set<string>(), perSpeaker = [new Set(), new Set(), new Set()];
  for (let i = 0; i < 500; i++) {
    const value = sampleCoherentCharacters(`coherent-${i}`);
    assert.deepEqual(value, sampleCoherentCharacters(`coherent-${i}`));
    assert.ok(validEnsemble(value.cast.map(c => c.personality)));
    assert.equal(new Set(value.cast.map(c => c.character.foundation)).size, 3);
    value.cast.forEach((c, index) => { perSpeaker[index].add(c.character.foundation); assert.equal(c.character.responseExamples.length, 2); });
    seen.add(JSON.stringify(value.cast));
  }
  assert.ok(seen.size > 490);
  for (const set of perSpeaker) assert.equal(set.size, 6, "No speaker owns a permanent delivery archetype");
});

test("new character snapshots survive persistence and require a foundation for every guest", async () => {
  const { job, cast } = await speakingFixture(), manifest = coherent(job, cast);
  assert.deepEqual(castSchema.parse(cast), cast);
  const restored = episodeV2JobSchema.parse(JSON.parse(JSON.stringify(job)));
  const saved = (restored.state.artifacts[cast.id] as Cast).data.personality!;
  assert.deepEqual(saved, manifest);
  const bad = structuredClone(manifest); delete bad.cast[0].character;
  assert.equal(personalityManifestSchema.safeParse(bad).success, false);
  // Expertise and topic cannot determine manner or beliefs through the random sampler.
  const changed = buildCoherentManifest(job.id, "Different topic", manifest.cast.map(g => ({ id: g.id, name: g.name, expertise: "Different discipline" })), seed, GUEST_RUNTIME_CONTRACT);
  assert.deepEqual(changed.cast.map(g => g.character), manifest.cast.map(g => g.character));
});

test("positions require real supporting claims, a trade-off and concession without leaking other private notes", async () => {
  const f = await speakingFixture(); coherent(f.job, f.cast);
  for (const speaker of ["expert1", "expert2", "expert3"] as const) {
    const note = positionedPreparation(speaker);
    assert.deepEqual(validateGuestEvidence(note, f.evidence, true), note);
    assert.throws(() => validateGuestEvidence({ ...note, position: { ...note.position, claimIds: ["invented"] } }, f.evidence, true));
    assert.throws(() => validateGuestEvidence({ ...note, position: { ...note.position, tradeoff: " " } }, f.evidence, true));
    const { position: _position, ...old } = note;
    assert.throws(() => validateGuestEvidence(old, f.evidence, true));
    const guest = await createGuestRolePlan(f.job, f.read, speaker), input = JSON.parse(guest.request.input);
    assert.deepEqual(input.ownPreparation.position, note.position);
    assert.equal(guest.request.instructions, f.cast.data.personality!.cast.find(g => g.id === speaker)!.prompt);
    assert.equal(guest.prompt.version, DISCUSSION_VERSION);
    for (const other of f.preparations.filter(p => p.data.speaker !== speaker)) assert.ok(!guest.request.input.includes(other.data.position!.judgment));
  }
  f.job.stage = "preparation"; f.job.substep = "expert1";
  delete f.job.state.artifacts["guest-preparation:expert1:1"];
  const plan = await createGuestPreparationPlan(f.job, f.read);
  assert.equal(plan.request.schemaName, "still_curious_guest_preparation_v17");
  assert.throws(() => plan.request.parse({ ...positionedPreparation("expert1"), position: undefined }));
  assert.equal(JSON.parse(plan.request.input).guestPreparationSummaries, undefined);
});

test("host preparation and live host receive real positions, discussion opportunities and word progress", async () => {
  const f = await speakingFixture(); coherent(f.job, f.cast);
  const host = await createHostRolePlan(f.job, f.read), input = JSON.parse(host.request.input);
  assert.equal(input.guestPreparationSummaries.length, 3);
  assert.deepEqual(input.hostPlan.discussionPoints, discussionHost().discussionPoints);
  assert.deepEqual(input.selectedDuration.spokenWordTarget, f.job.config.spokenWordTarget);
  assert.ok(input.selectedDuration.spokenWordsSoFar > 0);
  assert.equal(host.prompt.version, DISCUSSION_VERSION);
  const plan = discussionHost();
  assert.doesNotThrow(() => validateHostPreparation(plan, f.evidence, true));
  assert.throws(() => validateHostPreparation({ ...plan, discussionPoints: [{ ...plan.discussionPoints[0], guests: ["expert1", "expert1"] }] }, f.evidence, true));
  assert.throws(() => validateHostPreparation({ ...plan, discussionPoints: [{ ...plan.discussionPoints[0], claimIds: ["invented"] }] }, f.evidence, true));
  f.job.stage = "preparation"; f.job.substep = "host"; delete f.job.state.artifacts["host-plan:1"];
  assert.equal((await createHostPreparationPlan(f.job, f.read)).request.schemaName, "still_curious_host_preparation_v17");
});

test("interaction evidence cannot fabricate quotations, reverse time or count host questions as guest exchanges", () => {
  const turns = [{ id: "t1", speaker: "expert1", text: "The pattern needs a causal explanation." },
    { id: "t2", speaker: "expert2", text: "Your causal question matters, but a descriptive model can still predict the pattern." },
    { id: "t3", speaker: "host", text: "What does that distinction change?" }];
  const review = interactionReviewSchema.parse({ assessment: "substantive", exchanges: [{ sourceTurnId: "t1", responseTurnId: "t2",
    sourceQuote: "needs a causal explanation", responseQuote: "a descriptive model can still predict", kind: "development", development: "Distinguishes causal explanation from useful prediction." }], missedOpportunity: null });
  assert.doesNotThrow(() => validateInteractionReview(review, turns));
  for (const patch of [{ sourceTurnId: "missing" }, { responseTurnId: "t1" }, { sourceTurnId: "t2", responseTurnId: "t1" },
    { responseTurnId: "t3", responseQuote: turns[2].text }, { responseQuote: "I concede that my argument failed." }]) {
    const bad = structuredClone(review); Object.assign(bad.exchanges[0], patch);
    assert.throws(() => validateInteractionReview(bad, turns));
  }
  assert.throws(() => validateInteractionReview(review, turns.map(t => ({ ...t, speaker: "expert1" }))));
  assert.equal(interactionReviewSchema.safeParse({ ...review, exchanges: [] }).success, false);
  assert.doesNotThrow(() => interactionReviewSchema.parse(parallelInteraction()));
});

test("review compares original and edited voices and validates interaction evidence before saving", async () => {
  const f = await postProductionFixture(); coherent(f.job, f.cast);
  const editing = await createEditingPlan(f.job, f.read);
  const edited = await editing.finish(resultFor(f.job, lightEdit(), "editing"), f.job);
  for (const a of edited.artifacts!) f.job.state.artifacts[a.id] = a;
  f.job.stage = "review"; f.job.substep = "assess";
  const review = await createReviewPlan(f.job, f.read), input = JSON.parse(review.request.input);
  assert.deepEqual(input.acceptedOriginalTurns, f.transcript.data.turns);
  assert.deepEqual(input.editedEpisode.turns, f.transcript.data.turns);
  assert.throws(() => review.request.parse(acceptableReview()));
  const output = { ...acceptableReview(), interactionReview: parallelInteraction() };
  assert.deepEqual(review.request.parse(output), output);
  const finished = await review.finish(resultFor(f.job, output, "review"), f.job);
  const artifact = finished.artifacts!.find(a => a.kind === "review")!;
  assert.equal(artifact.kind === "review" && artifact.data.interactionReview!.assessment, "parallel");
});

test("a missing promised foundation cannot be silently narrowed away before casting", async () => {
  const f = await frozenEvidenceFixture(); f.job.state.discussionVersion = DISCUSSION_VERSION;
  f.brief.data.essentialFoundations = ["The purpose and operating cycle"];
  f.job.state.artifacts[f.brief.id] = f.brief;
  const output = { ...structuredClone(evidenceOutputFixture), foundationCoverage: [{ foundationIndex: 0, claimIds: [], gap: "The operating cycle is absent from the read passages." }] };
  output.coverageDecision.status = "narrowed";
  assert.equal(validateFoundationEvidence(output, f.brief.data.essentialFoundations).coverageDecision.status, "insufficient");
  assert.throws(() => validateFoundationEvidence({ ...output, foundationCoverage: [] }, f.brief.data.essentialFoundations!));
  assert.throws(() => validateFoundationEvidence({ ...output, foundationCoverage: [{ foundationIndex: 0, claimIds: ["invented"], gap: null }] }, f.brief.data.essentialFoundations!));
  const plan = await createEvidencePlan(f.job, f.read);
  const finished = await plan.finish(resultFor(f.job, output, "synthesis"), f.job);
  assert.equal(finished.next.stage, "research"); assert.equal(finished.pause!.code, "needs_input");
  assert.match(finished.pause!.reason, /operating cycle/);
});
