import { readFileSync } from "node:fs";
import { episodeV2JobSchema, assertFinalScriptApproved } from "../lib/episode-v2/contracts.ts";
import { canonicalJson, readArtifact, sha256 } from "../lib/episode-v2/persistence.ts";
import { buildDialogueChunks } from "../lib/dialogue.ts";
import { audioVoicesSchema } from "../lib/episode-v2/audio-state.ts";
import { allowanceUsed } from "../lib/episode-v2/usage.ts";
import { z } from "zod";

// Read-only inspection. Public voice IDs arrive on stdin; this script does not read credentials or call a provider.
const job = episodeV2JobSchema.parse(JSON.parse(readFileSync(process.argv[2], "utf8")));
const input = z.object({ voices: audioVoicesSchema, priorTextAllowanceUsd: z.number().finite().nonnegative(),
  proposedAudioAllowanceUsd: z.number().finite().positive(), combinedSpendingCeilingUsd: z.number().finite().positive(),
  observedProviderPreflight: z.object({ endpoint: z.string(), httpStatus: z.number().int(), errorCode: z.string(), observedOn: z.string() }).strict(),
}).strict().parse(JSON.parse(readFileSync(0, "utf8")));
const { voices } = input;
if (!job.state.finalScript) throw new Error("No explicitly accepted script");
const script = await readArtifact(job, job.state.finalScript);
if (script.kind !== "final_script") throw new Error("Invalid final script");
const edit = await readArtifact(job, script.data.editReport), review = await readArtifact(job, script.data.review);
if (edit.kind !== "edit_report" || review.kind !== "review") throw new Error("Missing exact edit/review");
assertFinalScriptApproved(script, review, edit);
const turns = script.data.turns.map(({ id, speaker, text }) => ({ id, speaker, text }));
const chunks = buildDialogueChunks(turns, job.config.audio.chunkMaxCharacters);
let auditionChunkCount = 0; const heard = new Set<string>();
for (const chunk of chunks) { chunk.inputs.forEach(input => heard.add(input.speaker)); auditionChunkCount++; if (heard.size === 4 && auditionChunkCount >= 2) break; }
if (heard.size !== 4 || chunks.length < 2) throw new Error("Audition cannot cover four voices and a section boundary");
for (const turn of turns) {
  const slices = chunks.flatMap(chunk => chunk.inputs).filter(input => input.turnId === turn.id);
  if (slices.some(slice => slice.speaker !== turn.speaker) || slices.map(slice => slice.text).join("") !== turn.text) throw new Error("Speech changed during chunking");
}
const sections = chunks.map(chunk => ({ id: chunk.id, turnIds: chunk.turnIds, speakers: [...new Set(chunk.inputs.map(input => input.speaker))],
  characters: chunk.characters, maxReservedCharacters: chunk.characters + chunk.previousText.length + chunk.futureText.length,
  hypotheticalBaseCostUsd: (chunk.characters + chunk.previousText.length + chunk.futureText.length) * 0.08 / 1000 }));
console.log(JSON.stringify({ version: 1, episodeId: job.id, title: job.title, sourceFinalScript: job.state.finalScript,
  scriptHash: await sha256(canonicalJson(turns)), voicesHash: await sha256(canonicalJson(voices)), exactSpeechPreserved: true,
  characters: turns.reduce((sum, turn) => sum + turn.text.length, 0), characterAllowance: job.config.audio.maxCharacters,
  chunkCount: chunks.length, auditionChunkCount, auditionCharacters: sections.slice(0, auditionChunkCount).reduce((sum, section) => sum + section.characters, 0),
  sections, durationRangeSeconds: job.config.audioDurationSeconds,
  pricing: { source: "https://elevenlabs.io/pricing/api", retrievedOn: "2026-10-16", model: "eleven_v4", publishedBaseUsdPer1kCharacters: 0.08,
    accountAndVoiceRateVerified: false, warning: "Illustration only; not an authorized price snapshot. Account allowance and voice premiums remain unverified." },
  hypotheticalFullAudioBaseCostUsd: sections.reduce((sum, section) => sum + section.hypotheticalBaseCostUsd, 0),
  hypotheticalAuditionBaseCostUsd: sections.slice(0, auditionChunkCount).reduce((sum, section) => sum + section.hypotheticalBaseCostUsd, 0),
  currentEpisodeConservativeTextAllowanceUsd: allowanceUsed(job.state.usageLedger!), currentEpisodeCeilingUsd: job.config.limits.spendCeilingUsd,
  priorTextAllowanceUsd: input.priorTextAllowanceUsd, proposedAudioAllowanceUsd: input.proposedAudioAllowanceUsd,
  combinedPriorAndCurrentTextAllowanceUsd: input.priorTextAllowanceUsd + allowanceUsed(job.state.usageLedger!),
  totalPriorTextPlusProposedAudioAllowanceUsd: input.priorTextAllowanceUsd + allowanceUsed(job.state.usageLedger!) + input.proposedAudioAllowanceUsd,
  combinedSpendingCeilingUsd: input.combinedSpendingCeilingUsd,
  providerPreflight: { ...input.observedProviderPreflight, status: "blocked" },
  paidAudioRequests: 0, audioSpendUsd: 0, liveAuthorized: false, next: "Resolve metadata access, verify the configured voices/model/account rate, then create and listen to the four-voice audition before accepting full synthesis." }, null, 2));
