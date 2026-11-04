import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { episodeV2JobSchema, type EpisodeV2Job, type Transcript } from "../lib/episode-v2/contracts.ts";
import { createD1EpisodeStore, readArtifact, type ArtifactBucket, type EpisodeDatabase } from "../lib/episode-v2/persistence.ts";
import { POLL_INTERVAL_MS, runDurableStep } from "../lib/episode-v2/runner.ts";
import { createConversationPlan } from "../lib/episode-v2/conversation.ts";
import { conversationFixture, conversationScenario, guestContribution, hostAction, offeredRequest, scenarioOutput } from "./fixtures/conversation.ts";

const at = Date.parse("2026-10-15T17:30:00Z");
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
    options: { id: initial.id, userId: initial.userId, store, apiKey: "mock-only", now: () => clock, plan: createConversationPlan } };
}

const respond = (output: unknown, model: string, id: string, status = "completed") => new Response(JSON.stringify({
  id, status, model, service_tier: "default", output: [], output_text: JSON.stringify(output),
  usage: status === "completed" ? { input_tokens: 6000, output_tokens: 800, total_tokens: 6800,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 300 } } : null,
}));
type Observed = { speaker: string; input: Record<string, any>; body: Record<string, any>; method: string };
function transport(outputs: ((input: Record<string, any>) => unknown)[], observed: Observed[] = []): typeof fetch {
  let index = 0;
  return async (_url, init) => {
    assert.equal(init!.method, "POST");
    const body = JSON.parse(String(init?.body)), input = JSON.parse(body.input);
    observed.push({ speaker: input.ownProfile.speaker, input, body, method: init!.method! });
    assert.equal(body.tools, undefined); assert.equal(body.max_tool_calls, undefined); assert.equal(body.background, true);
    assert.equal(body.text.format.strict, true);
    const output = outputs[index]; assert.ok(output, `Unexpected provider operation ${index + 1}`);
    return respond(output(input), body.model, `resp_conversation_${++index}`);
  };
}
function latestTranscript(job: EpisodeV2Job): Transcript {
  const artifacts = Object.values(job.state.artifacts).filter((artifact): artifact is Transcript => artifact.kind === "transcript");
  assert.ok(artifacts.length, "An accepted operation must save its transcript snapshot");
  return artifacts.sort((a, b) => b.version - a.version)[0];
}
function memoryBucket() {
  const objects = new Map<string, string>(), metadata: { contentType: string; cacheControl: string }[] = [];
  const storage: ArtifactBucket = {
    async put(key, value, options) { objects.set(key, value); metadata.push(options!.httpMetadata); },
    async get(key) {
      const value = objects.get(key); if (!value) return null;
      const buffer = new TextEncoder().encode(value).buffer;
      return { size: buffer.byteLength, async arrayBuffer() { return buffer; } };
    },
  };
  return { storage, objects, metadata };
}

