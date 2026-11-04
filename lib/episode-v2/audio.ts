import { buildDialogueChunks, type DialogueTurn } from "../dialogue.ts";
import { concatenateMp3, validateMp3 } from "../mp3.ts";
import { assertFinalScriptApproved, episodeV2JobSchema, type EpisodeV2Job } from "./contracts.ts";
import { audioHeldUsd, audioPlanSchema, audioPriceSchema, audioVoicesSchema, type AudioPlan, type AudioRecord, type AudioObject } from "./audio-state.ts";
import { canonicalJson, readArtifact, sha256, StaleEpisodeError, type ArtifactBucket, type EpisodeStore } from "./persistence.ts";
import { allowanceUsed } from "./usage.ts";

export type AudioBucket = ArtifactBucket & {
  put(key: string, value: string | ArrayBuffer | Uint8Array, options?: { httpMetadata: { contentType: string; cacheControl: string } }): Promise<unknown>;
};
export type AudioEnvironment = {
  BUCKET?: AudioBucket; ELEVENLABS_API_KEY?: string; ELEVEN_DIALOGUE_MODEL?: string;
  ELEVEN_VOICE_HOST?: string; ELEVEN_VOICE_EXPERT1?: string; ELEVEN_VOICE_EXPERT2?: string; ELEVEN_VOICE_EXPERT3?: string;
  V2_AUDIO_ENABLED?: string; V2_AUDIO_PRICE_SNAPSHOT?: string;
};
const DAY = 86_400_000, MAX_CLIP_BYTES = 8_000_000;
const speakers = ["host", "expert1", "expert2", "expert3"] as const;
const roundUp = (value: number) => Math.ceil(value * 1e9) / 1e9;

/** Price includes account/voice premiums; only an operator can configure this server-side. */
export function audioConfiguration(env: AudioEnvironment, now = Date.now()) {
  if (env.V2_AUDIO_ENABLED !== "true" || !env.ELEVENLABS_API_KEY || !env.BUCKET) throw new Error("Audio is not enabled. Verify the provider account, voices and price before enabling paid audio.");
  const voices = audioVoicesSchema.parse({ host: env.ELEVEN_VOICE_HOST, expert1: env.ELEVEN_VOICE_EXPERT1,
    expert2: env.ELEVEN_VOICE_EXPERT2, expert3: env.ELEVEN_VOICE_EXPERT3 });
  let pricing;
  try { pricing = audioPriceSchema.parse(JSON.parse(env.V2_AUDIO_PRICE_SNAPSHOT ?? "")); }
  catch { throw new Error("An operator-verified audio price snapshot is required before spending."); }
  const model = env.ELEVEN_DIALOGUE_MODEL || "eleven_v4";
  if (pricing.model !== model || canonicalJson(pricing.voices) !== canonicalJson(voices)
    || pricing.checkedAt > now || now - pricing.checkedAt > 30 * DAY) throw new Error("Verify the current model, four voices and price before spending on audio.");
  return { model: pricing.model, voices, pricing };
}
export function audioConfigured(env: AudioEnvironment, now = Date.now()) {
  try { audioConfiguration(env, now); return true; } catch { return false; }
}

async function approvedSpeech(job: EpisodeV2Job, bucket?: ArtifactBucket) {
  if (!job.state.finalScript) throw new Error("An explicitly approved final script is required for audio.");
  const script = await readArtifact(job, job.state.finalScript, bucket);
  if (script.kind !== "final_script") throw new Error("The selected audio script is invalid.");
  const review = await readArtifact(job, script.data.review, bucket), edit = await readArtifact(job, script.data.editReport, bucket);
  if (review.kind !== "review" || edit.kind !== "edit_report") throw new Error("The exact edit and review are required for audio.");
  assertFinalScriptApproved(script, review, edit);
  const turns: DialogueTurn[] = script.data.turns.map(({ id, speaker, text }) => ({ id, speaker, text }));
  return { script, turns, scriptHash: await sha256(canonicalJson(turns)) };
}
function planPins(plan: AudioPlan) {
  const { planHash: _hash, generationId: _generation, mode: _mode, authorizedAt: _at, auditionAcceptedAt: _accepted, records: _records,
    audition: _audition, output: _output, auditionWaivedAt: _waived, ...pins } = plan;
  return pins;
}
export const maxChargeCharacters = (chunk: AudioPlan["chunks"][number]) => chunk.characters + chunk.previousText.length + chunk.futureText.length;
export const chunkReservation = (plan: AudioPlan, chunk: AudioPlan["chunks"][number]) => roundUp(maxChargeCharacters(chunk) * plan.pricing.usdPer1kCharacters / 1000);
export const planReservation = (plan: AudioPlan) => roundUp(plan.chunks.reduce((sum, chunk) => sum + chunkReservation(plan, chunk), 0));

