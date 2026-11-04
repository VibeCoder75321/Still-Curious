/** Durable audition runner. Reads exact approved speech; never accepts its own audition. */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { audioVoicesSchema } from "../lib/episode-v2/audio-state.ts";
import { advanceAudio, authorizeAudio, planReservation, verifiedAudioOutput, type AudioBucket } from "../lib/episode-v2/audio.ts";
import { episodeV2JobSchema } from "../lib/episode-v2/contracts.ts";
import { canonicalJson, createD1EpisodeStore, readArtifact, sha256 } from "../lib/episode-v2/persistence.ts";
import { allowanceUsed } from "../lib/episode-v2/usage.ts";
import { createPilotDatabase, withPilotDatabase } from "./pilot-storage.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), ".."), live = process.argv.includes("--live");
const input = JSON.parse(readFileSync(0, "utf8"));
const voices = audioVoicesSchema.parse(input.voices);
const allowance = Number(input.audioAllowanceUsd), paidUsd = Number(input.topupUsd), addedCredits = Number(input.topupCredits);
if (allowance !== 1.49 || paidUsd !== 10 || addedCredits !== 27472) throw new Error("This measured continuation retains the approved $1.49 audio allowance and observed top-up conversion.");
// API dollars and Creative/display credits are different meters. Require a dated operator-verified API rate.
const apiPricing = z.object({ usdPer1kCharacters: z.number().finite().positive(), checkedAt: z.number().int().positive(),
  sources: z.tuple([z.literal("https://elevenlabs.io/pricing/api"), z.literal("https://elevenlabs.io/app/subscription/api")]),
}).strict().parse(input.apiPricing);
if (apiPricing.checkedAt > Date.now() || Date.now() - apiPricing.checkedAt > 86_400_000) throw new Error("Verify today's API dollar rate before submitting audio.");
const runtimeName = z.string().regex(/^[a-z0-9-]{1,80}$/).parse(input.runtimeName ?? "still-curious-pharma-audio-01");
const source = resolve(repo, "docs/pilots/pharma-process-15m-02"), runtime = resolve(repo, "node_modules/.cache", runtimeName);
mkdirSync(runtime, { recursive: true });
const save = (name: string, value: unknown) => writeFileSync(resolve(runtime, name), JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
const read = (name: string) => JSON.parse(readFileSync(resolve(runtime, name), "utf8"));
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) throw new Error("The already-authorized existing ElevenLabs credential is unavailable.");
const stamp = () => new Date().toISOString();
const journal: Record<string, unknown>[] = existsSync(resolve(runtime, "http-journal.json")) ? read("http-journal.json") : [];
async function metadata(path: string) {
  const entry: Record<string, unknown> = { method: "GET", endpoint: path, startedAt: stamp(), status: null, purpose: "audio_preflight" };
  journal.push(entry); save("http-journal.json", journal);
  let response: Response;
  try { response = await fetch(`https://api.elevenlabs.io${path}`, { headers: { "xi-api-key": apiKey! }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("Provider metadata retrieval failed; no automatic retry or synthesis was attempted."); }
  entry.status = response.status; entry.finishedAt = stamp(); save("http-journal.json", journal);
  if (!response.ok) throw new Error(`Audio preflight stopped at HTTP ${response.status} for ${path}; no paid synthesis was submitted.`);
  return response.json();
}
const subscriptionSchema = z.object({ tier: z.string(), character_count: z.number().int().nonnegative(), character_limit: z.number().int().positive() });
const subscription = subscriptionSchema.parse(await metadata("/v1/user/subscription"));
const balance = { checkedAt: stamp(), tier: subscription.tier, creditsUsed: subscription.character_count,
  creditLimit: subscription.character_limit, creditsRemaining: subscription.character_limit - subscription.character_count };
save("last-preflight-balance.json", balance);
if (!Number.isFinite(balance.creditsRemaining) || balance.creditsRemaining < 1) throw new Error("No verified credit allowance is available.");
// These reads require explicit Models/Voices metadata permissions. No alternative credential or route is used on denial.
const models = z.array(z.object({ model_id: z.string(), name: z.string(), can_do_text_to_speech: z.boolean(), token_cost_factor: z.number().finite().nonnegative() })).parse(await metadata("/v1/models"));
const model = models.find(item => item.model_id === "eleven_v4");
if (!model?.can_do_text_to_speech || typeof model.token_cost_factor !== "number" || model.token_cost_factor <= 0) throw new Error("The configured model's speech capability and credit factor were not verified.");
const voiceMetadata: Record<string, unknown>[] = [];
for (const [speaker, id] of Object.entries(voices)) {
  const voice = z.object({ voice_id: z.string(), name: z.string(), category: z.string(), sharing: z.object({ rate: z.number().nullable().optional() }).passthrough().nullable().optional() })
    .parse(await metadata(`/v1/voices/${encodeURIComponent(id)}`));
  if (voice.voice_id !== id || !["premade", "default"].includes(voice.category) || (typeof voice.sharing?.rate === "number" && voice.sharing.rate > 0)) throw new Error("A configured voice is not a verified standard-rate default voice. No paid synthesis was submitted.");
  voiceMetadata.push({ speaker, voiceId: id, name: voice.name, category: voice.category, customRate: voice.sharing?.rate ?? null });
}
const verifiedAt = Date.now(), usdPerCredit = paidUsd / addedCredits;
const usdPer1kCharacters = apiPricing.usdPer1kCharacters;
const verification = { checkedAt: stamp(), funding: { userReportedTopupUsd: paidUsd, observedCreditsAdded: addedCredits, usdPerCredit,
  note: "Credit face-value conversion, excluding any unreported purchase tax; not an invoice or a second charge." },
  balance, model: { id: model.model_id, name: model.name, canDoTextToSpeech: model.can_do_text_to_speech, catalogTokenCostFactor: model.token_cost_factor },
  voices: voiceMetadata, apiPricing, usdPer1kCharacters,
  pricingBasis: "Official API dollar rate, confirmed on the signed-in account's API pricing table. Catalog token_cost_factor and purchased display-credit conversion are not API dollar prices.",
  audioAllowanceUsd: allowance, fullAudioAcceptanceAuthorized: false, priorResearchAndTextChanged: false };
save("provider-verification.json", verification);
const pricing = { version: 1 as const, model: "eleven_v4" as const, voices, usdPer1kCharacters, checkedAt: verifiedAt };
const configPath = resolve(runtime, "configuration.json");
if (existsSync(configPath)) {
  const saved = read("configuration.json");
  if (canonicalJson({ ...saved.pricing, checkedAt: 0 }) !== canonicalJson({ ...pricing, checkedAt: 0 })) {
    if (existsSync(resolve(runtime, "run.sqlite")) || journal.some(entry => entry.method === "POST")) throw new Error("Saved audio pricing/voices/model changed. Preserve and review the old plan before continuing.");
    save(`unused-configuration-${verifiedAt}.json`, saved);
  } else pricing.checkedAt = saved.pricing.checkedAt;
}
save("configuration.json", { pricing, audioAllowanceUsd: allowance, apiPricing, checkedFrom: "API pricing page, signed-in API price table, model catalog and four exact default voices" });
function bucketAt(base: string): AudioBucket {
  const objectRoot = resolve(base, "objects");
  const path = (key: string) => { const file = resolve(objectRoot, key); if (!file.startsWith(objectRoot + sep)) throw new Error("Invalid owned object path"); return file; };
  return { async put(key, value) { const file = path(key); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, typeof value === "string" ? value : new Uint8Array(value)); },
    async get(key) { const file = path(key); if (!existsSync(file)) return null; const data = readFileSync(file); return { size: data.length, async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer; } }; } };
}
const bucket = bucketAt(runtime), env = { BUCKET: bucket, ELEVENLABS_API_KEY: apiKey, V2_AUDIO_ENABLED: "true", ELEVEN_DIALOGUE_MODEL: "eleven_v4",
  ELEVEN_VOICE_HOST: voices.host, ELEVEN_VOICE_EXPERT1: voices.expert1, ELEVEN_VOICE_EXPERT2: voices.expert2, ELEVEN_VOICE_EXPERT3: voices.expert3,
  V2_AUDIO_PRICE_SNAPSHOT: JSON.stringify(pricing) };