test("authored conversation runs one durable operation at a time, preserving every accepted word through response, tangent, bids and closure", async () => {
  const { job, preparations } = await conversationFixture(), h = harness(job), observed: Observed[] = [];
  const fetch = transport(Array.from({ length: 12 }, (_, index) => input => scenarioOutput(index, input)), observed);
  let previousTurns: Transcript["data"]["turns"] = [];
  const snapshots: Transcript[] = [];
  try {
    for (let operation = 0; operation < 12; operation++) {
      const beforeCalls = observed.length;
      const result = await runDurableStep({ ...h.options, fetch });
      assert.equal(result.job!.status, "running", result.job!.pause?.reason);
      assert.equal(observed.length - beforeCalls, 1, "Each advance can initiate only its one saved provider operation");
      const transcript = latestTranscript(result.job!);
      assert.deepEqual(transcript.data.turns.slice(0, previousTurns.length), previousTurns);
      assert.equal(transcript.data.conversation!.operationCount, operation + 1);
      assert.equal(transcript.version, operation + 1);
      for (const saved of snapshots) assert.deepEqual(result.job!.state.artifacts[saved.id], saved, "A later operation must not rewrite an earlier snapshot");
      snapshots.push(structuredClone(transcript)); previousTurns = structuredClone(transcript.data.turns);
      if (operation === 1) assert.equal(transcript.data.conversation!.responseDue!.speaker, "expert2");
      if (operation === 2) { assert.equal(result.job!.substep, "expert2"); assert.equal(transcript.data.turns.length, 2); }
      if (operation === 3) assert.equal(transcript.data.conversation!.responseDue, null);
      if (operation === 4) assert.match(transcript.data.showState.detourReturnPoint!, /shared rhythm/);
      if (operation >= 6 && operation <= 8) assert.equal(transcript.data.turns.length, 5, "Listening and silent collection have no audio turn");
    }
    const final = (await h.store.read(job.id, job.userId))!, transcript = latestTranscript(final);
    assert.equal(final.stage, "editing"); assert.equal(final.substep, "edit");
    assert.deepEqual(transcript.data.turns.map(turn => turn.speaker), ["host", "expert1", "expert2", "host", "expert3", "host", "expert1", "host"]);
    assert.deepEqual(transcript.data.turns.map(turn => turn.text), [conversationScenario.introduction, conversationScenario.challenge, conversationScenario.reply,
      conversationScenario.tangent, conversationScenario.tangentReply, conversationScenario.invitation, conversationScenario.contribution, conversationScenario.ending]);
    assert.equal(new Set(transcript.data.turns.map(turn => turn.id)).size, 8);
    assert.equal(transcript.data.showState.detourReturnPoint, null); assert.equal(transcript.data.showState.nextSpeaker, null);
    assert.equal(transcript.data.conversation!.closed, true); assert.equal(transcript.data.conversation!.bidRounds, 1);
    const offered = transcript.data.conversation!.requests.find(request => request.speaker === "expert1")!;
    assert.equal(offered.status, "used"); assert.equal(offered.usedAtTurnId, "turn-7"); assert.equal(offered.feedback!.useful, true);
    assert.equal(transcript.data.conversation!.requests.find(request => request.speaker === "expert2")!.status, "passed");
    assert.equal(final.state.usageLedger!.records.length, 12);
    assert.equal(Object.values(final.state.execution!.steps).filter(step => step.phase === "completed").length, 12);
    for (const call of observed.filter(call => call.speaker !== "host")) {
      assert.equal(call.input.ownPreparation.speaker, call.speaker);
      for (const note of preparations.filter(note => note.data.speaker !== call.speaker)) assert.equal(JSON.stringify(call.input).includes(note.data.thesis), false);
      assert.equal(call.input.hostPlan, undefined); assert.equal(call.input.guestPreparationSummaries, undefined);
    }
    assert.deepEqual(observed[3].input.acceptedTranscript.turns, snapshots[2].data.turns);
    assert.equal(observed[3].input.currentInvitation.speaker, "expert2");
    assert.ok(observed[9].input.contributionRequests.some((request: { id: string }) => request.id === offered.id));
  } finally { h.close(); }
});

test("a queued invited guest resumes after restart with GET only, appends once and preserves the selected next host", async () => {
  const { job } = await conversationFixture(), first = harness(job), methods: string[] = [];
  await runDurableStep({ ...first.options, fetch: transport([() => hostAction()]) });
  let savedModel = "";
  const pending: typeof fetch = async (_url, init) => {
    methods.push(init!.method!);
    if (init?.method === "POST") savedModel = JSON.parse(String(init.body)).model;
    return respond(guestContribution("A controlled change could distinguish the explanations."), savedModel, "resp_saved_invited_guest", init?.method === "POST" ? "queued" : "completed");
  };
  await runDurableStep({ ...first.options, fetch: pending });
  const checkpoint = (await first.store.read(job.id, job.userId))!; first.close();
  assert.equal(checkpoint.substep, "expert1"); assert.equal(latestTranscript(checkpoint).data.turns.length, 1);
  assert.equal(Object.values(checkpoint.state.execution!.steps).find(step => step.phase === "pending")!.key, "conversation.expert1:2");
  const resumed = harness(JSON.parse(JSON.stringify(checkpoint))); resumed.tick();
  try {
    const result = await runDurableStep({ ...resumed.options, fetch: pending });
    assert.equal(result.job!.substep, "host"); assert.deepEqual(methods, ["POST", "GET"]);
    assert.deepEqual(latestTranscript(result.job!).data.turns.slice(0, 1), latestTranscript(checkpoint).data.turns);
    assert.equal(latestTranscript(result.job!).data.turns.filter(turn => turn.speaker === "expert1").length, 1);
    const hostCalls: Observed[] = [];
    const closed = await runDurableStep({ ...resumed.options, fetch: transport([() => hostAction({ action: "close", nextSpeaker: null, text: "The possible mechanism remains open." })], hostCalls) });
    assert.equal(hostCalls.length, 1); assert.equal(hostCalls[0].speaker, "host");
    assert.equal(closed.job!.stage, "editing"); assert.equal(closed.job!.state.usageLedger!.records.length, 3);
    assert.equal(latestTranscript(closed.job!).data.turns.filter(turn => turn.speaker === "expert1").length, 1);
  } finally { resumed.close(); }
});