const fullAudioAuthorized = (plan: AudioPlan) => !!plan.auditionAcceptedAt || (plan.auditionRequired === false && !!plan.auditionWaivedAt);
export async function createAudioPlan(job: EpisodeV2Job, env: AudioEnvironment, now = Date.now(), auditionFirst = true): Promise<AudioPlan> {
  const { script, turns, scriptHash } = await approvedSpeech(job, env.BUCKET), configured = audioConfiguration(env, now);
  const characters = turns.reduce((sum, turn) => sum + turn.text.length, 0);
  if (characters > job.config.audio.maxCharacters) throw new Error("The approved script exceeds this episode's audio character allowance.");
  const chunks = buildDialogueChunks(turns, job.config.audio.chunkMaxCharacters);
  for (const turn of turns) {
    const inputs = chunks.flatMap(chunk => chunk.inputs).filter(input => input.turnId === turn.id);
    if (inputs.some(input => input.speaker !== turn.speaker) || inputs.map(input => input.text).join("") !== turn.text) throw new Error("The audio plan does not preserve the approved speech.");
  }
  let auditionChunkCount = 0;
  const heard = new Set<string>();
  for (const chunk of chunks) {
    chunk.inputs.forEach(input => heard.add(input.speaker)); auditionChunkCount++;
    if (heard.size === 4 && auditionChunkCount >= 2) break;
  }
  if (heard.size !== 4 || chunks.length < 2) throw new Error("The approved script must contain all four speakers and a section boundary for the audio audition.");
  const plan = audioPlanSchema.parse({ version: 1, finalScript: job.state.finalScript, editReport: script.data.editReport,
    review: script.data.review, scriptHash, planHash: "0".repeat(64), generationId: crypto.randomUUID(), ...configured, outputFormat: "mp3_44100_128",
    chunkCharacters: job.config.audio.chunkMaxCharacters, maxCharacters: job.config.audio.maxCharacters,
    durationSeconds: job.config.audioDurationSeconds, chunks, auditionChunkCount, mode: auditionFirst ? "audition" : "full", authorizedAt: now, records: [],
    ...(!auditionFirst ? { auditionRequired: false, auditionWaivedAt: now } : {}) });
  plan.planHash = await sha256(canonicalJson(planPins(plan)));
  return plan;
}

export async function verifyAudioPlan(job: EpisodeV2Job, plan: AudioPlan, env: AudioEnvironment, now = Date.now()) {
  audioPlanSchema.parse(plan);
  const expected = await createAudioPlan(job, env, now, plan.auditionRequired !== false);
  if (plan.planHash !== expected.planHash || await sha256(canonicalJson(planPins(plan))) !== plan.planHash) throw new Error("The script, review, voices, price, model or chunk plan changed. Explicitly invalidate the old audio before authorizing a new plan.");
  if (plan.mode === "full" && !fullAudioAuthorized(plan)) throw new Error("Accept the four-voice audition or explicitly choose full audio before continuing.");
  const seen = new Set<string>();
  for (const record of plan.records) {
    const chunk = plan.chunks.find(chunk => chunk.id === record.chunkId);
    if (!chunk || seen.has(record.chunkId) || record.maxChargeCharacters !== maxChargeCharacters(chunk)
      || record.reservedUsd !== chunkReservation(plan, chunk)) throw new Error("Audio reservations do not match the pinned sections.");
    seen.add(record.chunkId);
    if (record.chargedCharacters !== null && record.chargedCharacters > record.maxChargeCharacters) throw new Error("The provider's reported character charge exceeded its reservation. Check billing before continuing.");
  }
}

