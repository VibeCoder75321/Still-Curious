import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { artifactSchema, episodeV2JobSchema, type EpisodeArtifact, type EpisodeV2Job, type Step } from "../lib/episode-v2/contracts.ts";
import { createFiveMinuteConfig } from "../lib/episode-v2/config.ts";
import { createUsageLedger } from "../lib/episode-v2/usage.ts";
import { createD1EpisodeStore, LEASE_MS, MAX_JOB_BYTES, readArtifact, saveArtifact, StaleEpisodeError, type ArtifactBucket, type EpisodeDatabase, type EpisodeStore } from "../lib/episode-v2/persistence.ts";
import { POLL_INTERVAL_MS, runDurableStep, type StepPlan } from "../lib/episode-v2/runner.ts";

const at = Date.parse("2026-10-15T15:00:00Z");
function artifact(id = "brief"): EpisodeArtifact {
  return artifactSchema.parse({
    schemaVersion: 2, pipelineVersion: 2, id, kind: "episode_brief", version: 1, createdAt: new Date(at).toISOString(),
    provenance: { inputVersions: [], editorialVersion: "fixture", prompt: null, modelConfiguration: null, usageRecordIds: [] },
    data: { originalRequest: "Patterns", mainCuriosity: "Explanation", interpretation: "explicit", centralQuestion: "Why this pattern?",
      listenerPromise: "Understand one explanation", startingKnowledge: "General interest", essentialFoundations: ["Observation"],
      deeperFocus: "Evidence", exclusions: ["Complete survey"], secondaryQuestions: [], premisesToCheck: [], lengthMinutes: 5, atmosphere: "Calm" },
  });
}
function job(): EpisodeV2Job {
  return episodeV2JobSchema.parse({
    schemaVersion: 2, pipelineVersion: 2, id: "episode", userId: "owner", topic: "Patterns", lengthMinutes: 5,
    createdAt: at, updatedAt: at, status: "running", stage: "commission", substep: "produce", progress: {},
    config: createFiveMinuteConfig({ spendCeilingUsd: 20 }),
    state: { artifacts: {}, sources: [], usageLedger: createUsageLedger({
      spendCeilingUsd: 20, allocations: { research: 8, text: 7, review: 4, audio: 1 }, maxOperations: 64, maxSearchCalls: 4, maxSourceReads: 8,
    }) },
  });
}
function plan(key = "commission.produce:0", step: Step = { stage: "commission", substep: "produce" }, next: Step = { stage: "research", substep: "discover" }): StepPlan<{ answer: string }> {
  return {
    key, step, inputs: [], prompt: { id: "fixture", version: "1" }, editorialVersion: "framework-2.1",
    request: { kind: "structured", role: "producer", instructions: "Fixture instructions", input: "Fixture input", schemaName: "fixture",
      jsonSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
      parse: value => { assert.equal(typeof (value as { answer: string }).answer, "string"); return value as { answer: string }; },
    },
    finish: result => ({ artifacts: [artifact(result.value.answer)], next }),
  };
}
const respond = (status = "completed", id = "resp_fixture") => new Response(JSON.stringify({
  id, status, model: "gpt-6.1-sol", service_tier: "default", output: [], output_text: JSON.stringify({ answer: "brief" }),
  usage: status === "completed" ? { input_tokens: 100, output_tokens: 100, total_tokens: 200,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 20 } } : null,
}), { headers: { "x-request-id": "req_fixture" } });

function harness(initial = job()) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("CREATE TABLE episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)");
  sqlite.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.userId, initial.status, JSON.stringify(initial), at, at);
  // Run the production repository's SQL against SQLite, including its JSON/CAS predicates.
  const db: EpisodeDatabase = { prepare(sql) {
    let values: (string | number | null)[] = [];
    const statement = {
      bind(...bound: (string | number | null)[]) { values = bound; return statement; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
    }; return statement;
  } };
  let clock = at;
  const store = createD1EpisodeStore(db, { now: () => clock });
  return { sqlite, db, store, now: () => clock, tick: (ms = POLL_INTERVAL_MS) => { clock += ms; },
    options: { id: initial.id, userId: initial.userId, store, apiKey: "mock-only", now: () => clock, plan: () => plan() },
  };
}
function bucket() {
  const objects = new Map<string, string>();
  const storage: ArtifactBucket = {
    async put(key, value) { objects.set(key, value); },
    async get(key) { const value = objects.get(key); if (!value) return null;
      const buffer = new TextEncoder().encode(value).buffer;
      return { size: buffer.byteLength, async arrayBuffer() { return buffer; } };
    },
  }; return { objects, storage };
}

