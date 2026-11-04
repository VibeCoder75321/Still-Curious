import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { episodeV2JobSchema, type EpisodeV2Job, type GuestSpeaker, type GuestPreparation } from "../lib/episode-v2/contracts.ts";
import { createD1EpisodeStore, sha256, type EpisodeDatabase } from "../lib/episode-v2/persistence.ts";
import { POLL_INTERVAL_MS, runDurableStep, type StepFactory } from "../lib/episode-v2/runner.ts";
import { artifactRef } from "../lib/episode-v2/stage-helpers.ts";
import {
  createGuestPreparationPlan, createHostPreparationPlan, guestPreparationId, guestPreparationKey,
  GUEST_SPEAKERS, HOST_PLAN_ID, HOST_PREPARATION_STEP_KEY,
} from "../lib/episode-v2/stages/preparation.ts";
import { GUEST_PREPARATION_PROMPT, PREPARATION_GUIDANCE, guestPreparationOutputSchema } from "../lib/episode-v2/prompts/guest-preparation.ts";
import { HOST_PREPARATION_PROMPT, hostPreparationOutputSchema } from "../lib/episode-v2/prompts/host-preparation.ts";
import { guestPreparationFixtures, hostPreparationFixture, preparationFixture } from "./fixtures/preparation.ts";

const at = Date.parse("2026-10-15T17:30:00Z");
const dispatch: StepFactory = (job, read) => job.substep === "host"
  ? createHostPreparationPlan(job, read) : createGuestPreparationPlan(job, read);

function harness(initial: EpisodeV2Job) {
  const sqlite = new DatabaseSync(":memory:"); let clock = at;
  sqlite.exec("CREATE TABLE episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)");
  sqlite.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.userId, initial.status, JSON.stringify(episodeV2JobSchema.parse(initial)), at, at);
  const db: EpisodeDatabase = { prepare(sql) {
    let values: (string | number | null)[] = [];
    const statement = { bind(...bound: (string | number | null)[]) { values = bound; return statement; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
    }; return statement;
  } };
  const store = createD1EpisodeStore(db, { now: () => clock });
  return { store, close: () => sqlite.close(), tick: () => { clock += POLL_INTERVAL_MS; },
    options: { id: initial.id, userId: initial.userId, store, apiKey: "mock-only", now: () => clock, plan: dispatch } };
}

const respond = (output: unknown, id = "resp_preparation", status = "completed") => new Response(JSON.stringify({
  id, status, model: "gpt-6.1-sol", service_tier: "default", output: [], output_text: JSON.stringify(output),
  usage: status === "completed" ? { input_tokens: 6000, output_tokens: 800, total_tokens: 6800,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 300 } } : null,
}));

function completedTransport(observed: { speaker: string; method: string; input: Record<string, any> }[] = []): typeof fetch {
  return async (_url, init) => {
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.input);
    const speaker = input.ownProfile?.speaker ?? "host";
    observed.push({ speaker, method: init!.method!, input });
    assert.equal(body.tools, undefined); assert.equal(body.background, true);
    return respond(speaker === "host" ? hostPreparationFixture : guestPreparationFixtures[speaker as GuestSpeaker], `resp_${speaker}`);
  };
}