const original = episodeV2JobSchema.parse(JSON.parse(readFileSync(resolve(source, "job.json"), "utf8")));
const initial = await authorizeAudio(original, env, allowance);
const pinned = initial.state.audioPipeline!.current!;
const maximumCredits = Math.ceil(pinned.chunks.reduce((sum, chunk) => sum + chunk.characters + chunk.previousText.length + chunk.futureText.length, 0) * model.token_cost_factor);
if (maximumCredits > balance.creditsRemaining) throw new Error("The verified account balance cannot cover the complete bounded audio plan. No paid synthesis was submitted.");
const maximumAuditionCredits = Math.ceil(pinned.chunks.slice(0, pinned.auditionChunkCount)
  .reduce((sum, chunk) => sum + chunk.characters + chunk.previousText.length + chunk.futureText.length, 0) * model.token_cost_factor);
// Only the audition is submitted. Preserve the provider's hard key limit; reassess its remaining quota after listening acceptance.
if (maximumAuditionCredits > 10_000) throw new Error("The audition exceeds the existing key's 10,000-credit limit; review that limit explicitly before paid synthesis.");
save("authorization.json", { userDirection: "Verify the user-funded credits and continue the four-voice audition using the approved pharmaceutical script and existing research.",
  existingCredentialReuseAuthorized: true, target: "audition_only", audioAllowanceUsd: allowance,
  originalCombinedCapUsd: 5, priorConservativeTextAllowanceUsd: 1.806268125 + allowanceUsed(original.state.usageLedger!),
  conservativeMaximumIncludingAudioUsd: 1.806268125 + allowanceUsed(original.state.usageLedger!) + allowance,
  finalScript: original.state.finalScript, scriptHash: pinned.scriptHash, planHash: pinned.planHash, expectedFullAudioUsd: planReservation(pinned),
  fullAudioAcceptanceAuthorized: false, paidSubmissionEnabled: live, researchCallsAuthorized: false });