test("an explicit clarification preserves an owed reply and queues a second addressed guest until both have responded", async () => {
  const { job } = await conversationFixture(), h = harness(job), observed: Observed[] = [];
  const outputs = [
    () => hostAction(),
    () => guestContribution("Elias, reproducing the pattern is not yet a discriminating prediction.", { speaker: "expert2" as const, reason: "The model criterion is challenged." }),
    () => hostAction({ nextSpeaker: "expert3", text: "Noor, clarify what the correction changed before Elias replies.", clarificationNeeded: true }),
    () => guestContribution("The magnitude was reduced. Mara, that also narrows the measurement your proposed test must resolve.", { speaker: "expert1" as const, reason: "The proposed measurement needs a response." }),
    () => hostAction({ action: "yield", text: null, nextSpeaker: "expert2" }),
    () => guestContribution("I accept that correction and would specify the prediction in advance."),
    () => hostAction({ action: "yield", text: null, nextSpeaker: "expert1" }),
    () => guestContribution("Then the test needs enough resolution for the corrected magnitude."),
    () => hostAction({ action: "close", nextSpeaker: null, text: "We have a clearer proposed test and an open result." }),
  ];
  const fetch = transport(outputs, observed);
  try {
    for (let index = 0; index < outputs.length; index++) {
      const result = await runDurableStep({ ...h.options, fetch });
      assert.equal(result.job!.status, "running", result.job!.pause?.reason);
      const state = latestTranscript(result.job!).data.conversation!;
      if (index === 2) { assert.equal(state.responseDue!.speaker, "expert2"); assert.equal(state.invitation!.speaker, "expert3"); }
      if (index === 3) { assert.equal(state.responseDue!.speaker, "expert2"); assert.deepEqual(state.responseQueue.map(response => response.speaker), ["expert1"]); }
      if (index === 5) { assert.equal(state.responseDue!.speaker, "expert1"); assert.deepEqual(state.responseQueue, []); }
      if (index === 7) assert.equal(state.responseDue, null);
    }
    assert.equal(observed[4].input.responseOpportunity.speaker, "expert2");
    assert.deepEqual(observed[4].input.queuedResponses.map((response: { speaker: string }) => response.speaker), ["expert1"]);
    assert.equal(observed[6].input.responseOpportunity.speaker, "expert1");
  } finally { h.close(); }
});

test("a parked contribution is refreshed against the latest exchange and returned to the host before it can be used", async () => {
  const { job } = await conversationFixture(), h = harness(job), observed: Observed[] = [];
  const outputs = [
    () => hostAction({ nextSpeaker: "expert3" }),
    () => guestContribution("Calibration should precede the comparison."),
    () => hostAction({ action: "request_contributions", text: null, nextSpeaker: null }),
    () => ({ decision: "contribute", point: "An intervention can distinguish the explanations." }),
    () => ({ decision: "pass", point: null }),
    (input: Record<string, any>) => hostAction({ action: "continue", text: "Hold that thought while we specify the comparison.", nextSpeaker: "host", requestDecisions: [{ requestId: offeredRequest(input).id, decision: "park" }] }),
    (input: Record<string, any>) => hostAction({ text: "Mara, is that intervention still the useful next point?", requestDecisions: [{ requestId: offeredRequest(input).id, decision: "accept" }] }),
    () => ({ decision: "contribute", point: "The intervention must now distinguish the explanations under the calibrated comparison." }),
    (input: Record<string, any>) => hostAction({ text: "Mara, explain the revised intervention criterion.", requestDecisions: [{ requestId: offeredRequest(input).id, decision: "accept" }] }),
    () => guestContribution("Both explanations should predict the calibrated response before the observation."),
    () => hostAction({ action: "close", text: "That gives the proposed test a concrete criterion.", nextSpeaker: null }),
  ];
  const fetch = transport(outputs, observed);
  try {
    for (let index = 0; index < outputs.length; index++) {
      const result = await runDurableStep({ ...h.options, fetch });
      assert.equal(result.job!.status, "running", result.job!.pause?.reason);
      const transcript = latestTranscript(result.job!), state = transcript.data.conversation!;
      if (index === 6) {
        assert.equal(result.job!.substep, "request_expert1"); assert.equal(state.invitation, null);
        assert.equal(state.bidRounds, 2); assert.equal(state.refreshRequestId, state.requests[0].id);
      }
      if (index === 7) {
        assert.equal(result.job!.substep, "host"); assert.equal(state.invitation, null);
        assert.equal(state.requests[0].status, "offered"); assert.equal(state.refreshRequestId, null);
        assert.match(state.requests[0].point!, /calibrated/);
        assert.equal(transcript.data.turns.filter(turn => turn.speaker === "expert1").length, 0);
      }
    }
    const final = (await h.store.read(job.id, job.userId))!;
    assert.equal(latestTranscript(final).data.conversation!.requests[0].status, "used");
    assert.equal(observed[7].speaker, "expert1"); assert.equal(observed[8].speaker, "host");
  } finally { h.close(); }
});

