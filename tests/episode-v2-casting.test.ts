import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { type EpisodeV2Job } from "../lib/episode-v2/contracts.ts";
import { createD1EpisodeStore, type EpisodeDatabase } from "../lib/episode-v2/persistence.ts";
import { POLL_INTERVAL_MS, runDurableStep } from "../lib/episode-v2/runner.ts";
import { artifactRef } from "../lib/episode-v2/stage-helpers.ts";
import { CAST_ID, CASTING_STEP_KEY, createCastingPlan } from "../lib/episode-v2/stages/casting.ts";
import { CASTING_FRAMEWORK_GUIDANCE, CASTING_INSTRUCTIONS, CASTING_PROMPT, castingOutputSchema } from "../lib/episode-v2/prompts/casting.ts";
import { castingFixture } from "./fixtures/casting.ts";
import { frozenEvidenceFixture } from "./fixtures/evidence.ts";
import { validEnsemble } from "../lib/episode-v2/personality.ts";

const at = Date.parse("2026-10-15T17:30:00Z");
function harness(initial: EpisodeV2Job) {
  initial.stage = "casting"; initial.substep = "cast"; initial.status = "running"; delete initial.pause;
  const sqlite = new DatabaseSync(":memory:"); let clock = at;
  sqlite.exec("CREATE TABLE episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)");
  sqlite.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.userId, initial.status, JSON.stringify(initial), at, at);
  const db: EpisodeDatabase = { prepare(sql) {
    let values: (string | number | null)[] = [];
    const statement = { bind(...bound: (string | number | null)[]) { values = bound; return statement; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
    }; return statement;
  } };
  const store = createD1EpisodeStore(db, { now: () => clock });
  return { store, tick() { clock += POLL_INTERVAL_MS; }, options: {
    id: initial.id, userId: initial.userId, store, apiKey: "mock-only", now: () => clock, plan: createCastingPlan,
  } };
}
const respond = (output: unknown, status = "completed") => new Response(JSON.stringify({
  id: "resp_casting", status, model: "gpt-6.1-sol", service_tier: "default", output: [], output_text: JSON.stringify(output),
  usage: status === "completed" ? { input_tokens: 5000, output_tokens: 1100, total_tokens: 6100,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 300 } } : null,
}));

test("personalized casting atomically saves all prompts and resumes one paid request across concurrent callers", async () => {
  const fixture = await frozenEvidenceFixture(); fixture.job.state.personalitySeed = crypto.randomUUID();
  const h = harness(fixture.job), methods: string[] = [];
  const output = { ...castingFixture, guests: castingFixture.guests.map(({ temperament: _t, confidenceStyle: _c, humour: _h, ...guest }) => guest) };
  const fetchMock: typeof fetch = async (_url, init) => {
    methods.push(init!.method!);
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      assert.equal(body.text.format.schema.properties.guests.items.properties.temperament, undefined);
    }
    return respond(output, init?.method === "POST" ? "queued" : "completed");
  };
  const first = await Promise.all([runDurableStep({ ...h.options, fetch: fetchMock }), runDurableStep({ ...h.options, fetch: fetchMock })]);
  assert.ok(first.some(r => r.disposition === "busy")); assert.deepEqual(methods, ["POST"]);
  h.tick(); const resumed = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(resumed.job!.stage, "preparation");
  const cast = resumed.job!.state.artifacts[CAST_ID];
  assert.equal(cast.kind, "cast"); if (cast.kind !== "cast") return;
  assert.ok(cast.data.personality); assert.ok(validEnsemble(cast.data.personality.cast.map(g => g.personality)));
  assert.equal(new Set(cast.data.personality.cast.map(g => g.prompt)).size, 3);
  assert.ok(cast.data.personality.host_cast_brief);
  assert.equal(cast.data.guests[0].temperament, undefined);
  const saved = JSON.stringify(cast);
  const cached = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(cached.disposition, "cached"); assert.deepEqual(methods, ["POST", "GET"]);
  assert.equal(JSON.stringify(cached.job!.state.artifacts[CAST_ID]), saved);
});