test("reservation, exact inputs, policy and attempt are durable before the only submission", async () => {
  const h = harness(); let calls = 0;
  const result = await runDurableStep({ ...h.options, fetch: async (_url, init) => {
    calls++; assert.equal(init?.method, "POST"); assert.equal(JSON.parse(String(init?.body)).background, true);
    const saved = (await h.store.read("episode", "owner"))!;
    const attempt = saved.state.execution!.steps["commission.produce:0"];
    assert.match(attempt.inputHash, /^[a-f0-9]{64}$/); assert.equal(attempt.phase, "submitted");
    assert.equal(saved.state.usageLedger!.records[0].id, attempt.id); assert.ok(saved.state.modelPolicy);
    assert.equal(saved.state.usageLedger!.records[0].outcome, "reserved");
    return respond();
  } });
  assert.equal(calls, 1); assert.equal(result.job?.stage, "research");
  const output = result.job!.state.artifacts.brief;
  assert.deepEqual(output.provenance.prompt, { id: "fixture", version: "1" });
  assert.equal(output.provenance.modelConfiguration?.model, "gpt-6.1-sol");
  assert.equal(output.provenance.usageRecordIds[0], result.job!.state.usageLedger!.records[0].id);
  assert.equal(result.job!.state.execution!.steps["commission.produce:0"].phase, "completed");
});

test("concurrent advances submit once; the other caller sees the active lock", async () => {
  const h = harness(); let calls = 0, started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  const fetchMock: typeof fetch = async () => { calls++; started(); await gate; return respond(); };
  const first = runDurableStep({ ...h.options, fetch: fetchMock }); await entered;
  const second = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(second.disposition, "busy"); assert.equal(calls, 1);
  finish(); await first;
  assert.equal(Object.keys((await h.store.read("episode", "owner"))!.state.artifacts).length, 1);
});

test("restart polls one saved ID and atomically accepts one result without a second reservation", async () => {
  const h = harness(), methods: string[] = [];
  const fetchMock: typeof fetch = async (url, init) => {
    methods.push(init!.method!);
    if (init?.method === "POST") return respond("queued");
    assert.match(String(url), /responses\/resp_fixture\?include/); assert.equal(init?.body, undefined); return respond();
  };
  const pending = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(pending.job!.state.execution!.steps["commission.produce:0"].phase, "pending");
  assert.equal(pending.job!.state.usageLedger!.records[0].responseId, "resp_fixture");
  await runDurableStep({ ...h.options, fetch: fetchMock }); assert.deepEqual(methods, ["POST"], "poll delay is respected");
  h.tick();
  const restored = createD1EpisodeStore(h.db, { now: h.now });
  const completed = await runDurableStep({ ...h.options, store: restored, fetch: fetchMock });
  assert.deepEqual(methods, ["POST", "GET"]); assert.equal(completed.job!.state.usageLedger!.records.length, 1);
  assert.equal(completed.job!.state.usageLedger!.records[0].outcome, "completed");
  assert.equal(completed.job!.state.execution!.steps["commission.produce:0"].phase, "completed");
  const repeated = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(repeated.disposition, "cached"); assert.deepEqual(methods, ["POST", "GET"]);
});

test("expired lease after submission cannot authorize another paid request or accept the late result", async () => {
  const h = harness(); let calls = 0, started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  const fetchMock: typeof fetch = async () => { calls++; started(); await gate; return respond(); };
  const first = runDurableStep({ ...h.options, fetch: fetchMock }); await entered;
  h.tick(LEASE_MS + 1);
  const recovered = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(recovered.job!.status, "paused"); assert.equal(recovered.job!.pause?.code, "ambiguous_provider_result");
  assert.equal(calls, 1); assert.equal(recovered.job!.state.usageLedger!.records[0].outcome, "reserved");
  finish(); const late = await first;
  assert.equal(late.disposition, "stale"); assert.deepEqual(late.job!.state.artifacts, {});
  await runDurableStep({ ...h.options, fetch: fetchMock }); assert.equal(calls, 1);
});

test("interrupted unknown completion retains its allowance and never automatically resubmits", async () => {
  const h = harness(); let calls = 0;
  const fetchMock: typeof fetch = async () => { calls++; throw new Error("private transport detail"); };
  await runDurableStep({ ...h.options, fetch: fetchMock });
  const result = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(calls, 1); assert.equal(result.job!.pause?.code, "ambiguous_provider_result");
  const record = result.job!.state.usageLedger!.records[0];
  assert.equal(record.outcome, "uncertain"); assert.equal(record.allowanceUsd, record.reservedUsd);
  assert.doesNotMatch(JSON.stringify(result.job), /private transport detail|mock-only/);
});

