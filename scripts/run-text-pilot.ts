import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";
import { parseArgs } from "node:util";
import { createTextPilot, parseTextPilotBudget, applyTextPilotControl, textPilotActions } from "../lib/episode-v2/app-controls.ts";
import { createD1EpisodeStore, readArtifact, type ArtifactBucket } from "../lib/episode-v2/persistence.ts";
import { createPilotDatabase, withPilotDatabase } from "./pilot-storage.ts";
import { runDurableStep } from "../lib/episode-v2/runner.ts";
import { V2_STAGES } from "../lib/episode-v2/stages/index.ts";
import { quoteOperation } from "../lib/episode-v2/providers.ts";
import { transcriptExport, researchExport } from "../lib/episode-v2/exports.ts";
import { pilotUsageReport, prepareKnownResponseReconciliation } from "../lib/episode-v2/pilot-report.ts";
import type { Role } from "../lib/episode-v2/model-policy.ts";
import { episodeLengthSchema } from "../lib/episode-v2/config.ts";
import { pilotHttpMetadata } from "./pilot-http.ts";

const { values } = parseArgs({ options: { run: { type: "boolean", default: false }, topic: { type: "string" }, minutes: { type: "string", default: "5" }, ceiling: { type: "string" }, out: { type: "string" }, "reconcile-step": { type: "string" } } });
if (!values.topic?.trim() || values.topic.length > 500) throw new Error("Supply the agreed topic using --topic (1–500 characters).");
const ceiling = values.ceiling === undefined ? null : parseTextPilotBudget(Number(values.ceiling));
const lengthMinutes = episodeLengthSchema.parse(Number(values.minutes));
const candidate = createTextPilot({ id: "preflight", userId: "local-measured-pilot", topic: values.topic.trim(), lengthMinutes, spendCeilingUsd: ceiling, now: Date.now() });
if (!values.run) {
  console.log(JSON.stringify({ mode: "preflight-only", providerCalls: 0, topic: candidate.topic, spendingCeilingUsd: ceiling,
    selectedDuration: { lengthMinutes, profileVersion: candidate.config.profileVersion, targetDurationSeconds: candidate.config.targetDurationSeconds,
      introductionTargetSeconds: candidate.config.introductionTargetSeconds, spokenWordTarget: candidate.config.spokenWordTarget },
    allocations: candidate.state.usageLedger!.allocations,
    quotes: Object.entries(candidate.state.modelPolicy!.roles).map(([role, settings]) => {
      const quote = quoteOperation({ id: "preflight", role: role as Role,
        kind: role === "research" ? "research" : role === "source" ? "source" : "structured" }, settings, new Date().toISOString());
      return { role, model: settings.model, reservationUsd: quote.reservedUsd };
    }), notice: "Reservation headroom is not an expected charge. Live execution requires an explicitly approved ceiling and --run." }, null, 2));
  process.exit(0);
}
if (ceiling === null || !values.out || !process.env.OPENAI_API_KEY) throw new Error("Live execution requires --ceiling, --out and the existing OPENAI_API_KEY environment variable.");
const root = resolve(values.out);
mkdirSync(root, { recursive: true });
function save(name: string, value: unknown) {
  const file = resolve(root, name); writeFileSync(file + ".tmp", JSON.stringify(value, null, 2)); renameSync(file + ".tmp", file);
}
const databasePath = resolve(root, "run.sqlite"), DB = createPilotDatabase(databasePath);
const BUCKET: ArtifactBucket = {
  async put(key, value) { const file = objectPath(key); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file + ".tmp", value); renameSync(file + ".tmp", file); },
  async get(key) { const file = objectPath(key); if (!existsSync(file)) return null; const bytes = readFileSync(file); return { size: bytes.length, async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer; } }; },
};
function objectPath(key: string) { const base = resolve(root, "objects"), file = resolve(base, key); if (!file.startsWith(base + sep)) throw new Error("Invalid artifact path"); return file; }
const previous = withPilotDatabase(databasePath, database => database.prepare("SELECT job_json FROM episodes").all()) as { job_json: string }[];
if (previous.length > 1) throw new Error("Use one run directory per pilot.");
let job = previous.length ? await createD1EpisodeStore(DB).read(JSON.parse(previous[0].job_json).id, candidate.userId) : null;
if (job && (job.topic !== candidate.topic || job.lengthMinutes !== lengthMinutes || job.config.limits.spendCeilingUsd !== ceiling)) throw new Error("Saved inputs differ. Do not overwrite or silently increase an existing pilot.");
if (!job) {
  job = { ...candidate, id: crypto.randomUUID() };
  withPilotDatabase(databasePath, database => database.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(job!.id, job!.userId, job!.userId, job!.status, JSON.stringify(job), job!.createdAt, job!.updatedAt));
}
const journalFile = resolve(root, "http-journal.json");
type HttpEntry = { method: string; startedAt: string; finishedAt: string | null; status: number | null; responseId?: string; providerRequestId?: string };
const journal: HttpEntry[] = existsSync(journalFile) ? JSON.parse(readFileSync(journalFile, "utf8")) : [];
const transport: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== "https://api.openai.com") throw new Error("Unexpected provider origin");
  const entry: HttpEntry = { method: init?.method ?? "GET", startedAt: new Date().toISOString(), finishedAt: null, status: null };
  journal.push(entry); save("http-journal.json", journal);
  try {
    const response = await fetch(input, init); entry.status = response.status;
    Object.assign(entry, await pilotHttpMetadata(response));
    // Retain identifiers in the execution output as well as the workspace journal.
    if (entry.method === "POST" || !response.ok) console.log(JSON.stringify({ event: "provider_http", ...entry }));
    return response;
  }
  finally { entry.finishedAt = new Date().toISOString(); save("http-journal.json", journal); }
};
const store = createD1EpisodeStore(DB);
let lastProgress = "";
async function snapshot() {
  job = (await store.read(job!.id, job!.userId))!;
  save("job.json", job); save("usage-report.json", pilotUsageReport(job));
  const read = (ref: Parameters<typeof readArtifact>[1]) => readArtifact(job!, ref, BUCKET);
  const kinds = [...Object.values(job.state.artifacts), ...Object.values(job.state.artifactBlobs ?? {}).map(value => value.artifact)].map(value => value.kind);
  if (kinds.includes("transcript")) save("transcript.json", await transcriptExport(job, read));
  if (kinds.includes("source_records")) save("research.json", await researchExport(job, read));
}
try {
  await snapshot();
  if (values["reconcile-step"]) {
    const next = prepareKnownResponseReconciliation(job, values["reconcile-step"]);
    save("before-reconciliation.json", job);
    const lease = await store.claim(job.id, job.userId);
    if (!lease) throw new Error("Pilot is busy");
    try { await store.save(lease, next); } finally { await store.release(lease); }
    await snapshot();
  }
  // A new invocation is explicit recovery intent; only the existing safe control may reopen a hold.
  if (job.status === "paused" && textPilotActions(job).resume) {
    const lease = await store.claim(job.id, job.userId);
    if (!lease) throw new Error("Pilot is busy");
    try { await store.save(lease, applyTextPilotControl(lease.job, { action: "resume" })); } finally { await store.release(lease); }
    await snapshot();
  }
  for (let ticks = 0; ticks < 512 && (job.status === "running" || (ticks === 0 && values["reconcile-step"] && job.pause?.code === "ambiguous_provider_result")); ticks++) {
    const result = await runDurableStep({ id: job.id, userId: job.userId, store, bucket: BUCKET, apiKey: process.env.OPENAI_API_KEY!, fetch: transport,
      plan: (saved, read) => { const stage = V2_STAGES[`${saved.stage}.${saved.substep}`]; if (!stage) throw new Error("No text stage is registered"); return stage(saved, read); } });
    await snapshot();
    const report = pilotUsageReport(job);
    const progress = { episodeId: job.id, stage: `${job.stage}.${job.substep}`, status: job.status,
      operations: report.operations, estimatedUsd: report.cost.estimatedReportedSubtotalUsd, allowanceUsd: report.cost.heldAllowanceUsd };
    const serialized = JSON.stringify(progress);
    if (serialized !== lastProgress || ["busy", "stale", "cached"].includes(result.disposition)) {
      console.log(JSON.stringify({ ...progress, disposition: result.disposition })); lastProgress = serialized;
    }
    if (["busy", "stale", "cached"].includes(result.disposition)) break;
    if (job.status === "running") await new Promise(resolve => setTimeout(resolve, 2000));
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown local runner error";
  save("runner-error.json", { at: new Date().toISOString(), name: error instanceof Error ? error.name : "Error",
    message: message.replaceAll(process.env.OPENAI_API_KEY!, "[redacted]") });
  console.error("Pilot stopped. Saved state and usage are preserved; inspect the report before recovery."); process.exitCode = 1;
} finally { await snapshot(); }