test("casting uses exact framework excerpts and the frozen pack, with voice mapping and private preparation excluded", async () => {
  const source = readFileSync(new URL("../docs/editorial/framework-v2.1.md", import.meta.url), "utf8");
  const expected = source.slice(source.indexOf("## 4 Casting people"), source.indexOf("### What each person receives"))
    + "\n" + source.slice(source.indexOf("### Shared programme brief"), source.indexOf("### Editorial producer"))
    + "\n" + source.slice(source.indexOf("### Casting producer"), source.indexOf("### Guest preparing for the discussion"));
  assert.equal(CASTING_FRAMEWORK_GUIDANCE, expected);
  const fixture = await frozenEvidenceFixture(), plan = await createCastingPlan(fixture.job, fixture.read);
  const input = JSON.parse(plan.request.input);
  assert.equal(plan.request.kind, "structured"); assert.equal(plan.request.role, "casting");
  assert.deepEqual(input.frozenEvidencePack, fixture.evidence);
  assert.deepEqual(input.episodeBrief, fixture.brief);
  assert.deepEqual(plan.inputs, [artifactRef(fixture.brief), artifactRef(fixture.evidence)]);
  assert.equal(input.originalProgrammeBrief.status, "not_available");
  assert.equal(input.guestPreparations, undefined); assert.equal(input.voiceMapping, undefined);
  assert.match(CASTING_INSTRUCTIONS, /All three may agree/);
  assert.match(CASTING_INSTRUCTIONS, /No dialogue, guest answers, private preparation notes/);
  assert.match(CASTING_INSTRUCTIONS, /Do not assign fixed speaking functions/);
});

test("one durable casting call saves three distinct fictional specialists and stable names and audio IDs atomically", async () => {
  const fixture = await frozenEvidenceFixture(), h = harness(fixture.job); let calls = 0, acceptedWrites = 0;
  const store = { ...h.store, async save(lease: Parameters<typeof h.store.save>[0], candidate: EpisodeV2Job) {
    if (candidate.stage === "preparation") {
      acceptedWrites++;
      assert.equal(candidate.state.execution!.steps[CASTING_STEP_KEY].phase, "completed");
      assert.equal(candidate.state.usageLedger!.records.at(-1)!.outcome, "completed");
      assert.equal(candidate.state.artifacts[CAST_ID].kind, "cast");
    }
    await h.store.save(lease, candidate);
  } };
  const fetchMock: typeof fetch = async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    assert.equal(body.background, true); assert.equal(body.tools, undefined);
    assert.equal(body.text.format.name, "still_curious_casting_v1");
    return respond(castingFixture);
  };
  const result = await runDurableStep({ ...h.options, store, fetch: fetchMock });
  const cast = result.job!.state.artifacts[CAST_ID];
  if (cast.kind !== "cast") throw new Error("Expected the saved cast");
  assert.equal(result.job!.stage, "preparation"); assert.equal(result.job!.substep, "expert1");
  assert.deepEqual(cast.data.guests.map(guest => guest.speaker), ["expert1", "expert2", "expert3"]);
  assert.deepEqual(cast.data.guests.map(guest => guest.name), castingFixture.guests.map(guest => guest.name));
  assert.equal(cast.data.host.speaker, "host");
  assert.deepEqual(cast.data.evidencePack, artifactRef(fixture.evidence));
  assert.deepEqual(cast.provenance.prompt, CASTING_PROMPT);
  assert.deepEqual(cast.provenance.inputVersions, [artifactRef(fixture.brief), artifactRef(fixture.evidence)]);
  assert.equal(cast.provenance.usageRecordIds.length, 1);
  assert.equal(new Set(cast.data.guests.map(guest => guest.trustedMethods[0])).size, 3);
  assert.equal(new Set(cast.data.guests.map(guest => guest.evidencePerspective!.rationale)).size, 3);
  for (const guest of cast.data.guests) {
    assert.equal(guest.fictional, true);
    assert.deepEqual(guest.evidencePerspective!.sharedClaimIds, ["c1"]);
    assert.ok(guest.conditionsForRevision.length); assert.ok(guest.blindSpots.length); assert.ok(guest.confidenceStyle);
  }
  const cached = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(cached.disposition, "cached"); assert.deepEqual(cached.job, result.job);
  assert.equal(calls, 1); assert.equal(acceptedWrites, 1);
});