/** Playback remains available when prices expire, but never for a changed script. */
export async function verifiedAudioOutput(job: EpisodeV2Job, audition: boolean, bucket: AudioBucket) {
  const plan = job.state.audioPipeline?.current, output = audition ? plan?.audition : plan?.output;
  if (!plan || !output) throw new Error("No saved audio output.");
  const { script, scriptHash } = await approvedSpeech(job, bucket);
  if (scriptHash !== plan.scriptHash || canonicalJson(job.state.finalScript) !== canonicalJson(plan.finalScript)
    || canonicalJson(script.data.review) !== canonicalJson(plan.review) || canonicalJson(script.data.editReport) !== canonicalJson(plan.editReport)
    || await sha256(canonicalJson(planPins(plan))) !== plan.planHash
    || canonicalJson(buildDialogueChunks(script.data.turns, plan.chunkCharacters)) !== canonicalJson(plan.chunks)
    || output.key !== `${root(job, plan)}/${audition ? "audition" : "episode"}.mp3`
    || (!audition && (job.audioKey !== output.key || plan.mode !== "full" || !fullAudioAuthorized(plan)))) throw new Error("Saved audio no longer matches the accepted script.");
  return output;
}

/** Caller holds the episode lease. No paid request is made by authorization. */
export async function authorizeAudio(job: EpisodeV2Job, env: AudioEnvironment, allowanceUsd: number, now = Date.now(), auditionFirst = true) {
  if (job.status !== "paused" || job.stage !== "ready_for_audio" || job.pause?.code !== "text_checkpoint" || job.state.audioPipeline?.current) throw new Error("Audio authorization requires the saved text checkpoint.");
  if (!Number.isFinite(allowanceUsd) || allowanceUsd < 0.01 || Math.abs(allowanceUsd * 100 - Math.round(allowanceUsd * 100)) > 1e-7) throw new Error("Enter an audio allowance in whole cents.");
  const ledger = job.state.usageLedger;
  if (!ledger || ledger.records.some(record => ["reserved", "pending", "uncertain"].includes(record.outcome) && !record.abandonment)) throw new Error("Reconcile text operations before authorizing audio.");
  const plan = await createAudioPlan(job, env, now, auditionFirst), used = allowanceUsed(ledger), prior = audioHeldUsd(job.state.audioPipeline);
  const priorAudioOperations = [...(job.state.audioPipeline?.invalidated ?? [])].reduce((sum, plan) => sum + plan.records.length, 0);
  if (ledger.records.length + priorAudioOperations + plan.chunks.length > job.config.limits.maxProviderOperations) throw new Error("The complete audio plan exceeds the remaining provider-operation allowance.");
  if (used + allowanceUsd > (ledger.spendCeilingUsd ?? 0) + 1e-9 || prior + planReservation(plan) > allowanceUsd + 1e-9) throw new Error("The complete audio plan and existing reservations do not fit this allowance and the episode's spending limit.");
  const next = structuredClone(job);
  next.state.usageLedger!.allocations = { research: allowanceUsed(ledger, "research"), text: allowanceUsed(ledger, "text"), review: allowanceUsed(ledger, "review"), audio: allowanceUsd };
  next.state.audioPipeline = { version: 1, allowanceUsd, current: plan, invalidated: next.state.audioPipeline?.invalidated ?? [] };
  delete next.textOnly; delete next.pause; next.status = "running"; next.stage = "tts"; next.substep = "synthesize";
  return episodeV2JobSchema.parse(next);
}

export function audioActions(job: EpisodeV2Job) {
  const state = job.state.audioPipeline, plan = state?.current;
  return {
    authorizeAudio: job.status === "paused" && job.pause?.code === "text_checkpoint" && !plan,
    acceptAudition: job.status === "paused" && job.pause?.code === "audio_audition" && !!plan?.audition && plan.mode === "audition",
    // A new plan must never discard an unresolved paid operation.
    invalidateAudio: job.status === "paused" && !!plan && !plan.records.some(record => ["submitted", "received", "uncertain"].includes(record.phase)) && (state?.invalidated.length ?? 0) < 8,
    recoverAudio: !!plan && job.status === "paused" && job.pause?.code === "ambiguous_provider_result"
      && plan.records.some(record => record.phase === "received" && !!record.historyItemId),
  };
}
/** Creation explicitly authorized audio inside the shared cap. This transition makes no provider request. */
export async function startRequestedAudio(id: string, userId: string, store: EpisodeStore, env: AudioEnvironment) {
  const lease = await store.claim(id, userId);
  if (!lease) return { job: await store.read(id, userId), disposition: "busy" as const };
  try {
    const job = lease.job, request = job.requestedAudio;
    if (!request || !audioActions(job).authorizeAudio) return { job, disposition: "waiting" as const };
    const next = await authorizeAudio(job, env, request.allowanceUsd, Date.now(), request.auditionFirst);
    await store.save(lease, next);
    return { job: next, disposition: "saved" as const };
  } finally { await store.release(lease); }
}
export function applyAudioControl(job: EpisodeV2Job, action: "accept_audition" | "invalidate_audio", now = Date.now()) {
  const next = structuredClone(job), actions = audioActions(job), state = next.state.audioPipeline!, plan = state?.current;
  if (action === "accept_audition" && actions.acceptAudition && plan) {
    plan.mode = "full"; plan.auditionAcceptedAt = now; next.status = "running"; delete next.pause;
    if (plan.records.length === plan.chunks.length) { next.stage = "assembling"; next.substep = "assemble"; }
  } else if (action === "invalidate_audio" && actions.invalidateAudio && plan) {
    state.invalidated.push(plan); delete state.current; delete next.audioKey; delete next.audio;
    next.status = "paused"; next.stage = "ready_for_audio"; next.substep = "wait";
    delete next.requestedAudio;
    next.pause = { code: "text_checkpoint", reason: "Old audio was explicitly invalidated. Its cost records are retained; a new plan needs authorization." };
  } else throw new Error("This audio action is unavailable for the saved state.");
  return episodeV2JobSchema.parse(next);
}