test("guest requests contain only their own profile and no other private notes, while retaining all common evidence", async () => {
  const fixture = await preparationFixture(), { job, cast, evidence, read } = fixture;
  const observed: { speaker: string; method: string; input: Record<string, any> }[] = [], h = harness(job);
  try {
    await runDurableStep({ ...h.options, fetch: completedTransport(observed) });
    await runDurableStep({ ...h.options, fetch: completedTransport(observed) });
    const saved = (await h.store.read(job.id, job.userId))!;
    const privateTheses = GUEST_SPEAKERS.slice(0, 2).map(speaker => (saved.state.artifacts[guestPreparationId(speaker)] as GuestPreparation).data.thesis);
    const plan = await createGuestPreparationPlan(saved, async ref => saved.state.artifacts[ref.id]);
    const input = JSON.parse(plan.request.input);
    assert.equal(input.ownProfile.speaker, "expert3");
    assert.deepEqual(input.completeEvidencePack, { reference: artifactRef(evidence), ...evidence.data });
    assert.equal(input.commonBriefing, evidence.data.commonBriefing);
    assert.equal(input.originalProgrammeBrief.status, "not_available");
    assert.equal(input.selectedDuration.lengthMinutes, 5);
    assert.ok(input.relevantReadingBundle.passages.length);
    for (const guest of cast.data.guests.filter(guest => guest.speaker !== "expert3")) assert.equal(plan.request.input.includes(guest.name), false);
    for (const thesis of privateTheses) assert.equal(plan.request.input.includes(thesis), false);
    assert.equal(input.cast, undefined); assert.equal(input.guestPreparationSummaries, undefined);
    assert.equal(plan.request.kind, "structured"); assert.equal(plan.request.role, "guest_preparation");
    assert.match(plan.request.instructions, /Do not guess their views/);
    assert.match(plan.request.instructions, /There is no web access/);
    assert.equal((await createGuestPreparationPlan(job, read)).inputs.some(ref => ref.kind === "guest_preparation"), false);
  } finally { h.close(); }
});

test("SQLite restart after two guests calls only the remaining guest and host, saving exact versions and guest-specific questions", async () => {
  const { job, cast, evidence, brief, sources } = await preparationFixture();
  const first = harness(job), beforeRestart: { speaker: string; method: string; input: Record<string, any> }[] = [];
  await runDurableStep({ ...first.options, fetch: completedTransport(beforeRestart) });
  await runDurableStep({ ...first.options, fetch: completedTransport(beforeRestart) });
  const checkpoint = (await first.store.read(job.id, job.userId))!; first.close();
  const savedFirstTwo = GUEST_SPEAKERS.slice(0, 2).map(speaker => structuredClone(checkpoint.state.artifacts[guestPreparationId(speaker)]));
  assert.deepEqual(beforeRestart.map(call => call.speaker), ["expert1", "expert2"]);
  assert.equal(checkpoint.substep, "expert3");
  const restarted = harness(JSON.parse(JSON.stringify(checkpoint))), afterRestart: typeof beforeRestart = [];
  try {
    await runDurableStep({ ...restarted.options, fetch: completedTransport(afterRestart) });
    const completed = await runDurableStep({ ...restarted.options, fetch: completedTransport(afterRestart) });
    assert.deepEqual(afterRestart.map(call => call.speaker), ["expert3", "host"]);
    const final = completed.job!;
    assert.equal(final.stage, "conversation"); assert.equal(final.substep, "host");
    assert.deepEqual(GUEST_SPEAKERS.slice(0, 2).map(speaker => final.state.artifacts[guestPreparationId(speaker)]), savedFirstTwo);
    assert.equal(final.state.usageLedger!.records.length, 4);
    for (const speaker of GUEST_SPEAKERS) {
      const note = final.state.artifacts[guestPreparationId(speaker)];
      assert.equal(note.kind, "guest_preparation");
      if (note.kind !== "guest_preparation") throw new Error("Wrong artifact kind");
      assert.equal(note.data.speaker, speaker); assert.deepEqual(note.data.cast, artifactRef(cast));
      assert.deepEqual(note.data.evidencePack, artifactRef(evidence));
      assert.deepEqual(note.provenance.prompt, GUEST_PREPARATION_PROMPT);
      assert.deepEqual(note.provenance.inputVersions, [brief, evidence, cast, sources].map(artifactRef));
      assert.equal(final.state.execution!.steps[guestPreparationKey(speaker)].phase, "completed");
    }
    const hostInput = afterRestart[1].input;
    assert.deepEqual(hostInput.guestPreparationSummaries.map((note: GuestPreparation["data"]) => note.thesis), GUEST_SPEAKERS.map(speaker => guestPreparationFixtures[speaker].thesis));
    const host = final.state.artifacts[HOST_PLAN_ID]; assert.equal(host.kind, "host_plan");
    if (host.kind !== "host_plan") throw new Error("Wrong artifact kind");
    assert.deepEqual(host.provenance.prompt, HOST_PREPARATION_PROMPT);
    assert.deepEqual(host.data.guestPreparations, Object.fromEntries(GUEST_SPEAKERS.map(speaker => [speaker, artifactRef(final.state.artifacts[guestPreparationId(speaker)])])));
    assert.deepEqual(host.data.questions, hostPreparationFixture.questions);
    assert.match(host.data.questions[0].question, /one insect can perceive/);
    assert.match(host.data.questions[1].question, /discriminating/);
    assert.match(host.data.questions[2].question, /calibrated observations/);
    assert.equal(final.state.execution!.steps[HOST_PREPARATION_STEP_KEY].phase, "completed");
    const cached = await runDurableStep({ ...restarted.options, plan: createHostPreparationPlan, fetch: completedTransport(afterRestart) });
    assert.equal(cached.disposition, "cached"); assert.equal(afterRestart.length, 2);
  } finally { restarted.close(); }
});

