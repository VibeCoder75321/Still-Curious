import { cpSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { assertFinalScriptApproved, episodeV2JobSchema } from "../../../lib/episode-v2/contracts.ts";
import { requireFrozenEvidence } from "../../../lib/episode-v2/evidence-foundation.ts";
import { canonicalJson, readArtifact, sha256, type ArtifactBucket } from "../../../lib/episode-v2/persistence.ts";
import { artifactRef, requireLatestArtifact } from "../../../lib/episode-v2/stage-helpers.ts";
import { conversationObservations } from "../../../lib/episode-v2/conversation-observations.ts";
import { researchExport, transcriptExport } from "../../../lib/episode-v2/exports.ts";
import { pilotUsageReport } from "../../../lib/episode-v2/pilot-report.ts";

const destination = dirname(fileURLToPath(import.meta.url)), repo = resolve(destination, "../../..");
const root = resolve(repo, "node_modules/.cache/still-curious-pharma-reuse-02");
const json = (name: string) => JSON.parse(readFileSync(resolve(root, name), "utf8"));
const job = episodeV2JobSchema.parse(json("job.json"));
if (job.pause?.code !== "text_checkpoint" || !job.state.finalScript) throw new Error("This run has not reached an accepted text checkpoint.");
const bucket: ArtifactBucket = { async put() { throw new Error("Verification is read-only"); }, async get(key) {
  const file = resolve(root, "objects", key); if (!file.startsWith(resolve(root, "objects") + sep) || !existsSync(file)) return null;
  const data = readFileSync(file); return { size: data.length, async arrayBuffer() { return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer; } };
} };
const read = (ref: Parameters<typeof readArtifact>[1]) => readArtifact(job, ref, bucket);
const refs = [...Object.values(job.state.artifacts).map(artifactRef), ...Object.values(job.state.artifactBlobs ?? {}).map(blob => blob.artifact)];
for (const ref of refs) await read(ref);
await requireFrozenEvidence(job, read);
const script = await read(job.state.finalScript);
if (script.kind !== "final_script") throw new Error("Wrong final script type");
const review = await read(script.data.review), edit = await read(script.data.editReport);
if (review.kind !== "review" || edit.kind !== "edit_report") throw new Error("The exact final review and edit are unavailable");
assertFinalScriptApproved(script, review, edit);
const exported = await transcriptExport(job, read), research = await researchExport(job, read);
if (canonicalJson(exported.finalScript!.turns) !== canonicalJson(script.data.turns)) throw new Error("The export differs from the approved script");
const transcript = await requireLatestArtifact(job, read, "transcript"), cast = await read(script.data.cast);
if (cast.kind !== "cast") throw new Error("Wrong cast type");
const observations = conversationObservations(script.data.turns);
const usage = pilotUsageReport(job), authorization = json("authorization.json");
const combinedAllowance = authorization.priorConservativeAllowanceUsd + usage.cost.heldAllowanceUsd;
const journal = json("http-journal.json") as { method: string; startedAt: string; finishedAt: string | null; status: number | null; responseId?: string }[];
const records = job.state.usageLedger!.records;
if (combinedAllowance > authorization.combinedCapUsd + 1e-9) throw new Error("Combined allowance exceeds the original $5 cap");
if (records.some(record => record.role === "research" || record.role === "source" || record.reported.webSearchCalls !== 0 || record.reported.sourceReads !== 0)) throw new Error("This run unexpectedly used retrieval");
if (records.some(record => record.outcome !== "completed" || record.boundExceeded)) throw new Error("An operation is unfinished or exceeds its reservation");
if (journal.filter(entry => entry.method === "POST").length !== records.length) throw new Error("Submission and operation counts differ");
const submittedIds = journal.filter(entry => entry.method === "POST").map(entry => entry.responseId);
if (submittedIds.some(id => !id) || new Set(submittedIds).size !== records.length
  || records.some(record => !submittedIds.includes(record.responseId ?? undefined))) throw new Error("Submission identities are missing, duplicated or do not match the saved operations");
const names = new Map(exported.speakers.map(speaker => [speaker.id, speaker.name]));
const wordCount = (text: string) => text.trim().split(/\s+/u).length;
const summary = { episodeId: job.id, title: job.title, topic: job.topic, lengthMinutes: job.lengthMinutes, status: job.status,
  stage: `${job.stage}.${job.substep}`, reviewOutcome: review.data.outcome, reviewSummary: review.data.summary, reviewNotes: review.data.notes,
  words: observations.totalWords, characters: script.data.turns.reduce((sum, turn) => sum + turn.text.length, 0), turns: script.data.turns.length,
  acceptedWords: conversationObservations(transcript.data.turns).totalWords,
  estimatedMinutes: { at145WordsPerMinute: observations.totalWords / 145, at135WordsPerMinute: observations.totalWords / 135, at120WordsPerMinute: observations.totalWords / 120 },
  openingWords: wordCount(script.data.turns[0].text), participation: observations,
  speakers: [cast.data.host, ...cast.data.guests].map(profile => ({ id: profile.speaker, name: profile.name })),
  yieldDecisions: transcript.data.hostDecisions.filter(decision => decision.action === "yield").length,
  bidRounds: transcript.data.conversation?.bidRounds ?? 0,
  stanceUpdates: transcript.data.stanceUpdates, operationCount: records.length,
  roles: Object.fromEntries([...new Set(records.map(record => record.role))].map(role => [role, records.filter(record => record.role === role).length])),
  http: { submissions: journal.filter(entry => entry.method === "POST").length, retrievals: journal.filter(entry => entry.method === "GET").length,
    missingCompletions: journal.filter(entry => !entry.finishedAt).length },
  cost: { newRunCeilingUsd: job.config.limits.spendCeilingUsd, estimatedUsd: usage.cost.estimatedReportedSubtotalUsd,
    conservativeAllowanceUsd: usage.cost.heldAllowanceUsd, previousConservativeAllowanceUsd: authorization.priorConservativeAllowanceUsd,
    combinedConservativeAllowanceUsd: combinedAllowance, combinedCapUsd: authorization.combinedCapUsd, billedUsd: null },
  finalTurnsSha256: await sha256(canonicalJson(script.data.turns)), artifactsVerified: refs.length, reusedResearch: true, newSourceReads: 0, newSearches: 0,
  originalRunUnchanged: true, actualAudioDurationMeasured: false,
};
const markdown = `# ${job.title}\n\nStill Curious · 15-minute text pilot using saved research · ${observations.totalWords.toLocaleString("en-US")} words\n\nThe speakers are fictional AI characters. Whole-episode review: **${review.data.outcome}**. Estimated spoken length: ${(observations.totalWords / 145).toFixed(1)} minutes at 145 words per minute, or ${(observations.totalWords / 135).toFixed(1)}–${(observations.totalWords / 120).toFixed(1)} minutes at a calmer 120–135. Audio duration is unmeasured.\n\n` + script.data.turns.map(turn => `**${names.get(turn.speaker)}**\n\n${turn.text}`).join("\n\n") + "\n";
writeFileSync(resolve(root, "transcript.md"), markdown);
for (const [name, value] of Object.entries({ "transcript.json": exported, "research.json": research, "usage-report.json": usage,
  "pilot-summary.json": summary, "artifact-verification.json": { at: new Date().toISOString(), artifactReferences: refs,
    ownedHashesVerified: true, frozenEvidenceVerified: true, finalScriptEditReviewVerified: true, exactFinalExportVerified: true,
    combinedCapVerified: true, noNewRetrievalVerified: true, noDuplicateSubmissions: true, finalTurnsSha256: summary.finalTurnsSha256 } })) {
  writeFileSync(resolve(root, name), JSON.stringify(value, null, 2));
}
for (const name of ["pharma-reuse-02-commission.log", "pharma-reuse-02-commission-resume.log", "pharma-reuse-02-commission-recovered.log"]) {
  const source = resolve(repo, "node_modules/.cache", name); if (existsSync(source)) cpSync(source, resolve(root, name));
}
cpSync(root, destination, { recursive: true });
console.log(JSON.stringify(summary, null, 2));