const root = (job: EpisodeV2Job, plan: AudioPlan) => `episodes/${encodeURIComponent(job.userId)}/${encodeURIComponent(job.id)}/audio/${plan.planHash}/${plan.generationId}`;
const clipKey = (job: EpisodeV2Job, plan: AudioPlan, id: string) => `${root(job, plan)}/${id}.mp3`;
const metadata = (contentType: string) => ({ httpMetadata: { contentType, cacheControl: "private, no-store" } });
async function saveAudioObject(bucket: AudioBucket, key: string, data: Uint8Array): Promise<AudioObject> {
  const measured = validateMp3(data), sha = await sha256(data.slice().buffer);
  if (data.byteLength > 32_000_000) throw new Error("Audio exceeds its storage allowance.");
  await bucket.put(key, data, metadata("audio/mpeg"));
  return { key, sha256: sha, bytes: data.byteLength, durationSeconds: measured.durationSeconds };
}
async function loadClip(job: EpisodeV2Job, plan: AudioPlan, clip: NonNullable<AudioRecord["clip"]>, bucket: AudioBucket) {
  if (clip.key !== clipKey(job, plan, clip.chunkId)) throw new Error("Saved audio is not owned by this plan.");
  const object = await bucket.get(clip.key);
  if (!object || object.size !== clip.bytes || object.size > MAX_CLIP_BYTES) throw new Error("Saved audio size does not match.");
  const data = await object.arrayBuffer();
  if (data.byteLength !== clip.bytes || await sha256(data) !== clip.sha256) throw new Error("Saved audio failed its integrity check.");
  if (Math.abs(validateMp3(new Uint8Array(data)).durationSeconds - clip.durationSeconds) > 0.001) throw new Error("Saved audio duration does not match.");
  return new Uint8Array(data);
}
async function recoverReceipt(job: EpisodeV2Job, plan: AudioPlan, record: AudioRecord, bucket: AudioBucket) {
  const object = await bucket.get(`${clipKey(job, plan, record.chunkId)}.json`);
  if (!object) return false;
  if (object.size > 4096) throw new Error("Invalid saved audio receipt.");
  const { audioRecordSchema } = await import("./audio-state.ts");
  const bytes = await object.arrayBuffer();
  if (bytes.byteLength !== object.size || bytes.byteLength > 4096) throw new Error("Invalid saved audio receipt size.");
  const receipt = audioRecordSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
  if (receipt.phase !== "completed" || receipt.chunkId !== record.chunkId || receipt.startedAt !== record.startedAt
    || receipt.reservedUsd !== record.reservedUsd || receipt.maxChargeCharacters !== record.maxChargeCharacters || !receipt.clip) throw new Error("Saved audio receipt does not match the paid reservation.");
  await loadClip(job, plan, receipt.clip, bucket); Object.assign(record, receipt); return true;
}
function hold(job: EpisodeV2Job, reason: string, ambiguous = false) {
  job.status = "paused"; job.pause = { code: ambiguous ? "ambiguous_provider_result" : "needs_input", reason };
}
const safeId = (value: string | null) => value && /^[\w-]{1,200}$/.test(value) ? value : undefined;