save("quota-preflight.json", { existingKeyLimit: 10000, keyLimitChanged: false, maximumFullCatalogUnits: maximumCredits,
  maximumAuditionCatalogUnits: maximumAuditionCredits, fullKeyQuotaVerified: maximumCredits <= 10000,
  note: "Catalog units are a conservative quota check, not API dollars. Provider enforces the unchanged key cap. Full rendering needs listener acceptance and a remaining-quota check." });
if (!live) { console.log(JSON.stringify({ status: "preflight_only", model: pricing.model, usdPer1kCharacters, fullPlanReservationUsd: planReservation(pinned), auditionSections: pinned.auditionChunkCount, paidAudioRequests: 0 })); process.exit(0); }

const dbPath = resolve(runtime, "run.sqlite"), db = createPilotDatabase(dbPath), store = createD1EpisodeStore(db);
let job = await store.read(original.id, original.userId);
if (!job) {
  save("balance-before.json", balance);
  cpSync(resolve(source, "objects"), resolve(runtime, "objects"), { recursive: true, force: false });
  // Verify the entire owned artifact collection before committing the copied audio continuation.
  for (const ref of [...Object.values(original.state.artifacts).map(item => ({ id: item.id, kind: item.kind, version: item.version })),
    ...Object.values(original.state.artifactBlobs ?? {}).map(item => item.artifact)]) await readArtifact(original, ref, bucket);
  withPilotDatabase(dbPath, database => database.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.userId, initial.status, JSON.stringify(initial), initial.createdAt, initial.updatedAt));
  job = initial;
}
if (job.state.audioPipeline?.current?.scriptHash !== pinned.scriptHash) throw new Error("Audio continuation does not match the approved script.");
const transport: typeof fetch = async (url, init) => {
  const endpoint = new URL(typeof url === "string" || url instanceof URL ? url : url.url);
  const method = init?.method ?? "GET";
  if (endpoint.origin !== "https://api.elevenlabs.io" || !(method === "POST" && endpoint.pathname === "/v1/text-to-dialogue"
    || method === "GET" && /^\/v1\/history\/[\w-]+\/audio$/.test(endpoint.pathname))) throw new Error("Unexpected audio provider operation.");
  const body = method === "POST" ? JSON.parse(String(init?.body)) : null;
  const entry: Record<string, unknown> = { method, endpoint: endpoint.pathname, startedAt: stamp(), status: null,
    inputCharacters: body?.inputs.reduce((sum: number, input: { text: string }) => sum + input.text.length, 0) ?? null };
  journal.push(entry); save("http-journal.json", journal);
  const result = await fetch(url, init);
  Object.assign(entry, { status: result.status, headersReceivedAt: stamp(), requestId: result.headers.get("request-id") ?? result.headers.get("x-request-id"),
    historyItemId: result.headers.get("history-item-id") ?? result.headers.get("x-history-item-id"), chargedCharacters: result.headers.get("character-cost") ?? result.headers.get("x-character-count") });
  save("http-journal.json", journal); console.log(JSON.stringify({ event: "provider_http", ...entry }));
  return result;
};
for (let tick = 0; tick < 16 && job.status === "running"; tick++) {
  const result = await advanceAudio({ id: job.id, userId: job.userId, store, env, fetch: transport });
  job = (await store.read(job.id, job.userId))!; save("job.json", job);
  console.log(JSON.stringify({ event: "audio_progress", disposition: result.disposition, stage: job.stage, status: job.status,
    completedSections: job.state.audioPipeline?.current?.records.filter(record => record.phase === "completed").length ?? 0,
    targetSections: job.state.audioPipeline?.current?.auditionChunkCount, pause: job.pause?.code ?? null }));
  if (result.disposition !== "saved") break; // Unknown acknowledgement never triggers an automatic retry loop.
}
const finalBalance = subscriptionSchema.parse(await metadata("/v1/user/subscription"));
const runBaseline = read("balance-before.json");
save("balance-after.json", { checkedAt: stamp(), creditsUsed: finalBalance.character_count, creditLimit: finalBalance.character_limit,
  creditsRemaining: finalBalance.character_limit - finalBalance.character_count, observedCreditDelta: finalBalance.character_count - runBaseline.creditsUsed,
  creditFaceValueEquivalentUsd: (finalBalance.character_count - runBaseline.creditsUsed) * usdPerCredit,
  attribution: "Account-level display-credit delta; concurrent usage would also be included. Face-value conversion is diagnostic, not an API invoice or measured billed dollars." });
