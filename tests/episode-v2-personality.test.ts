import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTextPilot } from "../lib/episode-v2/app-controls.ts";
import { castSchema, episodeV2JobSchema, type Cast, type EpisodeV2Job } from "../lib/episode-v2/contracts.ts";
import { buildPersonalityManifest, compileGuest, compileHost, personalityManifestSchema, samplePersonalities, TRAIT_KEYS, validEnsemble, type PersonalityManifest } from "../lib/episode-v2/personality.ts";
import { GUEST_RUNTIME_CONTRACT } from "../lib/episode-v2/prompts/personality-guest.ts";
import { GUEST_INSTRUCTIONS } from "../lib/episode-v2/prompts/guest.ts";
import { createGuestRolePlan } from "../lib/episode-v2/roles/guest.ts";
import { createHostRolePlan } from "../lib/episode-v2/roles/host.ts";
import { createContributionRequestPlan } from "../lib/episode-v2/roles/contribution-request.ts";
import { createGuestPreparationPlan, createHostPreparationPlan } from "../lib/episode-v2/stages/preparation.ts";
import { createEditingPlan } from "../lib/episode-v2/stages/editing.ts";
import { speakingFixture } from "./fixtures/speaking.ts";
import { postProductionFixture } from "./fixtures/post-production.ts";

const seed = "7f6b5a7b-7ccd-4cbd-b5e4-c1a688f0c769";
function personalize(job: EpisodeV2Job, cast: Cast) {
  job.state.personalitySeed = seed;
  cast.data.personality = buildPersonalityManifest(job.id, job.topic, cast.data.guests.map(g => ({ id: g.speaker, name: g.name, expertise: g.expertise.join("; ") })), seed, GUEST_RUNTIME_CONTRACT);
  return cast.data.personality;
}

test("the TypeScript compiler preserves the supplied Python sample's exact guest and host wording", () => {
  const sample = JSON.parse(readFileSync(new URL("./fixtures/personality-v1.6-sample.json", import.meta.url), "utf8")) as PersonalityManifest;
  for (const guest of sample.cast) assert.equal(compileGuest(guest, guest.personality, sample.topic), guest.prompt);
  assert.equal(compileHost(sample.cast, sample.cast.map(g => g.personality)), sample.host_cast_brief);
});

test("500 seeded ensembles satisfy bounds, contrast and pacing without fixed archetypes", () => {
  const ensembles = new Set<string>();
  const perGuest = [0, 1, 2].map(() => new Set<number>());
  for (let i = 0; i < 500; i++) {
    const result = samplePersonalities(`validation-${i}`);
    assert.ok(validEnsemble(result.profiles));
    for (const profile of result.profiles) assert.equal(Object.keys(profile).length, 10);
    result.profiles.forEach((p, index) => perGuest[index].add(p.language_richness));
    assert.deepEqual(result, samplePersonalities(`validation-${i}`));
    ensembles.add(JSON.stringify(result.profiles));
  }
  assert.equal(ensembles.size, 500);
  for (const values of perGuest) assert.equal(values.size, 5, "No speaker ID owns a fixed language style");
});

test("new episodes persist independent random seeds without changing the spending ceiling or models", () => {
  const input = { id: "one", userId: "owner", topic: "Fusion", now: Date.now(), spendCeilingUsd: 5 };
  const a = createTextPilot(input), b = createTextPilot({ ...input, id: "two" });
  assert.ok(a.state.personalitySeed); assert.notEqual(a.state.personalitySeed, b.state.personalitySeed);
  assert.equal(episodeV2JobSchema.parse(JSON.parse(JSON.stringify(a))).state.personalitySeed, a.state.personalitySeed);
  assert.equal(a.config.limits.spendCeilingUsd, 5);
  assert.deepEqual(a.state.modelPolicy, b.state.modelPolicy);
});

test("manifest validation rejects malformed traits, duplicate identities and cast/episode mismatches", async () => {
  const { job, cast } = await speakingFixture();
  const manifest = personalize(job, cast);
  assert.ok(episodeV2JobSchema.safeParse(job).success);
  for (const bad of [0, 6, 1.5]) {
    const candidate = structuredClone(manifest); candidate.cast[0].personality.humour = bad;
    assert.equal(personalityManifestSchema.safeParse(candidate).success, false);
  }
  const duplicate = structuredClone(manifest); duplicate.cast[1].id = duplicate.cast[0].id;
  assert.equal(personalityManifestSchema.safeParse(duplicate).success, false);
  cast.data.personality!.cast[0].name = "Different person";
  assert.equal(castSchema.safeParse(cast).success, false);
  cast.data.personality = structuredClone(manifest); cast.data.personality.episode_id = "other-episode";
  assert.equal(episodeV2JobSchema.safeParse(job).success, false);
});

