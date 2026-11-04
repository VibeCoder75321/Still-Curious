import test from "node:test";
import assert from "node:assert/strict";
import { buildDialogueChunks } from "../lib/dialogue.ts";
import { advanceJob } from "../lib/episode-service.ts";
import { concatenateMp3, validateMp3 } from "../lib/mp3.ts";

const dialogue = [
  { id: "t1", speaker: "host", text: "Welcome. " },
  { id: "t2", speaker: "expert1", text: "First, notice the pattern. " },
  { id: "t3", speaker: "expert2", text: "History gives us another view. " },
  { id: "t4", speaker: "expert3", text: "The numbers support that reading. " },
  { id: "t5", speaker: "host", text: "Let's hold both ideas together." },
] as const;

test("dialogue chunks retain every speaker and whole turn while carrying text-only prosody context", () => {
  const chunks = buildDialogueChunks([...dialogue], 60);

  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.characters <= 60 && chunk.characters < 2000));
  assert.deepEqual(chunks.flatMap(chunk => chunk.inputs.map(input => input.turnId)), dialogue.map(turn => turn.id));
  assert.deepEqual(chunks.flatMap(chunk => chunk.inputs.map(input => input.speaker)), dialogue.map(turn => turn.speaker));
  assert.equal(chunks[0].previousText, "");
  assert.equal(chunks.at(-1)?.futureText, "");

  for (let i = 0; i < chunks.length; i++) {
    const priorText = chunks.slice(0, i).flatMap(chunk => chunk.inputs.map(input => input.text)).join(" ");
    const laterText = chunks.slice(i + 1).flatMap(chunk => chunk.inputs.map(input => input.text)).join(" ");
    assert.equal(chunks[i].previousText, priorText.slice(-100));
    assert.equal(chunks[i].futureText, laterText.slice(0, 100));
    assert.ok(chunks[i].previousText.length <= 100 && chunks[i].futureText.length <= 100);
    assert.ok(!/[\[\]<>]/.test(chunks[i].previousText + chunks[i].futureText), "context contains ordinary script text, not audio tags");
  }
});

test("oversize turns split at readable boundaries without changing spoken text or order", () => {
  const text = "A clear first sentence. Then a careful explanation with several ordinary words, followed by a short ending.";
  const chunks = buildDialogueChunks([{ id: "long", speaker: "expert2", text }], 28);
  const slices = chunks.flatMap(chunk => chunk.inputs);

  assert.ok(slices.length > 1);
  assert.ok(slices.every(slice => slice.text.length <= 28 && slice.text.trim().length > 0));
  assert.ok(slices.every(slice => slice.turnId === "long" && slice.speaker === "expert2"));
  assert.equal(slices.map(slice => slice.text).join(""), text);
  assert.deepEqual(chunks.flatMap(chunk => chunk.turnIds), Array(chunks.length).fill("long"));
});

test("an exact limit produces one nonempty chunk and adjacent turns may fill it exactly", () => {
  const chunks = buildDialogueChunks([
    { id: "a", speaker: "host", text: "12345" },
    { id: "b", speaker: "expert1", text: "67890" },
  ], 10);

  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].characters, 10);
  assert.deepEqual(chunks[0].turnIds, ["a", "b"]);
  assert.equal(chunks[0].inputs.map(input => input.text).join(""), "1234567890");
});

test("prosody context separates adjacent turn text when source turns omit padding", () => {
  const chunks = buildDialogueChunks([
    { id: "first", speaker: "host", text: "A quiet opening." },
    { id: "next", speaker: "expert1", text: "A clear response." },
    { id: "last", speaker: "expert2", text: "One final thought." },
  ], 18);

  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].futureText, "A clear response. One final thought.");
  assert.equal(chunks[2].previousText, "A quiet opening. A clear response.");
  assert.equal(chunks.map(chunk => chunk.inputs[0].text).join(""), "A quiet opening.A clear response.One final thought.");
});

test("malformed dialogue and turns with an unbreakable long token are rejected", () => {
  assert.throws(() => buildDialogueChunks([]), /at least one turn/);
  assert.throws(() => buildDialogueChunks([{ id: " ", speaker: "host", text: "hello" }]), /IDs/);
  assert.throws(() => buildDialogueChunks([
    { id: "same", speaker: "host", text: "hello" },
    { id: "same", speaker: "expert1", text: "again" },
  ]), /IDs/);
  assert.throws(() => buildDialogueChunks([{ id: "t", speaker: "narrator", text: "hello" } as never]), /unsupported speaker/);
  assert.throws(() => buildDialogueChunks([{ id: "t", speaker: "host", text: "   " }]), /non-empty text/);
  assert.throws(() => buildDialogueChunks([{ id: "t", speaker: "host", text: "supercalifragilistic" }], 8), /unbreakable word/);
});

