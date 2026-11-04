import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { advanceAudio, applyAudioControl, audioActions, audioConfiguration, authorizeAudio, chunkReservation, createAudioPlan, planReservation } from "../lib/episode-v2/audio.ts";
import { audioHeldUsd } from "../lib/episode-v2/audio-state.ts";
import { episodeV2JobSchema } from "../lib/episode-v2/contracts.ts";
import { applyTextPilotControl, textPilotActions } from "../lib/episode-v2/app-controls.ts";
import { audioAt, audioFixture, audioHarness, fakeMp3 } from "./fixtures/audio.ts";

async function authorize(h: ReturnType<typeof audioHarness>, allowance = 1.49) {
  const lease = await h.store.claim("audio-test", "route-owner"); assert.ok(lease);
  const next = await authorizeAudio(lease.job, h.env, allowance, h.now()); await h.store.save(lease, next); await h.store.release(lease);
  return next;
}
function audioTransport(seconds: number, observed: { method: string; url: string; body?: any }[] = []): typeof fetch {
  return async (url, init) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    observed.push({ method: init?.method ?? "GET", url: String(url), body });
    return new Response(fakeMp3(seconds), { headers: { "content-type": "audio/mpeg", "request-id": `req-${observed.length}`, "history-item-id": `history-${observed.length}`,
      "character-cost": String(body?.inputs.reduce((sum: number, input: any) => sum + input.text.length, 0) ?? 0) } });
  };
}
async function runToPause(h: ReturnType<typeof audioHarness>, fetch: typeof globalThis.fetch) {
  for (let step = 0; step < 30; step++) { const result = await advanceAudio({ ...h.options, fetch }); if (result.job?.status !== "running") return result.job!; }
  throw new Error("Audio did not reach a bounded checkpoint");
}
test("authorization pins exact accepted text and all four voices, reserves context, and never calls a provider", async () => {
  const h = audioHarness();
  try {
    const before = h.job("audio-test"), authorized = await authorize(h), plan = authorized.state.audioPipeline!.current!;
    assert.equal(plan.auditionChunkCount, 2); assert.equal(plan.chunks.length, 4);
    assert.equal(authorized.stage, "tts"); assert.equal(authorized.textOnly, undefined);
    assert.deepEqual(before.state.artifacts, authorized.state.artifacts);
    assert.deepEqual(plan.chunks.flatMap(chunk => chunk.inputs), before.state.artifacts.final_script.data.turns.map((turn: any) => ({ turnId: turn.id, speaker: turn.speaker, text: turn.text })));
    assert.equal(plan.records.length, 0); assert.equal(audioHeldUsd(authorized.state.audioPipeline), 0);
    assert.ok(planReservation(plan) > plan.chunks.reduce((sum, chunk) => sum + chunk.characters, 0) * 0.08 / 1000);
    assert.equal(authorized.state.usageLedger!.allocations.audio, 1.49);
    assert.equal(authorized.config.limits.spendCeilingUsd, 5);
  } finally { h.close(); }
});
test("four-voice audition pauses, full acceptance reuses its clips, and five/fifteen-minute assembly follows the selected range", async () => {
  for (const length of [5, 15] as const) {
    const h = audioHarness(audioFixture(length)), observed: { method: string; url: string; body?: any }[] = [];
    try {
      const authorized = await authorize(h), plan = authorized.state.audioPipeline!.current!, transport = audioTransport(length * 60 / plan.chunks.length, observed);
      const audition = await runToPause(h, transport);
      assert.equal(audition.pause!.code, "audio_audition"); assert.ok(audition.state.audioPipeline!.current!.audition);
      assert.equal(audition.audioKey, undefined); assert.equal(observed.length, 2);
      assert.equal((await advanceAudio({ ...h.options, fetch: transport })).disposition, "waiting"); assert.equal(observed.length, 2);
      assert.equal(new Set(observed.flatMap(call => call.body.inputs.map((input: any) => input.voice_id))).size, 4);
      assert.deepEqual(observed[1].body.previous_request_ids, ["req-1"]); assert.equal(observed[1].body.previous_text, undefined);
      const lease = await h.store.claim("audio-test", "route-owner"); assert.ok(lease);
      await h.store.save(lease, applyAudioControl(lease.job, "accept_audition", h.now())); await h.store.release(lease);
      const ready = await runToPause(h, transport), output = ready.state.audioPipeline!.current!.output!;
      assert.equal(ready.status, "ready", ready.pause?.reason); assert.equal(ready.stage, "ready");
      assert.equal(observed.length, 4, "Audition sections must never be purchased twice");
      assert.ok(output.durationSeconds >= length * 60 && output.durationSeconds < length * 60 + 1);
      assert.equal(ready.audioKey, output.key); assert.equal(ready.state.audioPipeline!.current!.records.length, 4);
      assert.ok(ready.state.audioPipeline!.current!.records.every(record => record.billedUsd === null));
      const allText = observed.flatMap(call => call.body.inputs).map(input => input.text).join("");
      assert.equal(allText, (ready.state.artifacts.final_script as any).data.turns.map((turn: any) => turn.text).join(""));
    } finally { h.close(); }
  }
});
test("mismatched script, review, voices, model, chunk plan and corrupted clip stop before another paid call", async () => {
  for (const change of ["script", "review", "voices", "model", "chunk", "clip"]) {
    const h = audioHarness(); let calls = 0;
    try {
      await authorize(h);
      if (change === "clip") {
        await advanceAudio({ ...h.options, fetch: audioTransport(75) });
        const clip = h.job("audio-test").state.audioPipeline.current.records[0].clip;
        await h.BUCKET.put(clip.key, new Uint8Array(clip.bytes));
      }
      const job = h.job("audio-test");
      if (change === "script") job.state.artifacts.final_script.data.turns[0].text += " Altered.";
      if (change === "review") {
        job.state.artifacts.edit_report.version = 2; job.state.artifacts.review.version = 2;
        job.state.artifacts.review.data.editReport.version = 2; job.state.artifacts.final_script.data.editReport.version = 2;
        job.state.artifacts.final_script.data.review.version = 2;
      }
      if (change === "voices") h.env.ELEVEN_VOICE_EXPERT1 = "changed-voice";
      if (change === "model") h.env.ELEVEN_DIALOGUE_MODEL = "eleven_v3";
      if (change === "chunk") job.state.audioPipeline.current.chunks[0].inputs[0].text += " Altered.";
      h.update(job);
      const result = await advanceAudio({ ...h.options, fetch: async () => { calls++; throw new Error("Must not synthesize"); } });
      assert.equal(calls, 0, change); assert.equal(result.job!.status, "paused", change);
    } finally { h.close(); }
  }
});
test("a persisted reservation whose POST outcome is unknown never resynthesizes, even after resume", async () => {
  const h = audioHarness(); let calls = 0;
  try {
    await authorize(h);
    const transport: typeof fetch = async () => { calls++; throw new Error("Connection lost after submission"); };
    await advanceAudio({ ...h.options, fetch: transport });
    assert.equal(h.job("audio-test").state.audioPipeline.current.records[0].phase, "submitted");
    const held = await advanceAudio({ ...h.options, fetch: transport });
    assert.equal(held.job!.pause!.code, "ambiguous_provider_result"); assert.equal(calls, 1);
    assert.equal(textPilotActions(held.job!).resume, false); assert.equal(audioActions(held.job!).invalidateAudio, false);
    assert.throws(() => applyAudioControl(held.job!, "invalidate_audio"));
    await advanceAudio({ ...h.options, fetch: transport }); assert.equal(calls, 1);
    assert.ok(audioHeldUsd(held.job!.state.audioPipeline) > 0);
  } finally { h.close(); }
});
test("saved history identifier recovers a missing body using GET only, not a second POST", async () => {
  const h = audioHarness(), observed: string[] = [];
  try {
    await authorize(h);
    const first: typeof fetch = async (_url, init) => {
      observed.push(init?.method ?? "GET");
      return new Response(new ReadableStream({ start(controller) { controller.error(new Error("Lost body")); } }),
        { headers: { "request-id": "req-a", "history-item-id": "history-a", "character-cost": "200" } });
    };
    await advanceAudio({ ...h.options, fetch: first });
    const record = h.job("audio-test").state.audioPipeline.current.records[0]; assert.equal(record.phase, "received"); assert.equal(record.historyItemId, "history-a");
    await advanceAudio({ ...h.options, fetch: async (url, init) => {
      observed.push(init?.method ?? "GET"); assert.match(String(url), /\/history\/history-a\/audio$/); return new Response(fakeMp3(75));
    } });
    assert.deepEqual(observed, ["POST", "GET"]); assert.equal(h.job("audio-test").state.audioPipeline.current.records[0].phase, "completed");
  } finally { h.close(); }
});
test("a stored clip receipt survives a lost D1 acknowledgement and is reused with no network request", async () => {
  const h = audioHarness();
  try {
    await authorize(h); const save = h.store.save.bind(h.store);
    h.store.save = async (lease, job) => { if (job.state.audioPipeline?.current?.records[0]?.phase === "completed") throw new Error("Storage acknowledgement lost"); return save(lease, job); };
    await advanceAudio({ ...h.options, fetch: audioTransport(75) });
    h.store.save = save;
    assert.equal(h.job("audio-test").state.audioPipeline.current.records[0].phase, "received");
    await advanceAudio({ ...h.options, fetch: async () => { throw new Error("Recovery must not call a provider"); } });
    assert.equal(h.job("audio-test").state.audioPipeline.current.records[0].phase, "completed");
  } finally { h.close(); }
});
test("budget, character cap, provider readiness and all-four-speaker requirements fail closed", async () => {
  const h = audioHarness();
  try {
    await assert.rejects(() => authorizeAudio(audioFixture(), h.env, 0.01, audioAt), /allowance/);
    await assert.rejects(() => authorizeAudio(audioFixture(), h.env, 5.01, audioAt), /spending limit/);
    await assert.rejects(() => authorizeAudio(audioFixture(), h.env, 1.495, audioAt), /whole cents/);
    const limited = audioFixture(); limited.config.limits.maxProviderOperations = 3; limited.state.usageLedger!.maxOperations = 3;
    await assert.rejects(() => authorizeAudio(limited, h.env, 1.49, audioAt), /operation allowance/);
    assert.throws(() => audioConfiguration({ ...h.env, V2_AUDIO_ENABLED: "false" }, audioAt), /not enabled/);
    assert.throws(() => audioConfiguration({ ...h.env, V2_AUDIO_PRICE_SNAPSHOT: "{}" }, audioAt), /price snapshot/);
    assert.throws(() => audioConfiguration(h.env, audioAt + 31 * 86_400_000), /current/);
    const long = audioFixture(); long.config.audio.maxCharacters = 250;
    await assert.rejects(() => createAudioPlan(long, h.env, audioAt), /character allowance/);
    const absent = audioFixture(); (absent.state.artifacts.final_script as any).data.turns = (absent.state.artifacts.final_script as any).data.turns.filter((turn: any) => turn.speaker !== "expert3");
    (absent.state.artifacts.edit_report as any).data.editedTurns = (absent.state.artifacts.final_script as any).data.turns;
    await assert.rejects(() => createAudioPlan(absent, h.env, audioAt), /four speakers/);
    const approved = await authorize(h); approved.status = "paused"; approved.pause = { code: "budget", reason: "Test" };
    assert.equal(textPilotActions(approved).setBudget, false);
    assert.throws(() => applyTextPilotControl(approved, { action: "set_budget", spendCeilingUsd: 6 }));
    approved.state.audioPipeline!.allowanceUsd = 6; assert.equal(episodeV2JobSchema.safeParse(approved).success, false);
  } finally { h.close(); }
});
test("explicit invalidation keeps incurred reservations and requires a new authorization", async () => {
  const h = audioHarness();
  try {
    await authorize(h); await advanceAudio({ ...h.options, fetch: audioTransport(75) });
    const paused = applyTextPilotControl(h.job("audio-test"), { action: "pause" }), before = audioHeldUsd(paused.state.audioPipeline);
    const invalidated = applyAudioControl(paused, "invalidate_audio");
    assert.equal(invalidated.pause!.code, "text_checkpoint"); assert.equal(invalidated.state.audioPipeline!.current, undefined);
    assert.equal(invalidated.state.audioPipeline!.invalidated.length, 1); assert.equal(audioHeldUsd(invalidated.state.audioPipeline), before);
    const resumed = await authorizeAudio(invalidated, h.env, 1.49, audioAt);
    assert.equal(audioHeldUsd(resumed.state.audioPipeline), before); assert.ok(resumed.state.audioPipeline!.current);
    assert.notEqual(resumed.state.audioPipeline!.current!.generationId, invalidated.state.audioPipeline!.invalidated[0].generationId, "A newly authorized render cannot overwrite invalidated clips or receipts");
  } finally { h.close(); }
});
test("an out-of-range assembled episode is held, not padded or automatically regenerated", async () => {
  const h = audioHarness(); let calls = 0;
  try {
    await authorize(h); const transport = audioTransport(1);
    const audition = await runToPause(h, transport), lease = await h.store.claim("audio-test", "route-owner"); assert.ok(lease);
    await h.store.save(lease, applyAudioControl(audition, "accept_audition", audioAt)); await h.store.release(lease);
    const held = await runToPause(h, async (url, init) => { calls++; return transport(url, init); });
    assert.equal(held.pause!.code, "needs_input"); assert.match(held.pause!.reason, /duration/); assert.equal(calls, 2);
    assert.equal(held.audioKey, undefined); assert.equal(held.state.audioPipeline!.current!.records.length, 4);
  } finally { h.close(); }
});
test("the accepted pharmaceutical pilot produces an exact bounded plan without new research or synthesis", async () => {
  const job = episodeV2JobSchema.parse(JSON.parse(readFileSync(new URL("../docs/pilots/pharma-process-15m-02/job.json", import.meta.url), "utf8"))), h = audioHarness();
  try {
    const plan = await createAudioPlan(job, h.env, audioAt);
    assert.equal(plan.scriptHash, "bc20ca560ad6db45d3a7a1220fe6f7c389fbb055671abc04aada0191d0d18811");
    assert.equal(plan.chunks.reduce((sum, chunk) => sum + chunk.characters, 0), 13724);
    assert.ok(plan.chunks.every(chunk => chunk.characters <= 1800)); assert.ok(planReservation(plan) < 1.49);
    assert.deepEqual(plan.durationSeconds, { min: 720, max: 1170 });
    assert.ok(plan.chunks.slice(0, plan.auditionChunkCount).reduce((sum, chunk) => sum + chunkReservation(plan, chunk), 0) < 1.49);
    const proposed = await authorizeAudio(job, h.env, 1.49, audioAt);
    assert.equal(proposed.config.limits.spendCeilingUsd, 3.19); assert.equal(proposed.state.usageLedger!.allocations.audio, 1.49);
  } finally { h.close(); }
});

