import test from "node:test";
import assert from "node:assert/strict";
import { audioHarness, audioFixture, fakeMp3 } from "./fixtures/audio.ts";
import { routeEnv, routeRequest as request, routeContext as context } from "./fixtures/route-harness.ts";
import "./fixtures/route-loader.mjs";
const control = await import("../app/api/episodes/[id]/control/route.ts");
const advance = await import("../app/api/episodes/[id]/advance/route.ts");
const audio = await import("../app/api/episodes/[id]/audio/route.ts");
const episode = await import("../app/api/episodes/[id]/route.ts");
const episodes = await import("../app/api/episodes/route.ts");
const capabilities = await import("../app/api/capabilities/route.ts");
const path = "/api/episodes/audio-test";
function enabled(h: ReturnType<typeof audioHarness>) {
  const snapshot = JSON.parse(h.env.V2_AUDIO_PRICE_SNAPSHOT!); snapshot.checkedAt = Date.now();
  Object.assign(routeEnv, h.env, { V2_AUDIO_PRICE_SNAPSHOT: JSON.stringify(snapshot) });
}
const post = (body: unknown, options = {}) => control.POST(request(`${path}/control`, { body, ...options }), context("audio-test"));
const tick = () => advance.POST(request(`${path}/advance`, { method: "POST" }), context("audio-test"));
test("audio controls enforce owner, origin, strict payload, provider gate and existing episode cap", async () => {
  const h = audioHarness(), original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("Authorization must not call a provider"); };
  try {
    enabled(h);
    assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 1.49 }, { user: null })).status, 401);
    assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 1.49 }, { user: "other-owner" })).status, 404);
    assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 1.49 }, { origin: "https://other.test" })).status, 403);
    assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 1.49, usdPer1kCharacters: 0.0001 })).status, 400);
    assert.equal((await post({ action: "accept_audition", audioAllowanceUsd: 1.49 })).status, 400);
    assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 5.01 })).status, 409);
    routeEnv.V2_AUDIO_ENABLED = "false";
    assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 1.49, auditionFirst: true })).status, 409);
    routeEnv.V2_AUDIO_ENABLED = "true";
    const reply = await post({ action: "authorize_audio", audioAllowanceUsd: 1.49, auditionFirst: true }); assert.equal(reply.status, 200);
    const visible = await reply.json() as any;
    assert.equal(visible.stage, "tts"); assert.equal(visible.textOnly, false); assert.equal(visible.audioProgress.allowanceUsd, 1.49);
    assert.equal(calls, 0); assert.equal(h.job("audio-test").config.limits.spendCeilingUsd, 5);
    for (const privateField of ["voice-host", "offline-fixture-only", "usdPer1kCharacters", "scriptHash", "planHash"]) assert.equal(JSON.stringify(visible).includes(privateField), false);
    assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 1.49, auditionFirst: true })).status, 409);
  } finally { globalThis.fetch = original; h.close(); }
});

test("app defaults to the fixed five-dollar cap and client requests cannot raise it or bypass its workflow", async () => {
  const h = audioHarness(), original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No paid call expected'); };
  try {
    enabled(h);
    const body = { topic: 'An episode with no visible limits', lengthMinutes: 15, pipelineVersion: 2, textOnly: false, auditionFirst: false };
    for (const spendCeilingUsd of [5.01, 10, 1000]) assert.equal((await episodes.POST(request('/api/episodes', { body: { ...body, spendCeilingUsd } }))).status, 400);
    assert.equal((await episodes.POST(request('/api/episodes', { body: { topic: 'No unbounded legacy generation', lengthMinutes: 5 } }))).status, 400);
    const response = await episodes.POST(request('/api/episodes', { body })); assert.equal(response.status, 201); const id = (await response.json() as any).id;
    const job = h.job(id); assert.equal(job.config.limits.spendCeilingUsd, 5); assert.equal(job.state.usageLedger.spendCeilingUsd, 5); assert.equal(job.state.usageLedger.allocations.audio, 1.5);
    job.status = 'paused'; job.pause = { code: 'budget', reason: 'Authored hold' }; h.update(job);
    assert.equal((await control.POST(request(`/api/episodes/${id}/control`, { body: { action: 'set_budget', spendCeilingUsd: 5.01 } }), context(id))).status, 409);
    assert.equal(h.job(id).config.limits.spendCeilingUsd, 5); assert.equal(calls, 0);
    // Older larger authorizations cannot initiate new paid work; cancellation is still local and available.
    job.config.limits.spendCeilingUsd = 100; job.state.usageLedger.spendCeilingUsd = 100; job.status = 'running'; delete job.pause; h.update(job);
    assert.equal((await advance.POST(request(`/api/episodes/${id}/advance`, { method: 'POST' }), context(id))).status, 409); assert.equal(calls, 0);
    assert.equal((await control.POST(request(`/api/episodes/${id}/control`, { body: { action: 'cancel' } }), context(id))).status, 200);
  } finally { globalThis.fetch = original; h.close(); }
});