test("each guest receives only its saved full prompt and private preparation, with exact accepted dialogue", async () => {
  const { job, cast, read, preparations, transcript } = await speakingFixture();
  const manifest = personalize(job, cast), before = JSON.stringify(job), prompts = [];
  for (const guest of manifest.cast) {
    const plan = await createGuestRolePlan(job, read, guest.id), input = JSON.parse(plan.request.input);
    prompts.push(plan.request.instructions);
    assert.equal(plan.request.instructions, guest.prompt);
    assert.equal(plan.prompt.version, "1.6.0");
    assert.deepEqual(input.ownProfile.personality, guest.personality);
    assert.deepEqual(input.acceptedTranscript.turns, transcript.data.turns);
    assert.equal(input.hostCastBrief, undefined); assert.equal(input.cast, undefined);
    for (const oldStyle of ["temperament", "confidenceStyle", "humour"]) assert.equal(input.ownProfile[oldStyle], undefined);
    assert.ok(!plan.request.instructions.includes(GUEST_INSTRUCTIONS));
    for (const other of manifest.cast.filter(g => g.id !== guest.id)) assert.ok(!plan.request.instructions.includes(other.prompt));
    for (const note of preparations.filter(n => n.data.speaker !== guest.id)) assert.ok(!plan.request.input.includes(note.data.thesis));
    const bid = await createContributionRequestPlan(job, read, guest.id);
    assert.deepEqual(JSON.parse(bid.request.input).ownProfile.personality, guest.personality);
    assert.equal(JSON.parse(bid.request.input).hostCastBrief, undefined);
  }
  assert.equal(new Set(prompts).size, 3); assert.equal(JSON.stringify(job), before);
});

test("resumed turns load the persisted prompt snapshot rather than regenerate it under a newer compiler", async () => {
  const { job, cast } = await speakingFixture();
  const manifest = personalize(job, cast);
  manifest.cast[0].prompt += "\nSaved exact snapshot marker.";
  const restored = episodeV2JobSchema.parse(JSON.parse(JSON.stringify(job)));
  const read = async (ref: { id: string }) => restored.state.artifacts[ref.id];
  const plan = await createGuestRolePlan(restored, read, "expert1");
  assert.equal(plan.request.instructions, manifest.cast[0].prompt);
});

test("independent preparation receives only its own traits and the host receives the complete saved brief", async () => {
  const { job, cast, read, preparations } = await speakingFixture();
  const manifest = personalize(job, cast);
  for (const guest of manifest.cast) {
    job.stage = "preparation"; job.substep = guest.id;
    const existing = job.state.artifacts[`guest-preparation:${guest.id}:1`];
    delete job.state.artifacts[existing.id];
    const plan = await createGuestPreparationPlan(job, read), input = JSON.parse(plan.request.input);
    job.state.artifacts[existing.id] = existing;
    assert.deepEqual(input.ownProfile.personality, guest.personality);
    assert.equal(input.cast, undefined);
    assert.equal(input.ownProfile.temperament, undefined);
    for (const key of TRAIT_KEYS) assert.ok(input.ownProfile.personalityGuidance.includes(key.replaceAll("_", " ").toUpperCase()));
    for (const note of preparations) assert.ok(!plan.request.input.includes(note.data.thesis));
  }
  delete job.state.artifacts["host-plan:1"];
  job.substep = "host";
  const prep = await createHostPreparationPlan(job, read);
  assert.equal(JSON.parse(prep.request.input).cast.hostCastBrief, manifest.host_cast_brief);
});

test("host and editor guidance preserve opinion, disagreement and expressive language without leaking full guest prompts", async () => {
  const fixture = await speakingFixture(), manifest = personalize(fixture.job, fixture.cast);
  const host = await createHostRolePlan(fixture.job, fixture.read);
  assert.ok(host.request.instructions.includes(manifest.host_cast_brief));
  for (const guest of manifest.cast) assert.ok(!host.request.input.includes(guest.prompt));
  const edited = await postProductionFixture(); personalize(edited.job, edited.cast);
  const plan = await createEditingPlan(edited.job, edited.read);
  assert.match(plan.request.instructions, /Preserve supported opinion, substantive disagreement, accurate expressive language/);
  assert.equal(JSON.parse(plan.request.input).cast.hostCastBrief, edited.cast.data.personality!.host_cast_brief);
});

test("legacy episodes keep their exact shared prompt and do not silently acquire a random cast", async () => {
  const { job, cast, read } = await speakingFixture(), before = JSON.stringify(job);
  const plan = await createGuestRolePlan(job, read, "expert1");
  assert.equal(plan.request.instructions, GUEST_INSTRUCTIONS); assert.equal(plan.prompt.version, "1.4.0");
  assert.equal(cast.data.personality, undefined); assert.equal(JSON.stringify(job), before);
});