/** One durable section per advance; interrupted/uncertain POSTs are NEVER resubmitted. */
export async function advanceAudio(options: {
  id: string; userId: string; store: EpisodeStore; env: AudioEnvironment; fetch?: typeof fetch; now?: () => number;
}) {
  const { store, env } = options, now = options.now ?? Date.now, transport = options.fetch ?? fetch;
  const lease = await store.claim(options.id, options.userId);
  if (!lease) return { job: await store.read(options.id, options.userId), disposition: "busy" };
  let job = structuredClone(lease.job), mayHaveSubmitted = false;
  try {
    if (job.status !== "running") return { job, disposition: "waiting" };
    const plan = job.state.audioPipeline?.current;
    if (!plan || !env.BUCKET || !["tts", "assembling"].includes(job.stage)) throw new Error("A pinned, authorized audio plan is required.");
    await verifyAudioPlan(job, plan, env, now());
    const target = plan.mode === "audition" ? plan.auditionChunkCount : plan.chunks.length;
    const selected = plan.chunks.slice(0, target);
    for (const [index, record] of plan.records.entries()) {
      if (record.chunkId !== plan.chunks[index]?.id) throw new Error("Saved audio sections are missing, duplicated or out of order.");
      if (record.phase === "completed") await loadClip(job, plan, record.clip!, env.BUCKET);
    }
    const chunk = selected.find(chunk => !plan.records.some(record => record.chunkId === chunk.id && record.phase === "completed"));
    if (!chunk) {
      const clips = await Promise.all(selected.map(async chunk => {
        const record = plan.records.find(record => record.chunkId === chunk.id);
        if (!record?.clip || record.phase !== "completed") throw new Error("A saved audio section is missing.");
        return loadClip(job, plan, record.clip, env.BUCKET!);
      }));
      const audio = concatenateMp3(clips), duration = validateMp3(audio).durationSeconds;
      if (plan.mode === "full" && (duration < plan.durationSeconds.min || duration > plan.durationSeconds.max)) throw new Error("The measured audio duration falls outside the selected episode's range. Review it without automatically regenerating speech.");
      const output = await saveAudioObject(env.BUCKET, `${root(job, plan)}/${plan.mode === "audition" ? "audition" : "episode"}.mp3`, audio);
      if (plan.mode === "audition") {
        plan.audition = output; job.status = "paused";
        job.pause = { code: "audio_audition", reason: "Listen to all four voices and the section transition. Accept the audition to render the remaining sections within the same allowance." };
      } else {
        plan.output = output; job.audioKey = output.key; job.audio = { durationSeconds: output.durationSeconds, scriptHash: plan.scriptHash, planHash: plan.planHash };
        job.status = "ready"; job.stage = "ready"; job.substep = "complete"; delete job.pause;
      }
      await store.save(lease, job); return { job, disposition: "saved" };
    }
    let record = plan.records.find(record => record.chunkId === chunk.id);
    if (record && record.phase !== "completed") {
      if (await recoverReceipt(job, plan, record, env.BUCKET)) {
        await store.save(lease, job); return { job, disposition: "saved" };
      }
      if (record.phase !== "received" || !record.historyItemId) {
        record.phase = record.phase === "rejected" ? "rejected" : "uncertain";
        hold(job, "A paid audio request may have completed. No repeat synthesis was attempted; check the provider history and billing.", true);
        await store.save(lease, job); return { job, disposition: "saved" };
      }
    } else {
      const ledger = job.state.usageLedger!, audio = job.state.audioPipeline!;
      const cost = chunkReservation(plan, chunk);
      const operations = ledger.records.length + [...audio.invalidated, plan].flatMap(plan => plan.records).length;
      if (operations >= job.config.limits.maxProviderOperations || audioHeldUsd(audio) + cost > audio.allowanceUsd + 1e-9
        || allowanceUsed(ledger) + audioHeldUsd(audio) + cost > (ledger.spendCeilingUsd ?? 0) + 1e-9) throw new Error("The next audio section does not fit the saved operation and spending allowance.");
      record = { chunkId: chunk.id, phase: "submitted", startedAt: now(), maxChargeCharacters: maxChargeCharacters(chunk), reservedUsd: cost,
        chargedCharacters: null, reportedCostUsd: null, billedUsd: null };
      plan.records.push(record);
      await store.save(lease, job); // No network request before this reservation commits.
      mayHaveSubmitted = true;
    }
    let response: Response;
    if (record.phase === "received" && record.historyItemId) {
      response = await transport(`https://api.elevenlabs.io/v1/history/${encodeURIComponent(record.historyItemId)}/audio`,
        { headers: { "xi-api-key": env.ELEVENLABS_API_KEY! }, signal: AbortSignal.timeout(90_000) });
    } else {
      const previous = plan.records.filter(record => record.phase === "completed" && record.requestId && record.receivedAt && now() - record.receivedAt < 2 * 60 * 60_000)
        .map(record => record.requestId!).slice(-3);
      response = await transport(`https://api.elevenlabs.io/v1/text-to-dialogue?output_format=${plan.outputFormat}`, {
        method: "POST", headers: { "xi-api-key": env.ELEVENLABS_API_KEY!, "content-type": "application/json" }, signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({ model_id: plan.model, inputs: chunk.inputs.map(input => ({ text: input.text, voice_id: plan.voices[input.speaker] })),
          ...(previous.length ? { previous_request_ids: previous } : chunk.previousText ? { previous_text: chunk.previousText } : {}),
          ...(chunk.futureText ? { future_text: chunk.futureText } : {}) }),
      });
      if (response.ok) {
        record.phase = "received"; record.receivedAt = now();
        record.requestId = safeId(response.headers.get("request-id") || response.headers.get("x-request-id"));
        record.historyItemId = safeId(response.headers.get("history-item-id") || response.headers.get("x-history-item-id"));
        const providerCost = response.headers.get("character-cost");
        record.providerCharacterCost = providerCost !== null && /^\d+$/.test(providerCost) && Number.isSafeInteger(Number(providerCost)) ? Number(providerCost) : null;
        const charged = response.headers.get("x-character-count");
        record.chargedCharacters = charged !== null && /^\d+$/.test(charged) && Number.isSafeInteger(Number(charged)) ? Number(charged) : null;
        // Neither header is an invoice in dollars. Keep the full input/context reservation instead.
        record.reportedCostUsd = null;
        await store.save(lease, job); // Keep retrieval IDs even if reading/storing the body fails.
      }
    }
    if (!response.ok) {
      record.phase = response.status >= 400 && response.status < 500 ? "rejected" : "uncertain";
      record.reason = `Audio provider returned HTTP ${response.status}. No automatic synthesis retry is permitted.`;
      hold(job, record.reason, true); await store.save(lease, job); return { job, disposition: "saved" };
    }
    const length = response.headers.get("content-length");
    if (length && Number(length) > MAX_CLIP_BYTES) throw new Error("Audio response exceeds the clip storage allowance.");
    if (!response.body) throw new Error("The provider returned an empty audio body.");
    const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > MAX_CLIP_BYTES) { await reader.cancel(); throw new Error("Audio response exceeds the clip storage allowance."); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const data = new Uint8Array(size); let offset = 0;
    for (const part of parts) { data.set(part, offset); offset += part.byteLength; }
    record.clip = { ...await saveAudioObject(env.BUCKET, clipKey(job, plan, chunk.id), data), chunkId: chunk.id };
    record.phase = "completed";
    await env.BUCKET.put(`${record.clip.key}.json`, canonicalJson(record), metadata("application/json"));
    await store.save(lease, job);
    if (record.chargedCharacters !== null && record.chargedCharacters > record.maxChargeCharacters) {
      hold(job, "The provider reported more charged characters than reserved. Check billing; no further synthesis will run."); await store.save(lease, job);
    } else if (plan.mode === "full" && plan.records.length === plan.chunks.length) {
      job.stage = "assembling"; job.substep = "assemble"; await store.save(lease, job);
    }
    return { job, disposition: "saved" };
  } catch (error) {
    // A persistence acknowledgement may be lost after committing. Inspect durable state, never overwrite it with a stale fallback.
    if (error instanceof StaleEpisodeError) return { job: await store.read(options.id, options.userId), disposition: "stale" };
    if (mayHaveSubmitted) return { job: await store.read(options.id, options.userId), disposition: "stale" };
    job = structuredClone(lease.job);
    const retrievable = job.state.audioPipeline?.current?.records.some(record => record.phase === "received" && !!record.historyItemId);
    hold(job, error instanceof Error && !/fetch|network|socket|timeout/i.test(error.message) ? error.message : "Audio could not continue safely. Saved clips and reservations are preserved.", retrievable);
    await store.save(lease, job); return { job, disposition: "saved" };
  } finally { await store.release(lease); }
}