test("existing reviewed text can start audio with a server-selected allowance and no visible amount", async () => {
  const h = audioHarness(), original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Authorization cannot synthesize'); };
  try {
    enabled(h); const response = await post({ action: 'authorize_audio', auditionFirst: false }); assert.equal(response.status, 200);
    const plan = h.job('audio-test').state.audioPipeline;
    assert.equal(plan.allowanceUsd, 1.5); assert.equal(plan.current.mode, 'full'); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; h.close(); }
});

test("15-minute app creation reserves audio, advances reviewed text to full recording, and serves private playback with optional preview", async () => {
  for (const auditionFirst of [false, true]) {
    const h = audioHarness(), original = globalThis.fetch; let posts = 0;
    globalThis.fetch = async (_url, init) => { assert.equal(init?.method, "POST"); posts++; return new Response(fakeMp3(225), { headers: { "request-id": `req-${posts}`, "character-cost": "20" } }); };
    try {
      enabled(h);
      const capability = await (await capabilities.GET(request('/api/capabilities'))).json() as any;
      assert.deepEqual(capability.supported_lengths, [5, 15]); assert.equal(capability.podcast_generation, true);
      const created = await episodes.POST(request('/api/episodes', { body: { topic: 'Authored fifteen-minute route fixture', lengthMinutes: 15,
        pipelineVersion: 2, textOnly: false, spendCeilingUsd: 5, audioAllowanceUsd: 1.5, auditionFirst } }));
      assert.equal(created.status, 201); const visible = await created.json() as any, id = visible.id, initial = h.job(id);
      assert.equal(initial.config.targetDurationSeconds, 900); assert.equal(initial.textOnly, undefined);
      assert.deepEqual(initial.requestedAudio, { allowanceUsd: 1.5, auditionFirst });
      assert.deepEqual(initial.state.usageLedger.allocations, { research: 1.225, text: 1.575, review: 0.7, audio: 1.5 });
      assert.equal(posts, 0, 'Creating a job only records authorization');
      // The existing text-route suite covers production/research/review. Supply its accepted checkpoint here to exercise the audio hand-off.
      const checkpoint = audioFixture(15); checkpoint.id = id; delete checkpoint.textOnly;
      checkpoint.requestedAudio = initial.requestedAudio; checkpoint.state.usageLedger = initial.state.usageLedger; h.update(checkpoint);
      const advanceId = () => advance.POST(request(`/api/episodes/${id}/advance`, { method: 'POST' }), context(id));
      assert.equal((await advanceId()).status, 200); assert.equal(posts, 0);
      let job = h.job(id); assert.equal(job.stage, 'tts'); assert.equal(job.state.audioPipeline.current.mode, auditionFirst ? 'audition' : 'full');
      assert.equal(!!job.state.audioPipeline.current.auditionWaivedAt, !auditionFirst);
      for (let count = 0; count < 10 && h.job(id).status === 'running'; count++) assert.equal((await advanceId()).status, 200);
      if (auditionFirst) {
        assert.equal(h.job(id).pause.code, 'audio_audition'); assert.equal(posts, 2);
        assert.equal((await control.POST(request(`/api/episodes/${id}/control`, { body: { action: 'accept_audition' } }), context(id))).status, 200);
        for (let count = 0; count < 10 && h.job(id).status === 'running'; count++) assert.equal((await advanceId()).status, 200);
      }
      job = h.job(id); assert.equal(job.status, 'ready', job.pause?.reason); assert.equal(posts, 4);
      assert.equal(job.config.limits.spendCeilingUsd, 5); assert.equal(job.state.audioPipeline.allowanceUsd, 1.5);
      assert.ok(job.audio.durationSeconds >= 900 && job.audio.durationSeconds < 901);
      assert.equal((await audio.GET(request(`/api/episodes/${id}/audio`, { headers: { range: 'bytes=100-199' } }), context(id))).status, 206);
      assert.equal((await audio.GET(request(`/api/episodes/${id}/audio`, { user: 'other-owner' }), context(id))).status, 404);
      assert.equal((await advanceId()).status, 200); assert.equal(posts, 4, 'A ready episode never regenerates');
    } finally { globalThis.fetch = original; h.close(); }
  }
});