test("definitive provider rejections and ambiguous server errors retain their reservations and never auto-retry", async () => {
  for (const status of [401, 402, 422, 429, 500]) {
    const h = audioHarness(); let calls = 0;
    try {
      await authorize(h);
      const transport: typeof fetch = async () => { calls++; return new Response('private provider diagnostic must not escape', { status }); };
      const held = await advanceAudio({ ...h.options, fetch: transport });
      assert.equal(held.job!.status, "paused"); assert.equal(calls, 1);
      assert.equal(JSON.stringify(held.job).includes('private provider diagnostic'), false);
      assert.ok(audioHeldUsd(held.job!.state.audioPipeline) > 0);
      await advanceAudio({ ...h.options, fetch: transport }); assert.equal(calls, 1);
    } finally { h.close(); }
  }
});
test("concurrent advances cannot submit two copies and lease expiry preserves an unknown request", async () => {
  const h = audioHarness(); let calls = 0, release!: () => void, started!: () => void;
  const submitted = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  try {
    await authorize(h);
    const first = advanceAudio({ ...h.options, fetch: async () => { calls++; started(); await gate; return new Response(fakeMp3(75)); } });
    await submitted;
    assert.equal((await advanceAudio({ ...h.options, fetch: async () => { calls++; throw new Error('Duplicate'); } })).disposition, "busy");
    h.tick(5 * 60_000 + 1); release();
    assert.equal((await first).disposition, "stale");
    const held = await advanceAudio({ ...h.options, fetch: async () => { calls++; throw new Error('Duplicate after expiry'); } });
    assert.equal(held.job!.pause!.code, "ambiguous_provider_result"); assert.equal(calls, 1);
  } finally { release?.(); h.close(); }
});
test("a reported charge above its pinned bound halts after saving the clip, with no follow-on synthesis", async () => {
  const h = audioHarness(); let calls = 0;
  try {
    await authorize(h);
    const transport: typeof fetch = async () => { calls++; return new Response(fakeMp3(75), { headers: { 'x-character-count': '99999' } }); };
    const held = await advanceAudio({ ...h.options, fetch: transport });
    assert.equal(held.job!.pause!.code, 'needs_input'); assert.match(held.job!.pause!.reason, /charged characters/);
    const record = held.job!.state.audioPipeline!.current!.records[0];
    assert.equal(record.phase, 'completed'); assert.ok(record.clip); assert.equal(record.chargedCharacters, 99999); assert.equal(record.billedUsd, null);
    await advanceAudio({ ...h.options, fetch: transport }); assert.equal(calls, 1);
  } finally { h.close(); }
});