function cbrClip(count: number) {
  const frameLength = 417;
  const bytes = new Uint8Array(frameLength * count);
  for (let i = 0; i < count; i++) bytes.set([0xff, 0xfb, 0x90, 0x64], i * frameLength);
  return bytes;
}

function validReviewedTurns() {
  const guests = [
    { speaker: "expert1", name: "Ada", expertise: "neuroscientist" },
    { speaker: "expert2", name: "Bo", expertise: "historian" },
    { speaker: "expert3", name: "Cy", expertise: "statistician" },
  ];
  const intro = "Welcome. Ada is our neuroscientist. Bo is our historian. Cy is our statistician. Tonight we ask a question and listen to the evidence together.";
  const countWords = (s: string) => (s.match(/[\p{L}\p{N}’'-]+/gu) || []).length;
  const opening = intro + ` ${"calm ".repeat(115 - countWords(intro))}`;
  return {
    guests,
    turns: Array.from({ length: 20 }, (_, i) => ({
      id: `turn-${i + 1}`,
      speaker: ["host", "expert1", "expert2", "expert3"][i % 4] as "host" | "expert1" | "expert2" | "expert3",
      text: i === 0 ? opening : `${"calm ".repeat(25)}`,
      factual: false,
      claim_ids: [] as string[],
    })),
  };
}

async function hashTurns(turns: unknown[]) {
  const bytes = new TextEncoder().encode(JSON.stringify(turns));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function ttsJob(turns: ReturnType<typeof validReviewedTurns>["turns"], extras: Record<string, unknown> = {}) {
  return {
    id: "dialogue-job", userId: "user-1", topic: "sleep", lengthMinutes: 5,
    status: "running", stage: "tts", progress: { ttsIndex: 0 },
    state: { artifacts: { outline: { title: "A quiet science seminar" }, script: { turns, guest_introductions: validReviewedTurns().guests }, review: { flags: [], unresolved: [] }, claims: [], ...extras }, sources: [] },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as any;
}

function voiceEnv(overrides: Record<string, unknown> = {}) {
  return {
    ELEVENLABS_API_KEY: "test-only",
    ELEVEN_DIALOGUE_MODEL: "eleven_v4",
    ELEVEN_MODEL: "legacy-model",
    ELEVEN_VOICE_HOST: "voice-host-a",
    ELEVEN_VOICE_EXPERT1: "voice-one-a",
    ELEVEN_VOICE_EXPERT2: "voice-two-a",
    ELEVEN_VOICE_EXPERT3: "voice-three-a",
    BUCKET: { put: async () => undefined, get: async () => null },
    ...overrides,
  } as any;
}

test("dialogue TTS sends one section per advance, pins voice/model settings, resumes with prior request ID, then assembles sections", async () => {
  const originalFetch = globalThis.fetch;
  const script = validReviewedTurns();
  const job = ttsJob(script.turns);
  const chunks = buildDialogueChunks(script.turns);
  const env = voiceEnv();
  const requests: Array<{ url: string; body: any }> = [];
  let puts = 0, reads = 0;
  const objects = new Map<string, Uint8Array>();
  env.BUCKET = {
    put: async (key: string, value: Uint8Array) => { puts++; objects.set(key, value.slice()); },
    get: async (key: string) => { reads++; const value = objects.get(key); return value ? { arrayBuffer: async () => value.slice().buffer } : null; },
  };
  globalThis.fetch = (async (input: any, init: any) => {
    requests.push({ url: String(input), body: JSON.parse(init.body) });
    return new Response(cbrClip(5000), { status: 200, headers: { "content-type": "audio/mpeg", "request-id": `req_section_${requests.length}` } });
  }) as any;
  try {
    const first = await advanceJob(job, env);
    assert.equal(first.stage, "tts");
    assert.equal(first.progress.ttsIndex, 1);
    assert.equal(requests.length, 1, "one advance may submit only one paid section");
    assert.match(requests[0].url, /\/v1\/text-to-dialogue\?/);
    assert.equal(requests[0].body.model_id, "eleven_v4");
    assert.ok(requests[0].body.inputs.some((input: any) => input.voice_id === "voice-host-a"));
    assert.ok(requests[0].body.inputs.some((input: any) => input.voice_id === "voice-one-a"));
    assert.equal(requests[0].body.inputs.length, chunks[0].inputs.length);
    assert.equal(job.state.artifacts.clips.length, 1);
    assert.equal(job.state.artifacts.clips[0].chunkId, chunks[0].id);

    env.ELEVEN_DIALOGUE_MODEL = "changed-model";
    env.ELEVEN_VOICE_HOST = "voice-host-b";
    env.ELEVEN_VOICE_EXPERT1 = "voice-one-b";
    const second = await advanceJob(job, env);
    assert.equal(second.progress.ttsIndex, 2);
    assert.equal(requests.length, 2);
    assert.equal(requests[1].body.model_id, "eleven_v4", "saved model choice remains pinned after env changes");
    assert.equal(requests[1].body.previous_request_ids[0], "req_section_1");
    assert.equal(requests[1].body.previous_text, undefined, "provider forbids using history IDs and previous text together");
    assert.ok(requests[1].body.inputs.every((input: any) => !input.voice_id.endsWith("-b")));
    assert.equal(job.state.artifacts.clips.length, chunks.length);
    assert.equal(job.state.artifacts.clips.length, 2);
    assert.equal(second.stage, "assembling");
    assert.ok(validateMp3(concatenateMp3([...objects.values()])).durationSeconds >= 240);

    const ready = await advanceJob(job, env);
    assert.equal(ready.status, "ready", `${ready.error}; reads=${reads}; puts=${puts}; stage=${ready.stage}`);
    assert.equal(ready.audio.generation.sections, chunks.length);
    assert.equal(ready.audio.generation.sections, 2);
    assert.equal(reads, chunks.length, "assembly reads each saved section, not each script turn");
    assert.equal(puts, chunks.length + 1, "two section files and one assembled episode");
    assert.equal(requests.length, 2, "assembly makes no additional speech requests");
  } finally { globalThis.fetch = originalFetch; }
});

test("dialogue resumption falls back to text context when saved audio history is too old", async () => {
  const originalFetch = globalThis.fetch;
  const requests: any[] = [];
  globalThis.fetch = (async (_input: any, init: any) => {
    requests.push(JSON.parse(init.body));
    return new Response(cbrClip(3), { status: 200, headers: { "request-id": `req_${requests.length}` } });
  }) as any;
  try {
    const job = ttsJob(validReviewedTurns().turns);
    await advanceJob(job, voiceEnv());
    job.state.artifacts.clips[0].generatedAt = "2000-01-01T00:00:00.000Z";
    await advanceJob(job, voiceEnv());
    assert.equal(requests.length, 2);
    assert.equal(requests[1].previous_request_ids, undefined);
    assert.equal(typeof requests[1].previous_text, "string");
    assert.ok(requests[1].previous_text.length > 0 && requests[1].previous_text.length <= 100);
  } finally { globalThis.fetch = originalFetch; }
});

test("ambiguous dialogue timeout is terminal and never retries the paid request", async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => { requests++; throw new Error("socket closed after submit"); }) as any;
  try {
    const job = ttsJob(validReviewedTurns().turns);
    const result: any = await advanceJob(job, voiceEnv());
    assert.equal(result.status, "failed");
    assert.equal(result.errorAmbiguous, true);
    assert.match(result.error, /not retried/);
    await advanceJob(job, voiceEnv());
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("legacy in-progress jobs with saved per-turn clips retain the single-voice TTS path", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "", body: any;
  globalThis.fetch = (async (input: any, init: any) => {
    requestUrl = String(input); body = JSON.parse(init.body);
    return new Response(cbrClip(3), { status: 200, headers: { "content-type": "audio/mpeg" } });
  }) as any;
  try {
    const turns = validReviewedTurns().turns;
    const job = ttsJob(turns, { clips: [{ key: "already-saved.mp3", turnId: turns[0].id }] });
    job.progress.ttsIndex = 1;
    const result = await advanceJob(job, voiceEnv());
    assert.equal(result.stage, "tts");
    assert.equal(result.progress.ttsIndex, 2);
    assert.match(requestUrl, /\/v1\/text-to-speech\/voice-one-a\?/);
    assert.equal(body.text, turns[1].text);
    assert.equal(body.model_id, "legacy-model");
    assert.equal(job.state.artifacts.dialoguePlan, undefined);
    assert.equal(job.state.artifacts.clips.length, 2);
    assert.equal(job.state.artifacts.clips[1].turnId, turns[1].id);
  } finally { globalThis.fetch = originalFetch; }
});