test("complete episodes preserve audio reserves when saved without a budget and later started", async () => {
  const h = audioHarness(), original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No provider operation permitted'); };
  try {
    enabled(h);
    const body = { topic: 'Saved full episode', lengthMinutes: 15, pipelineVersion: 2, textOnly: false, spendCeilingUsd: null, audioAllowanceUsd: 1.5 };
    routeEnv.V2_AUDIO_ENABLED = 'false'; assert.equal((await episodes.POST(request('/api/episodes', { body }))).status, 503); routeEnv.V2_AUDIO_ENABLED = 'true';
    const reply = await episodes.POST(request('/api/episodes', { body })); assert.equal(reply.status, 201); const id = (await reply.json() as any).id;
    assert.equal(h.job(id).pause.code, 'budget'); assert.equal(h.job(id).state.usageLedger.allocations.audio, 0);
    const budget = (spendCeilingUsd: number) => control.POST(request(`/api/episodes/${id}/control`, { body: { action: 'set_budget', spendCeilingUsd } }), context(id));
    assert.equal((await budget(1.5)).status, 409); assert.equal(h.job(id).status, 'paused');
    assert.equal((await budget(5)).status, 200); assert.equal(h.job(id).state.usageLedger.allocations.audio, 1.5); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; h.close(); }
});
test("real V2 advance routes create a private seekable audition and reuse it for full playback", async () => {
  const h = audioHarness(), original = globalThis.fetch; let posts = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, "POST"); posts++;
    return new Response(fakeMp3(75), { headers: { "request-id": `req-${posts}`, "content-type": "audio/mpeg" } });
  };
  try {
    enabled(h); assert.equal((await post({ action: "authorize_audio", audioAllowanceUsd: 1.49, auditionFirst: true })).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await tick()).status, 200);
    const visible = await (await episode.GET(request(path), context("audio-test"))).json() as any;
    assert.equal(visible.pause.code, "audio_audition"); assert.equal(visible.actions.acceptAudition, true); assert.equal(posts, 2);
    assert.ok(visible.auditionDurationSeconds >= 150 && visible.auditionDurationSeconds < 151);
    assert.equal((await audio.GET(request(`${path}/audio`), context("audio-test"))).status, 404);
    const preview = `${path}/audio?preview=audition`;
    assert.equal((await audio.GET(request(preview, { user: null }), context("audio-test"))).status, 401);
    assert.equal((await audio.GET(request(preview, { user: "other-owner" }), context("audio-test"))).status, 404);
    const fullPreview = await audio.GET(request(preview), context("audio-test")); assert.equal(fullPreview.status, 200);
    assert.equal(fullPreview.headers.get("cache-control"), "private, no-store"); assert.ok(Number(fullPreview.headers.get("content-length")) > 100);
    const range = await audio.GET(request(preview, { headers: { range: "bytes=0-63" } }), context("audio-test"));
    assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 64);
    assert.equal((await audio.GET(request(preview, { headers: { range: "bytes=-32" } }), context("audio-test"))).status, 206);
    assert.equal((await audio.GET(request(preview, { headers: { range: "bytes=999999999-" } }), context("audio-test"))).status, 416);
    assert.equal((await post({ action: "accept_audition" })).status, 200);
    for (let i = 0; i < 3; i++) assert.equal((await tick()).status, 200);
    const ready = h.job("audio-test"); assert.equal(ready.status, "ready"); assert.equal(posts, 4);
    const response = await audio.GET(request(`${path}/audio`, { headers: { range: "bytes=100-199" } }), context("audio-test"));
    assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 100);
    assert.equal((await tick()).status, 200); assert.equal(posts, 4, "Ready jobs cannot trigger more generation");
    ready.state.artifacts.final_script.data.turns[0].text += " Changed after rendering."; h.update(ready);
    assert.equal((await audio.GET(request(`${path}/audio`), context("audio-test"))).status, 409, "Changed text cannot play stale audio");
    assert.equal((await audio.GET(request(preview), context("audio-test"))).status, 409);
  } finally { globalThis.fetch = original; h.close(); }
});