test("unavailable or mismatched retrieved responses keep the original ID and held reservation", async () => {
  for (const mode of ["404", "mismatch", "transport"]) {
    const h = harness(); let posts = 0, gets = 0;
    const fetchMock: typeof fetch = async (_url, init) => {
      if (init?.method === "POST") { posts++; return respond("in_progress"); }
      gets++;
      if (mode === "transport") throw new Error("private retrieval detail");
      return mode === "404" ? new Response("{}", { status: 404 }) : respond("completed", "resp_wrong");
    };
    await runDurableStep({ ...h.options, fetch: fetchMock }); h.tick();
    await runDurableStep({ ...h.options, fetch: fetchMock });
    const result = await runDurableStep({ ...h.options, fetch: fetchMock });
    assert.equal(posts, 1); assert.equal(gets, 2); assert.deepEqual(result.job!.state.artifacts, {});
    const record = result.job!.state.usageLedger!.records[0];
    assert.equal(record.responseId, "resp_fixture"); assert.equal(record.allowanceUsd, record.reservedUsd);
    assert.equal(record.outcome, "uncertain");
  }
});

test("a changed prompt or input version cannot reconcile an older operation", async () => {
  const h = harness(); let calls = 0;
  const fetchMock: typeof fetch = async () => { calls++; return respond("queued"); };
  await runDurableStep({ ...h.options, fetch: fetchMock }); h.tick();
  const result = await runDurableStep({ ...h.options, fetch: fetchMock, plan: () => { const p = plan(); p.prompt.version = "2"; return p; } });
  assert.equal(result.disposition, "stale"); assert.equal(calls, 1); assert.deepEqual(result.job!.state.artifacts, {});
  const initial = job(); initial.state.artifacts.input = artifact("input");
  const second = harness(initial);
  const inputPlan = () => { const p = plan(); p.inputs = [{ id: "input", kind: "episode_brief", version: 1 }]; return p; };
  await runDurableStep({ ...second.options, fetch: fetchMock, plan: inputPlan }); second.tick();
  const changed = (await second.store.read("episode", "owner"))!;
  changed.state.artifacts.input.version = 2;
  second.sqlite.prepare("UPDATE episodes SET job_json = ? WHERE id = ?").run(JSON.stringify(changed), "episode");
  await assert.rejects(runDurableStep({ ...second.options, fetch: fetchMock, plan: inputPlan }), /input version/);
  const changedRef = await runDurableStep({ ...second.options, fetch: fetchMock, plan: () => { const p = inputPlan(); p.inputs[0].version = 2; return p; } });
  assert.equal(changedRef.disposition, "stale"); assert.equal(calls, 2, "neither changed input form polls or submits");
});

test("exact saved JSON rejects stale completion even when an outside writer omitted the revision", async () => {
  const h = harness(); let started!: () => void, finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  const running = runDurableStep({ ...h.options, fetch: async () => { started(); await gate; return respond(); } });
  await entered;
  const changed = (await h.store.read("episode", "owner"))!; changed.topic = "A changed topic";
  h.sqlite.prepare("UPDATE episodes SET job_json = ? WHERE id = ?").run(JSON.stringify(changed), "episode");
  finish(); const result = await running;
  assert.equal(result.disposition, "stale"); assert.equal(result.job!.topic, "A changed topic"); assert.deepEqual(result.job!.state.artifacts, {});
});

test("lost acknowledgement after atomic result save reloads the artifact and cannot repeat spending", async () => {
  const h = harness(); let calls = 0;
  const uncertainStore: EpisodeStore = { ...h.store, async save(lease, candidate) {
    await h.store.save(lease, candidate);
    if (Object.keys(candidate.state.artifacts).length) throw new Error("acknowledgement lost");
  } };
  const fetchMock: typeof fetch = async () => { calls++; return respond(); };
  const result = await runDurableStep({ ...h.options, store: uncertainStore, fetch: fetchMock });
  assert.equal(result.disposition, "stale"); assert.ok(result.job!.state.artifacts.brief);
  const again = await runDurableStep({ ...h.options, fetch: fetchMock });
  assert.equal(again.disposition, "cached"); assert.equal(calls, 1); assert.equal(again.job!.state.usageLedger!.records.length, 1);
});

test("failed reservation persistence and insufficient allowance prevent submission", async () => {
  const h = harness(); let calls = 0;
  const fetchMock: typeof fetch = async () => { calls++; return respond(); };
  await runDurableStep({ ...h.options, fetch: fetchMock, store: { ...h.store, async save() { throw new Error("unavailable"); } } });
  assert.equal(calls, 0); assert.equal((await h.store.read("episode", "owner"))!.state.usageLedger!.records.length, 0);
  const limited = job(); limited.state.usageLedger!.allocations.text = 0;
  const second = harness(limited);
  const result = await runDurableStep({ ...second.options, fetch: fetchMock });
  assert.equal(result.job!.pause?.code, "budget"); assert.equal(calls, 0);
});