test("an interrupted third guest resumes its saved response with GET and never submits that guest twice", async () => {
  const { job } = await preparationFixture(), initial = harness(job);
  await runDurableStep({ ...initial.options, fetch: completedTransport() });
  await runDurableStep({ ...initial.options, fetch: completedTransport() });
  const methods: string[] = [];
  const pending: typeof fetch = async (_url, init) => {
    methods.push(init!.method!);
    return respond(guestPreparationFixtures.expert3, "resp_saved_third_guest", init?.method === "POST" ? "queued" : "completed");
  };
  await runDurableStep({ ...initial.options, fetch: pending });
  const checkpoint = (await initial.store.read(job.id, job.userId))!; initial.close();
  assert.equal(checkpoint.state.execution!.steps[guestPreparationKey("expert3")].phase, "pending");
  assert.equal(checkpoint.state.artifacts[guestPreparationId("expert3")], undefined);
  const restarted = harness(checkpoint); restarted.tick();
  try {
    await runDurableStep({ ...restarted.options, fetch: pending });
    const calls: { speaker: string; method: string; input: Record<string, any> }[] = [];
    const result = await runDurableStep({ ...restarted.options, fetch: completedTransport(calls) });
    assert.deepEqual(methods, ["POST", "GET"]); assert.deepEqual(calls.map(call => call.speaker), ["host"]);
    assert.equal(result.job!.state.usageLedger!.records.length, 4); assert.equal(result.job!.stage, "conversation");
  } finally { restarted.close(); }
});

test("changed evidence, cast links or editorial metadata pauses before any provider call", async () => {
  const mutations: ((fixture: Awaited<ReturnType<typeof preparationFixture>>) => void)[] = [
    ({ sources }) => { sources.data.sources[0].accessNote += " Materially changed reading after freezing."; },
    ({ cast }) => { cast.data.evidencePack!.version++; },
    ({ brief }) => { brief.data.editorialInputs!.frameworkSourceSha256 = "0".repeat(64); },
    ({ brief }) => { delete brief.data.editorialInputs; },
    ({ job }) => { job.state.programmeBrief = { id: "new-original", version: "1", sha256: "0".repeat(64), text: "A supplied but unverified brief" }; },
  ];
  for (const mutate of mutations) {
    const fixture = await preparationFixture(); mutate(fixture);
    const h = harness(fixture.job); let calls = 0;
    try {
      const result = await runDurableStep({ ...h.options, fetch: async () => { calls++; return respond(guestPreparationFixtures.expert1); } });
      assert.equal(calls, 0); assert.equal(result.job!.pause!.code, "needs_input");
      assert.equal(result.job!.state.usageLedger!.records.length, 0);
      assert.equal(result.job!.state.artifacts[guestPreparationId("expert1")], undefined);
    } finally { h.close(); }
  }
});

test("a verified original programme brief is supplied verbatim, and an uncommissioned revision pauses", async () => {
  const fixture = await preparationFixture(), text = "Original supplied fixture.\nPreserve this complete final paragraph.";
  const programme = { id: "programme-fixture", version: "2", sha256: await sha256(text), text };
  fixture.job.state.programmeBrief = programme;
  fixture.brief.data.editorialInputs!.programmeBrief = { id: programme.id, version: programme.version, sha256: programme.sha256 };
  const plan = await createGuestPreparationPlan(fixture.job, fixture.read);
  assert.deepEqual(JSON.parse(plan.request.input).originalProgrammeBrief, { status: "available", ...programme });
  assert.match(plan.editorialVersion, /programme-programme-fixture@2:/);
  fixture.job.state.programmeBrief.version = "3";
  const h = harness(fixture.job); let calls = 0;
  try {
    const result = await runDurableStep({ ...h.options, fetch: async () => { calls++; return respond({}); } });
    assert.equal(calls, 0); assert.match(result.job!.pause!.reason, /changed after commissioning/);
  } finally { h.close(); }
});

