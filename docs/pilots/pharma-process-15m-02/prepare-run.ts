// One-use, reproducible preparation for the explicitly requested research-reuse pilot.
// Run from the repository with node --env-file=.env.local --experimental-strip-types <this file>.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTextPilot } from "../../../lib/episode-v2/app-controls.ts";
import { assertJobTransition, episodeV2JobSchema, sourceRecordsSchema } from "../../../lib/episode-v2/contracts.ts";
import { canonicalJson, createD1EpisodeStore, readArtifact, saveArtifact, sha256, type ArtifactBucket } from "../../../lib/episode-v2/persistence.ts";
import { allowanceUsed } from "../../../lib/episode-v2/usage.ts";
import { artifactRef, requireLatestArtifact } from "../../../lib/episode-v2/stage-helpers.ts";
import { createProducerPlan } from "../../../lib/episode-v2/stages/producer.ts";
import { runDurableStep } from "../../../lib/episode-v2/runner.ts";
import { pilotUsageReport } from "../../../lib/episode-v2/pilot-report.ts";
import { pilotHttpMetadata } from "../../../scripts/pilot-http.ts";
import { createPilotDatabase, withPilotDatabase } from "../../../scripts/pilot-storage.ts";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const previousRoot = resolve(repo, "docs/pilots/pharma-process-15m-01");
const root = resolve(repo, "node_modules/.cache/still-curious-pharma-reuse-02");
if (!process.env.OPENAI_API_KEY) throw new Error("The approved existing credential is unavailable.");
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const old = episodeV2JobSchema.parse(readJson(resolve(previousRoot, "job.json")));
const oldHeld = allowanceUsed(old.state.usageLedger!);
const ceiling = Math.floor((5 - oldHeld) * 100) / 100;
if (ceiling <= 0) throw new Error("No allowance remains under the combined $5 cap.");
function bucketAt(base: string): ArtifactBucket {
  const path = (key: string) => { const p = resolve(base, "objects", key); if (!p.startsWith(resolve(base, "objects") + sep)) throw new Error("Invalid owned object path"); return p; };
  return { async put(key, value) { const p = path(key); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, value); },
    async get(key) { const p = path(key); if (!existsSync(p)) return null; const b = readFileSync(p); return { size: b.length, async arrayBuffer() { return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; } }; } };
}
const oldBucket = bucketAt(previousRoot), bucket = bucketAt(root);
const sources = await requireLatestArtifact(old, ref => readArtifact(old, ref, oldBucket), "source_records");
const originals = [...Object.values(old.state.artifacts).map(artifactRef), ...Object.values(old.state.artifactBlobs ?? {}).map(blob => blob.artifact)];
for (const ref of originals) await readArtifact(old, ref, oldBucket);
mkdirSync(root, { recursive: true });
const dbPath = resolve(root, "run.sqlite"), db = createPilotDatabase(dbPath), store = createD1EpisodeStore(db);
const rows = withPilotDatabase(dbPath, db => db.prepare("SELECT job_json FROM episodes").all()) as { job_json: string }[];
if (rows.length > 1) throw new Error("Only one pilot belongs in this directory.");
let job = rows.length ? episodeV2JobSchema.parse(JSON.parse(rows[0].job_json)) : null;
const save = (name: string, value: unknown) => writeFileSync(resolve(root, name), JSON.stringify(value, null, 2));
if (!job) {
  const at = new Date().toISOString();
  job = createTextPilot({ id: crypto.randomUUID(), userId: "local-measured-pilot", topic: old.topic, lengthMinutes: 15, spendCeilingUsd: ceiling, now: Date.now() });
  // Reused research needs synthesis only. Retain review headroom and put the rest into dialogue.
  job.state.usageLedger!.allocations = { research: .50, text: ceiling - 1.20, review: .70, audio: 0 };
  // The commission goes directly to synthesis; post-conversation retrieval is disabled.
  job.config.limits.maxPostConversationSourceReads = 0;
  const data = structuredClone(sources.data), epa = data.sources.find(source => source.id === "source-1")!;
  // These two passages were read and verified in the immediately preceding editorial turn.
  // They are not new searches, new source opens, or an assertion of fresh access now.
  epa.passages.push(
    { id: "epa-prior-verification-initial-activity", coverage: "body", locator: "2010 award account, Summary of Technology, paragraphs 3–4; previously verified in this conversation",
      text: "Merck's tests of available transaminases failed to identify an enzyme with any detectable activity on the sitagliptin ketone. Starting from an R-selective transaminase with some slight activity on a smaller, truncated methyl ketone analog of the sitagliptin ketone, Codexis evolved a biocatalyst to enable a new manufacturing process to supplant the hydrogenation route." },
    { id: "epa-prior-verification-purification", coverage: "body", locator: "2010 award account, Summary of Technology, paragraph 5; previously verified in this conversation",
      text: "The streamlined, enzymatic process eliminates the high-pressure hydrogenation, all metals (rhodium and iron), and the wasteful chiral purification step." });
  epa.qualifications = [...(epa.qualifications ?? []), "This is the 2010 award account; a later webpage update does not make its commercialization plans current. Activity improvement is not manufacturing yield or a ratio with a zero denominator."];
  epa.accessNote += " Reuse snapshot includes two omitted passages verified in the preceding editorial turn at this same URL; no new access in this run.";
  data.sources.push({ id: "codexis-2021-prior-verification", title: "Codexis and Merck Amend and Extend Supply Agreement for Enzyme Used in Manufacture of Sitagliptin",
    url: "https://ir.codexis.com/news-events/press-releases/detail/303/codexis-and-merck-amend-and-extend-supply-agreement-forenzyme-used-in-manufacture-of-sitagliptin",
    authors: ["Codexis, Inc."], publishedOn: "2021-09-09", accessedAt: at, sourceType: "institutional", evidenceFamilyId: "codexis-commercial-supply-history",
    publicationStatus: "published", notices: [], readingCoverage: "partial",
    accessNote: "Prepared from the source body already read in the immediately preceding editorial turn. accessedAt records this reuse snapshot, not a new fetch. See the prior pilot correction record and origin manifest.",
    qualifications: ["Company announcement establishes its reported commercial supply history and agreement terms, not an independent audit of process performance or proof of uninterrupted current supply or renewal."],
    passages: [{ id: "codexis-prior-commercial-history", coverage: "body", locator: "Release dated 9 September 2021, introductory paragraph and agreement-history paragraph",
      text: "Codexis announced the amendment and extension of its agreement with Merck to license and supply a proprietary enzyme used in the manufacturing process for sitagliptin. In 2012 Codexis and Merck entered into a supply agreement for the enzyme and in 2015 signed a multi-year extension, which was to expire in February 2022. This subsequent extension and amendment is for the license and supply of the proprietary enzyme through December 31, 2026. The extension can be renewed for an additional 5 years upon mutual agreement by both companies." }] });
  data.research = { commission: { id: "research-commission:1", kind: "research_commission", version: 1 }, discoveryRounds: 0,
    readSourceIds: data.sources.filter(s => ["abstract", "partial", "full"].includes(s.readingCoverage)).map(s => s.id),
    pendingSourceIds: [], skippedSourceIds: data.sources.filter(s => !["abstract", "partial", "full"].includes(s.readingCoverage)).map(s => s.id),
    coverageRationale: "Explicit user-directed reuse of saved research and corrections verified before this run. No new discovery or source reads. Refresh the commission, synthesis, cast and preparation; do not reuse earlier dialogue or guest answers.",
    gaps: ["The collection does not reconstruct all engineering rounds, developers' private decisions, a complete isolation sequence or repeated-batch records. Do not imply the whole field lacks this information.", "The 2021 agreement announcement is later history, not fresh confirmation of supply today."], stopReason: "coverage" };
  const snapshot = sourceRecordsSchema.parse({ schemaVersion: 2, pipelineVersion: 2, id: "reused-source-records:1", kind: "source_records", version: 1, createdAt: at,
    provenance: { inputVersions: [], editorialVersion: "manual-prior-research-reuse-1", prompt: null, modelConfiguration: null, usageRecordIds: [] }, data });
  await saveArtifact(job, snapshot, bucket);
  save("research-reuse-origin.json", { preparedAt: at, previousEpisodeId: old.id, previousSourceReference: artifactRef(sources),
    previousSourceSha256: await sha256(canonicalJson(sources)), previousVerifiedArtifacts: originals.length,
    originalSourceDataUnchangedInPriorRun: true, reusedSourceReference: artifactRef(snapshot), reusedSourceSha256: await sha256(canonicalJson(snapshot)),
    correctionsFile: "../pharma-process-15m-01/corrections.md", correctionFileSha256: await sha256(readFileSync(resolve(previousRoot, "corrections.md"), "utf8")),
    priorWebReferences: ["turn15view0", "turn15view1"], newlyFetchedSources: 0,
    note: "All original records retained; two previously verified EPA passages and the previously verified 2021 Codexis announcement added. Original and new timestamps are distinguished in access notes." });
  save("authorization.json", { userRequest: "Do a 15 minute run about pharmaceutical process development and chemistry. Use the existing research.",
    previousCapInstruction: "Whatever you think best. Keep $5 cap", combinedCapUsd: 5, priorConservativeAllowanceUsd: oldHeld, newRunCeilingUsd: ceiling,
    conservativeCombinedMaximumUsd: oldHeld + ceiling, existingKeyReusePreviouslyAuthorized: true, audioAuthorized: false, newRetrievalAuthorized: false,
    newRunAllocations: job.state.usageLedger!.allocations });
  withPilotDatabase(dbPath, db => db.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(job!.id, job!.userId, job!.userId, job!.status, JSON.stringify(job), job!.createdAt, job!.updatedAt));
}
if (job.config.limits.spendCeilingUsd !== ceiling || job.lengthMinutes !== 15 || job.topic !== old.topic) throw new Error("Saved run inputs changed.");
const journalFile = resolve(root, "http-journal.json"), journal: Record<string, unknown>[] = existsSync(journalFile) ? readJson(journalFile) : [];
const transport: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  if (url.origin !== "https://api.openai.com") throw new Error("Unexpected provider origin");
  if (init?.method === "POST" && JSON.parse(String(init.body)).tools?.length) throw new Error("This run must reuse existing research without new tool calls.");
  const item: Record<string, unknown> = { method: init?.method ?? "GET", startedAt: new Date().toISOString(), status: null, finishedAt: null };
  journal.push(item); save("http-journal.json", journal);
  try { const result = await fetch(input, init); Object.assign(item, { status: result.status }, await pilotHttpMetadata(result));
    if (item.method === "POST" || !result.ok) console.log(JSON.stringify({ event: "provider_http", ...item })); return result;
  } finally { item.finishedAt = new Date().toISOString(); save("http-journal.json", journal); }
};
let last = "";
for (let ticks = 0; ticks < 512 && job.stage === "commission" && (job.status === "running" || job.pause?.code === "ambiguous_provider_result"); ticks++) {
  await runDurableStep({ id: job.id, userId: job.userId, store, bucket, apiKey: process.env.OPENAI_API_KEY!, fetch: transport,
    async plan(saved, read) {
      const source = await requireLatestArtifact(saved, read, "source_records"), plan = await createProducerPlan(saved);
      plan.inputs = [artifactRef(source)];
      plan.request.input = JSON.stringify({ ...JSON.parse(plan.request.input), availableSavedResearch: { reference: artifactRef(source), ...source.data },
        researchReuseRequest: "The listener explicitly requested reuse of this collection, including already verified corrections. Commission a focused episode it can support; no new searches or source opens will occur." });
      return plan;
    } });
  job = (await store.read(job.id, job.userId))!;
  save("job.json", job); save("usage-report.json", pilotUsageReport(job));
  const progress = JSON.stringify({ episodeId: job.id, stage: `${job.stage}.${job.substep}`, status: job.status, operations: job.state.usageLedger!.records.length, allowanceUsd: allowanceUsed(job.state.usageLedger!) });
  if (last !== progress) { console.log(progress); last = progress; }
  if (job.stage === "commission" && job.status === "running") await new Promise(resolve => setTimeout(resolve, 2000));
}
if (job.status === "running" && job.stage === "research" && job.substep === "discover") {
  const lease = await store.claim(job.id, job.userId);
  if (!lease) throw new Error("Pilot is busy before the explicit research-reuse transition.");
  try {
    const next = structuredClone(lease.job);
    next.substep = "synthesize";
    next.state.usageLedger!.allocations = { research: .50, text: ceiling - 1.20, review: .70, audio: 0 };
    assertJobTransition(lease.job, next);
    await store.save(lease, next); job = next;
    save("research-reuse-transition.json", { from: "research.discover", to: "research.synthesize", providerCalls: 0,
      reason: "Explicit user-directed reuse of already verified saved research.", allocations: next.state.usageLedger!.allocations });
    save("job.json", job); save("usage-report.json", pilotUsageReport(job));
  } finally { await store.release(lease); }
}
console.log(JSON.stringify({ prepared: job.stage === "research" && job.substep === "synthesize", root, episodeId: job.id, status: job.status, pause: job.pause ?? null }));
