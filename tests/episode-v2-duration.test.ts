import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createTextPilot } from "../lib/episode-v2/app-controls.ts";
import { createFifteenMinuteConfig, episodeConfigSchema } from "../lib/episode-v2/config.ts";
import { durationAdaptationSchema, episodeV2JobSchema, type EpisodeV2Job, type EpisodeBrief, type ResearchCommission } from "../lib/episode-v2/contracts.ts";
import { evidenceInput } from "../lib/episode-v2/prompts/evidence.ts";
import { createGuestPreparationPlan, createHostPreparationPlan } from "../lib/episode-v2/stages/preparation.ts";
import { createGuestRolePlan } from "../lib/episode-v2/roles/guest.ts";
import { createHostRolePlan } from "../lib/episode-v2/roles/host.ts";
import { createEditingPlan } from "../lib/episode-v2/stages/editing.ts";
import { postProductionFixture } from "./fixtures/post-production.ts";
import { preparationFixture } from "./fixtures/preparation.ts";

function selectFifteenMinutes({ job, brief, commission }: { job: EpisodeV2Job; brief: EpisodeBrief; commission: ResearchCommission }) {
  job.lengthMinutes = 15;
  job.config = createFifteenMinuteConfig({ ...job.config.limits });
  brief.data.lengthMinutes = 15; commission.data.lengthMinutes = 15;
  brief.data.durationAdaptation = { ...brief.data.durationAdaptation!, profileVersion: job.config.profileVersion,
    targetDurationSeconds: 900, introductionTargetSeconds: job.config.introductionTargetSeconds };
}

test("fifteen-minute jobs retain an explicit spending gate and reject mixed duration profiles", () => {
  const job = createTextPilot({ id: "long", userId: "owner", topic: "A scientific process", lengthMinutes: 15, now: 1 });
  assert.equal(job.status, "paused"); assert.equal(job.pause?.code, "budget");
  assert.equal(job.lengthMinutes, 15); assert.equal(job.config.targetDurationSeconds, 900);
  assert.deepEqual(job.config.spokenWordTarget, { min: 1650, max: 2100 });
  assert.equal(job.state.usageLedger!.records.length, 0);
  assert.equal(job.state.usageLedger!.spendCeilingUsd, null);
  assert.deepEqual(job.state.usageLedger!.allocations, { research: 0, text: 0, review: 0, audio: 0 });
  for (const patch of [{ lengthMinutes: 5 }, { targetDurationSeconds: 300 }, { profileVersion: "five-minute-pilot-v1" }]) {
    assert.equal(episodeConfigSchema.safeParse({ ...job.config, ...patch }).success, false);
  }
  assert.equal(episodeV2JobSchema.safeParse({ ...job, lengthMinutes: 5 }).success, false);
  const adaptation = { profileVersion: job.config.profileVersion, targetDurationSeconds: 300,
    introductionTargetSeconds: job.config.introductionTargetSeconds, scopeDecision: "preserved", scopeRationale: "Focused inquiry",
    introductionPurpose: "Orient", discussionFocus: "Explain", endingAim: "Reflect" };
  assert.equal(durationAdaptationSchema.safeParse(adaptation).success, false);
  assert.equal(durationAdaptationSchema.safeParse({ ...adaptation, targetDurationSeconds: 900 }).success, true);
});

test("fifteen-minute duration reaches evidence, independent preparation, speaking and editing requests", async () => {
  const fixture = await postProductionFixture(), { job, brief, commission, evidence, sources } = fixture;
  selectFifteenMinutes(fixture);
  const read = async (ref: { id: string }) => job.state.artifacts[ref.id];
  const original = JSON.stringify(fixture.transcript.data.turns);
  assert.equal(JSON.parse(evidenceInput(job, brief, commission, sources)).duration.lengthMinutes, 15);
  const fresh = await preparationFixture(); selectFifteenMinutes(fresh);
  const readFresh = async (ref: { id: string }) => fresh.job.state.artifacts[ref.id];
  const preparation = await createGuestPreparationPlan(fresh.job, readFresh);
  for (const note of fixture.preparations) fresh.job.state.artifacts[note.id] = structuredClone(note);
  fresh.job.substep = "host";
  const hostPreparation = await createHostPreparationPlan(fresh.job, readFresh);
  for (const plan of [preparation, hostPreparation]) {
    const input = JSON.parse(plan.request.input);
    assert.equal(input.selectedDuration.lengthMinutes, 15);
    assert.equal(input.selectedDuration.targetDurationSeconds, 900);
    assert.deepEqual(input.selectedDuration.introductionTargetSeconds, { min: 45, max: 60 });
    assert.deepEqual(input.completeEvidencePack.claims, evidence.data.claims);
  }
  job.stage = "conversation"; job.substep = "host";
  for (const plan of [await createGuestRolePlan(job, read, "expert1"), await createHostRolePlan(job, read)]) {
    const input = JSON.parse(plan.request.input);
    assert.equal(input.selectedDuration.targetDurationSeconds, 900);
    assert.deepEqual(input.acceptedTranscript.turns, fixture.transcript.data.turns);
  }
  job.stage = "editing"; job.substep = "edit";
  const edit = JSON.parse((await createEditingPlan(job, read)).request.input);
  assert.equal(edit.selectedDuration.targetDurationSeconds, 900);
  assert.deepEqual(edit.selectedDuration.spokenWordTarget, { min: 1650, max: 2100 });
  assert.equal(JSON.stringify(fixture.transcript.data.turns), original);
});

test("fifteen-minute CLI preflight makes no calls, even with a credential present", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-text-pilot.ts", "--minutes", "15", "--topic", "A scientific process"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10_000,
    env: { ...process.env, OPENAI_API_KEY: "fixture-never-send" },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.providerCalls, 0); assert.equal(output.spendingCeilingUsd, null);
  assert.equal(output.selectedDuration.lengthMinutes, 15);
  assert.equal(output.selectedDuration.targetDurationSeconds, 900);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-never-send/);
});

test("CLI rejects unsupported durations before any live execution", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-text-pilot.ts", "--minutes", "10", "--topic", "A scientific process"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10_000,
    env: { ...process.env, OPENAI_API_KEY: "fixture-never-send" },
  });
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-never-send/);
});