test("passing requests do not manufacture a debate, and the configured bid-round cap prevents further collection", async () => {
  const { job } = await conversationFixture(); job.config.limits.maxContributionRequestRounds = 1;
  const h = harness(job), observed: Observed[] = [];
  const outputs = [
    () => hostAction({ nextSpeaker: "expert3" }), () => guestContribution("Use the corrected measurement in this setting."),
    () => hostAction({ action: "request_contributions", text: null, nextSpeaker: null }),
    () => ({ decision: "pass", point: null }), () => ({ decision: "pass", point: null }),
    () => hostAction({ action: "request_contributions", text: null, nextSpeaker: null }),
  ];
  const fetch = transport(outputs, observed);
  try {
    for (let index = 0; index < 5; index++) {
      const result = await runDurableStep({ ...h.options, fetch }); assert.equal(result.job!.status, "running", result.job!.pause?.reason);
    }
    const before = (await h.store.read(job.id, job.userId))!, transcript = latestTranscript(before);
    assert.equal(before.substep, "host"); assert.equal(transcript.data.turns.length, 2);
    assert.ok(transcript.data.conversation!.requests.every(request => request.status === "passed" && request.point === null));
    assert.equal(transcript.data.conversation!.remaining.bidRounds, 0);
    const result = await runDurableStep({ ...h.options, fetch });
    assert.equal(result.job!.status, "paused"); assert.equal(result.job!.pause!.code, "needs_input");
    assert.deepEqual(latestTranscript(result.job!), transcript);
    assert.equal(observed.length, 6, "Invalid provider output may be reviewed but must not initiate any listening requests");
    const held = await runDurableStep({ ...h.options, fetch }); assert.equal(held.disposition, "waiting"); assert.equal(observed.length, 6);
  } finally { h.close(); }
});

test("private transcript snapshots survive SQLite restart through their owned blob index and retain the exact exchange", async () => {
  const { job } = await conversationFixture(), first = harness(job), bucket = memoryBucket();
  const opening = await runDurableStep({ ...first.options, bucket: bucket.storage, fetch: transport([() => hostAction()]) });
  const saved = opening.job!, reference = saved.state.execution!.steps["conversation.host:1"].resultRefs[0];
  assert.equal(saved.state.artifacts[reference.id], undefined);
  assert.deepEqual(saved.state.artifactBlobs![reference.id].artifact, reference);
  const firstSnapshot = await readArtifact(saved, reference, bucket.storage) as Transcript;
  assert.equal(firstSnapshot.data.turns[0].text, hostAction().text);
  const checkpoint = (await first.store.read(job.id, job.userId))!; first.close();
  const resumed = harness(JSON.parse(JSON.stringify(checkpoint))), observed: Observed[] = [];
  try {
    const reply = await runDurableStep({ ...resumed.options, bucket: bucket.storage,
      fetch: transport([() => guestContribution("The next observation must distinguish the explanations.")], observed) });
    assert.deepEqual(observed[0].input.acceptedTranscript.turns, firstSnapshot.data.turns);
    const secondRef = reply.job!.state.execution!.steps["conversation.expert1:2"].resultRefs[0];
    const secondSnapshot = await readArtifact(reply.job!, secondRef, bucket.storage) as Transcript;
    assert.deepEqual(secondSnapshot.data.turns.slice(0, 1), firstSnapshot.data.turns);
    assert.equal(reply.job!.substep, "host"); assert.equal(reply.job!.state.artifacts[secondRef.id], undefined);
    const closed = await runDurableStep({ ...resumed.options, bucket: bucket.storage,
      fetch: transport([() => hostAction({ action: "close", text: "That test remains an open question.", nextSpeaker: null })]) });
    assert.equal(closed.job!.stage, "editing"); assert.equal(bucket.objects.size, 3);
    assert.ok(bucket.metadata.every(metadata => metadata.contentType === "application/json" && metadata.cacheControl === "private, no-store"));
    assert.deepEqual(await readArtifact(closed.job!, reference, bucket.storage), firstSnapshot);
    assert.ok(Object.keys(closed.job!.state.artifactBlobs!).every(id => closed.job!.state.artifacts[id] === undefined));
  } finally { resumed.close(); }
});