test("a background casting restart retrieves the same paid operation and preserves its final identities", async () => {
  const fixture = await frozenEvidenceFixture(), h = harness(fixture.job), methods: string[] = [];
  const fetchMock: typeof fetch = async (_url, init) => {
    methods.push(init!.method!); return respond(castingFixture, init?.method === "POST" ? "queued" : "completed");
  };
  const first = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(first.job!.state.artifacts[CAST_ID], undefined);
  h.tick(); const completed = await runDurableStep({ ...h.options, fetch: fetchMock });
  const cached = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.deepEqual(methods, ["POST", "GET"]); assert.equal(cached.disposition, "cached");
  assert.deepEqual(cached.job!.state.artifacts[CAST_ID], completed.job!.state.artifacts[CAST_ID]);
  assert.equal(completed.job!.state.usageLedger!.records.length - fixture.job.state.usageLedger!.records.length, 1);
});

test("changed source data or episode brief pauses casting before any paid operation", async () => {
  for (const change of ["source", "brief"] as const) {
    const fixture = await frozenEvidenceFixture();
    if (change === "source") {
      fixture.sources.data.sources[0].accessNote += " Changed after freezing.";
      fixture.job.state.artifacts[fixture.sources.id] = fixture.sources;
    }
    else {
      const revised = structuredClone(fixture.brief); revised.id = "episode-brief:2"; revised.version = 2;
      revised.data.centralQuestion = "A materially different question";
      fixture.job.state.artifacts[revised.id] = revised;
    }
    const h = harness(fixture.job); let calls = 0;
    const result = await runDurableStep({ ...h.options, fetch: async () => { calls++; return respond(castingFixture); } });
    assert.equal(result.job!.pause!.code, "needs_input"); assert.equal(result.job!.stage, "casting");
    assert.equal(result.job!.state.artifacts[CAST_ID], undefined); assert.equal(calls, 0);
    assert.equal(result.job!.state.usageLedger!.records.length, fixture.job.state.usageLedger!.records.length);
  }
});

test("invalid cast profiles and unknown claim references never create a partial cast or trigger automatic regeneration", async () => {
  for (const mutate of [
    (output: typeof castingFixture) => { output.guests.pop(); },
    (output: typeof castingFixture) => { output.guests[1].name = ` ${output.guests[0].name.toUpperCase()} `; },
    (output: typeof castingFixture) => { output.guests[1].expertise = [...output.guests[0].expertise]; output.guests[1].trustedMethods = [...output.guests[0].trustedMethods]; },
    (output: typeof castingFixture) => { output.guests[2].conditionsForRevision = []; },
    (output: typeof castingFixture) => { output.guests[2].evidencePerspective.sharedClaimIds = ["not-in-frozen-evidence"]; },
  ]) {
    const fixture = await frozenEvidenceFixture(), h = harness(fixture.job), output = structuredClone(castingFixture); mutate(output);
    let calls = 0; const fetchMock: typeof fetch = async () => { calls++; return respond(output); };
    const result = await runDurableStep({ ...h.options, fetch: fetchMock });
    assert.equal(result.job!.stage, "casting"); assert.equal(result.job!.pause!.code, "needs_input");
    assert.equal(result.job!.state.artifacts[CAST_ID], undefined);
    assert.equal(result.job!.state.execution!.steps[CASTING_STEP_KEY].phase, "failed");
    await runDurableStep({ ...h.options, fetch: fetchMock }); assert.equal(calls, 1);
  }
});

test("all three cast perspectives must share a supported evidence discussion and cannot supply voice or identity overrides", async () => {
  for (const property of ["speaker", "fictional", "voice"] as const) {
    const output = structuredClone(castingFixture) as unknown as { guests: Record<string, unknown>[] };
    output.guests[0][property] = property === "fictional" ? false : "override";
    assert.equal(castingOutputSchema.safeParse(output).success, false);
  }
  const fixture = await frozenEvidenceFixture();
  const h = harness(fixture.job), output = structuredClone(castingFixture);
  output.guests[2].evidencePerspective.sharedClaimIds = ["c2"];
  const result = await runDurableStep({ ...h.options, fetch: async () => respond(output) });
  assert.equal(result.job!.pause!.code, "needs_input"); assert.equal(result.job!.state.artifacts[CAST_ID], undefined);
});
