import { createTextPilot } from "../../lib/episode-v2/app-controls.ts";
import { episodeV2JobSchema, type EpisodeV2Job } from "../../lib/episode-v2/contracts.ts";
import { createD1EpisodeStore } from "../../lib/episode-v2/persistence.ts";
import type { AudioEnvironment } from "../../lib/episode-v2/audio.ts";
import { createRouteHarness } from "./route-harness.ts";

export const audioAt = Date.parse("2026-10-16T12:00:00Z");
/** Explicitly authored test speech; no paid generation and no V1 factual labels. */
export function audioFixture(lengthMinutes: 5 | 15 = 5): EpisodeV2Job {
  const job = createTextPilot({ id: "audio-test", userId: "route-owner", topic: "Authored audio fixture", lengthMinutes, spendCeilingUsd: 5, now: audioAt });
  job.config.audio.chunkMaxCharacters = 250;
  const turns = (["host", "expert1", "expert2", "expert3", "host", "expert2", "expert1", "expert3"] as const)
    .map((speaker, index) => ({ id: `turn-${index + 1}`, speaker, text: `This is the saved contribution for turn ${index + 1}. It preserves its words, its speaker, and the space for the following reply.` }));
  const reference = <K extends "transcript" | "cast" | "evidence_pack" | "edit_report" | "review">(kind: K) => ({ id: kind, kind, version: 1 });
  const envelope = { schemaVersion: 2, pipelineVersion: 2, version: 1, createdAt: new Date(audioAt).toISOString(),
    provenance: { inputVersions: [], editorialVersion: "authored-audio-fixture", prompt: null, modelConfiguration: null, usageRecordIds: [] } };
  const edit = { ...envelope, id: "edit_report", kind: "edit_report", data: { transcript: reference("transcript"), editedTurns: turns, changes: [], summary: "Retain the authored test speech." } };
  const review = { ...envelope, id: "review", kind: "review", data: { editReport: reference("edit_report"), evidencePack: reference("evidence_pack"), outcome: "acceptable", summary: "Authored offline fixture.", notes: [], issues: [] } };
  const final = { ...envelope, id: "final_script", kind: "final_script", data: { cast: reference("cast"), editReport: reference("edit_report"), review: reference("review"), turns, resolvedIssueIds: [], nearbyCoherenceChecked: false } };
  job.state.artifacts = { edit_report: edit, review, final_script: final } as EpisodeV2Job["state"]["artifacts"];
  job.state.finalScript = { id: "final_script", kind: "final_script", version: 1 };
  job.status = "paused"; job.stage = "ready_for_audio"; job.substep = "wait"; job.pause = { code: "text_checkpoint", reason: "Approved fixture." };
  return episodeV2JobSchema.parse(job);
}
export function fakeMp3(seconds: number) {
  const frames = Math.ceil(seconds * 44100 / 1152), bytes = new Uint8Array(frames * 417);
  for (let i = 0; i < frames; i++) bytes.set([0xff, 0xfb, 0x90, 0x64], i * 417);
  return bytes;
}
export function audioHarness(initial = audioFixture()) {
  const h = createRouteHarness(); let clock = audioAt;
  h.sqlite.prepare("INSERT INTO episodes VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.status, JSON.stringify(initial), audioAt, audioAt);
  const voices = { host: "voice-host", expert1: "voice-one", expert2: "voice-two", expert3: "voice-three" };
  const env: AudioEnvironment = { BUCKET: h.BUCKET, ELEVENLABS_API_KEY: "offline-fixture-only", V2_AUDIO_ENABLED: "true", ELEVEN_DIALOGUE_MODEL: "eleven_v4",
    ELEVEN_VOICE_HOST: voices.host, ELEVEN_VOICE_EXPERT1: voices.expert1, ELEVEN_VOICE_EXPERT2: voices.expert2, ELEVEN_VOICE_EXPERT3: voices.expert3,
    V2_AUDIO_PRICE_SNAPSHOT: JSON.stringify({ version: 1, model: "eleven_v4", voices, usdPer1kCharacters: 0.08, checkedAt: audioAt }) };
  const store = createD1EpisodeStore(h.DB, { now: () => clock });
  return { ...h, env, store, now: () => clock, tick: (ms = 1000) => { clock += ms; },
    options: { id: initial.id, userId: initial.userId, store, env, now: () => clock } };
}