test("turn, time and provider-operation limits ask the host to close while preserving all previously accepted speech", async () => {
  for (const limit of ["turns", "operations", "time"] as const) {
    const { job } = await conversationFixture();
    if (limit === "turns") job.config.limits.maxConversationTurns = 2;
    if (limit === "operations") { job.config.limits.maxProviderOperations = 1; job.state.usageLedger!.maxOperations = 1; }
    const h = harness(job), observed: Observed[] = [];
    try {
      let previousTurns: Transcript["data"]["turns"] = [];
      if (limit === "time") {
        const first = await runDurableStep({ ...h.options, fetch: transport([() => hostAction({ action: "continue", nextSpeaker: "host", text: Array(680).fill("observation").join(" ") })]) });
        assert.equal(first.job!.status, "running");
        previousTurns = structuredClone(latestTranscript(first.job!).data.turns);
      }
      const result = await runDurableStep({ ...h.options,
        fetch: transport([() => hostAction({ action: "close", text: "The supported observation leaves the mechanism open.", nextSpeaker: null })], observed) });
      assert.equal(observed.length, 1); assert.equal(observed[0].input.conversationConstraints.closeNow, true, limit);
      assert.equal(observed[0].input.conversationConstraints.contributionRequestsAllowed, false);
      if (limit === "time") assert.ok(observed[0].input.conversationConstraints.remaining.approximateSeconds <= 20);
      assert.equal(result.job!.stage, "editing");
      assert.deepEqual(latestTranscript(result.job!).data.turns.slice(0, previousTurns.length), previousTurns);
      assert.ok(latestTranscript(result.job!).data.turns.length <= result.job!.config.limits.maxConversationTurns);
    } finally { h.close(); }
  }
});

test("an exhausted text allowance pauses before an invited guest is called and preserves the exact next speaker", async () => {
  const { job } = await conversationFixture(), initial = harness(job);
  await runDurableStep({ ...initial.options, fetch: transport([() => hostAction()]) });
  const checkpoint = (await initial.store.read(job.id, job.userId))!; initial.close();
  const transcript = structuredClone(latestTranscript(checkpoint));
  checkpoint.state.usageLedger!.allocations.text = checkpoint.state.usageLedger!.records.reduce((sum, record) => sum + (record.bucket === "text" ? record.allowanceUsd : 0), 0);
  const resumed = harness(checkpoint); let calls = 0;
  const fetch: typeof globalThis.fetch = async () => { calls++; throw new Error("An exhausted allowance must not make a provider request"); };
  try {
    const result = await runDurableStep({ ...resumed.options, fetch });
    assert.equal(calls, 0); assert.equal(result.job!.status, "paused"); assert.equal(result.job!.pause!.code, "budget");
    assert.equal(result.job!.stage, "conversation"); assert.equal(result.job!.substep, "expert1");
    assert.deepEqual(latestTranscript(result.job!), transcript);
    assert.equal(result.job!.state.usageLedger!.records.length, 1);
    assert.equal(Object.keys(result.job!.state.execution!.steps).length, 1);
    const held = await runDurableStep({ ...resumed.options, fetch });
    assert.equal(held.disposition, "waiting"); assert.equal(calls, 0);
  } finally { resumed.close(); }
});