test("discounted provider character-cost stays separate from spoken characters and API dollars", async () => {
  const h = audioHarness();
  try {
    await authorize(h);
    const result = await advanceAudio({ ...h.options, fetch: async () => new Response(fakeMp3(75), { headers: { 'character-cost': '389' } }) });
    const record = result.job!.state.audioPipeline!.current!.records[0];
    assert.equal(record.phase, 'completed'); assert.equal(record.providerCharacterCost, 389);
    assert.equal(record.chargedCharacters, null); assert.equal(record.reportedCostUsd, null); assert.equal(record.billedUsd, null);
    assert.ok(record.reservedUsd > 0); assert.equal(audioHeldUsd(result.job!.state.audioPipeline), record.reservedUsd);
  } finally { h.close(); }
});

test("old continuity request IDs fall back to bounded adjacent text without changing spoken inputs", async () => {
  const h = audioHarness(), calls: { method: string; url: string; body?: any }[] = [];
  try {
    await authorize(h); const transport = audioTransport(75, calls);
    await advanceAudio({ ...h.options, fetch: transport }); h.tick(2 * 60 * 60_000 + 1);
    await advanceAudio({ ...h.options, fetch: transport });
    const plan = h.job('audio-test').state.audioPipeline.current;
    assert.equal(calls[1].body.previous_request_ids, undefined);
    assert.equal(calls[1].body.previous_text, plan.chunks[1].previousText);
    assert.equal(calls[1].body.future_text, plan.chunks[1].futureText);
    assert.ok(calls[1].body.previous_text.length <= 100); assert.ok(calls[1].body.future_text.length <= 100);
    assert.deepEqual(calls[1].body.inputs.map((input: any) => input.text), plan.chunks[1].inputs.map((input: any) => input.text));
  } finally { h.close(); }
});