test("failed artifact acceptance saves provider metadata and pauses without rerunning the conversation", async () => {
  const h = harness(); let calls = 0;
  const fetchMock: typeof fetch = async () => { calls++; return respond(); };
  const result = await runDurableStep({ ...h.options, fetch: fetchMock, plan: () => ({ ...plan(), finish: () => { throw new Error("bad conversion"); } }) });
  assert.equal(result.job!.pause?.code, "needs_input"); assert.equal(result.job!.stage, "commission");
  assert.equal(result.job!.state.usageLedger!.records[0].responseId, "resp_fixture");
  assert.deepEqual(result.job!.state.artifacts, {});
  await runDurableStep({ ...h.options, fetch: fetchMock }); assert.equal(calls, 1);
});

test("each guest preparation is its own single-operation advance", async () => {
  const initial = job(); initial.stage = "preparation"; initial.substep = "expert1";
  const h = harness(initial); let calls = 0;
  const fetchMock: typeof fetch = async () => { calls++; return respond(); };
  await runDurableStep({ ...h.options, fetch: fetchMock, plan: () => plan("prep:expert1", { stage: "preparation", substep: "expert1" }, { stage: "preparation", substep: "expert2" }) });
  assert.equal(calls, 1); assert.equal((await h.store.read("episode", "owner"))!.substep, "expert2");
  const bidJob = job(); bidJob.stage = "conversation"; bidJob.substep = "request_expert1";
  const bid = harness(bidJob);
  await runDurableStep({ ...bid.options, fetch: fetchMock, plan: () => plan("bid:round1:expert1", { stage: "conversation", substep: "request_expert1" }, { stage: "conversation", substep: "request_expert2" }) });
  assert.equal(calls, 2); assert.equal((await bid.store.read("episode", "owner"))!.substep, "request_expert2");
});

test("private source artifacts are bounded, immutable and checked for ownership, version and tampering", async () => {
  const j = job(), b = bucket();
  const source = artifactSchema.parse({ ...artifact("sources"), kind: "source_records", data: { sources: [{
    id: "s1", title: "Fixture", url: "https://example.org", authors: [], accessedAt: new Date(at).toISOString(),
    sourceType: "primary_study", evidenceFamilyId: "family", publicationStatus: "published", notices: [], readingCoverage: "partial",
    accessNote: "Synthetic fixture", passages: [{ id: "p1", text: "x".repeat(40_000), locator: "Body", coverage: "body" }],
  }] } });
  const ref = await saveArtifact(j, source, b.storage);
  assert.equal(j.state.artifacts.sources, undefined); assert.equal(b.objects.size, 1);
  assert.deepEqual(await readArtifact(j, ref, b.storage), source);
  await assert.rejects(saveArtifact(j, source, b.storage), /immutable/);
  await assert.rejects(readArtifact(j, { ...ref, version: 2 }, b.storage), /version/);
  const other = structuredClone(j); other.userId = "other";
  await assert.rejects(readArtifact(other, ref, b.storage), /Owned/);
  const [key, value] = [...b.objects][0]; b.objects.set(key, value.replace("Synthetic", "Tampered!"));
  await assert.rejects(readArtifact(j, ref, b.storage), /integrity/);
  const oversized = { ...source, id: "too-large" };
  if (oversized.kind === "source_records") oversized.data.sources[0].passages[0].text = "x".repeat(270_000);
  await assert.rejects(saveArtifact(j, oversized, b.storage), /allowance/);
});

test("owner isolation, lock expiry and revision comparison use the production SQL", async () => {
  const h = harness(); assert.equal(await h.store.claim("episode", "stranger"), null);
  assert.equal(await h.store.read("episode", "stranger"), null);
  const first = (await h.store.claim("episode", "owner"))!;
  assert.equal(await h.store.claim("episode", "owner"), null);
  h.tick(LEASE_MS + 1); const replacement = (await h.store.claim("episode", "owner"))!;
  await assert.rejects(h.store.save(first, structuredClone(first.job)), StaleEpisodeError);
  await h.store.release(first);
  assert.equal(await h.store.claim("episode", "owner"), null, "an old release cannot clear a new lock");
  await h.store.save(replacement, structuredClone(replacement.job));
  await h.store.release(replacement);
});

test("job state has a hard size bound and completed outputs must resolve to saved versions", async () => {
  const h = harness(), lease = (await h.store.claim("episode", "owner"))!;
  const oversized = structuredClone(lease.job); oversized.progress.large = "x".repeat(MAX_JOB_BYTES);
  await assert.rejects(h.store.save(lease, oversized), /storage allowance/);
  assert.deepEqual((await h.store.read("episode", "owner"))!.progress, {});
  await h.store.release(lease);
  const result = await runDurableStep({ ...h.options, fetch: async () => respond() });
  const broken = structuredClone(result.job!); delete broken.state.artifacts.brief;
  assert.equal(episodeV2JobSchema.safeParse(broken).success, false);
});