test("host preparation refuses missing notes and stale guest input or prompt metadata before submission", async () => {
  const { job } = await preparationFixture(), original = harness(job);
  for (const _speaker of GUEST_SPEAKERS) await runDurableStep({ ...original.options, fetch: completedTransport() });
  const checkpoint = (await original.store.read(job.id, job.userId))!; original.close();
  for (const mutate of [
    (note: GuestPreparation) => { note.data.evidencePack.version++; },
    (note: GuestPreparation) => { note.provenance.prompt!.version = "stale-prompt"; },
    (note: GuestPreparation) => { note.provenance.editorialVersion = "stale-editorial-input"; },
    (note: GuestPreparation) => { note.provenance.inputVersions = note.provenance.inputVersions.filter(ref => ref.kind !== "source_records"); },
  ]) {
    const changed = structuredClone(checkpoint); mutate(changed.state.artifacts[guestPreparationId("expert2")] as GuestPreparation);
    const h = harness(changed); let calls = 0;
    try {
      const result = await runDurableStep({ ...h.options, fetch: async () => { calls++; return respond(hostPreparationFixture); } });
      assert.equal(calls, 0); assert.equal(result.job!.pause!.code, "needs_input"); assert.equal(result.job!.state.artifacts[HOST_PLAN_ID], undefined);
    } finally { h.close(); }
  }
  const missing = structuredClone(checkpoint);
  delete missing.state.artifacts[guestPreparationId("expert3")]; delete missing.state.execution!.steps[guestPreparationKey("expert3")];
  const h = harness(missing);
  try {
    const result = await runDurableStep({ ...h.options, fetch: async () => { throw new Error("Unexpected provider call"); } });
    assert.match(result.job!.pause!.reason, /missing or cannot be verified/);
  } finally { h.close(); }
});

test("unknown claim or story references never become saved private notes", async () => {
  for (const field of ["supportingClaims", "examplesOrStories"] as const) {
    const { job } = await preparationFixture(), h = harness(job), output = structuredClone(guestPreparationFixtures.expert1);
    output[field] = ["invented-reference"];
    try {
      const result = await runDurableStep({ ...h.options, fetch: async () => respond(output) });
      assert.equal(result.job!.pause!.code, "needs_input");
      assert.equal(result.job!.state.usageLedger!.records[0].outcome, "invalid_output");
      assert.equal(result.job!.state.artifacts[guestPreparationId("expert1")], undefined);
    } finally { h.close(); }
  }
});

test("preparation keeps the source guidance exact and the host output a flexible question pool", () => {
  const framework = readFileSync(new URL("../docs/editorial/framework-v2.1.md", import.meta.url), "utf8");
  for (const paragraph of PREPARATION_GUIDANCE.split("\n\n")) assert.ok(framework.includes(paragraph));
  assert.equal(guestPreparationOutputSchema.safeParse({ ...guestPreparationFixtures.expert1, dialogue: "A prewritten speech" }).success, false);
  assert.equal(hostPreparationOutputSchema.safeParse({ ...hostPreparationFixture, guestAnswers: ["A predetermined answer"] }).success, false);
  assert.equal(hostPreparationOutputSchema.safeParse({ ...hostPreparationFixture, questions: hostPreparationFixture.questions.slice(0, 2) }).success, false);
  const noThirdRoute = structuredClone(hostPreparationFixture); noThirdRoute.questions[2].intendedGuest = "expert1";
  assert.equal(hostPreparationOutputSchema.safeParse(noThirdRoute).success, false);
  assert.equal(hostPreparationOutputSchema.safeParse(hostPreparationFixture).success, true);
});