if (job.pause?.code !== "audio_audition") throw new Error("Audio did not reach audition acceptance; preserve saved state and review before another provider operation.");
const output = await verifiedAudioOutput(job, true, bucket), audio = await bucket.get(output.key);
if (!audio) throw new Error("Saved audition unavailable");
const bytes = await audio.arrayBuffer();
if (await sha256(bytes) !== output.sha256) throw new Error("Audition hash mismatch");
writeFileSync(resolve(runtime, "pharma-process-audition.mp3"), new Uint8Array(bytes));
save("audition-summary.json", { status: "awaiting_listener_acceptance", episodeId: job.id, title: job.title,
  finalScript: job.state.finalScript, scriptHash: job.state.audioPipeline!.current!.scriptHash, audio: output,
  model: pricing.model, voices: voiceMetadata, chunks: job.state.audioPipeline!.current!.chunks.slice(0, pinned.auditionChunkCount).map(chunk => ({ id: chunk.id, characters: chunk.characters, turnIds: chunk.turnIds })),
  records: job.state.audioPipeline!.current!.records, actualBilledUsd: null, conservativeCombinedCapUsd: 5, fullSynthesisStarted: false });
console.log(JSON.stringify({ status: "audition_ready", durationSeconds: output.durationSeconds, file: resolve(runtime, "pharma-process-audition.mp3"), sha256: output.sha256 }));
