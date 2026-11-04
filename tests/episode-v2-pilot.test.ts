import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createTextPilot } from "../lib/episode-v2/app-controls.ts";
import { quoteOperation } from "../lib/episode-v2/providers.ts";
import { pilotUsageReport, prepareKnownResponseReconciliation } from "../lib/episode-v2/pilot-report.ts";
import { createPilotDatabase, withPilotDatabase } from "../scripts/pilot-storage.ts";
import { createD1EpisodeStore } from "../lib/episode-v2/persistence.ts";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { pilotHttpMetadata } from "../scripts/pilot-http.ts";

test("pilot HTTP recovery metadata preserves identifiers without consuming or copying the provider body", async () => {
  const value = { id: "resp_saved123", secret: "fixture-never-copy", output_text: "Private dialogue" };
  const response = new Response(JSON.stringify(value), { headers: { "x-request-id": "req_saved456" } });
  const metadata = await pilotHttpMetadata(response);
  assert.deepEqual(metadata, { responseId: "resp_saved123", providerRequestId: "req_saved456" });
  assert.doesNotMatch(JSON.stringify(metadata), /fixture-never-copy|Private dialogue/);
  assert.deepEqual(await response.json(), value);
});

test("pilot HTTP recovery metadata tolerates invalid bodies and rejects unrecognised identifier values", async () => {
  const response = new Response("not JSON", { headers: { "x-request-id": "fixture-never-copy" } });
  assert.deepEqual(await pilotHttpMetadata(response), {});
  assert.equal(await response.text(), "not JSON");
  assert.deepEqual(await pilotHttpMetadata(new Response(JSON.stringify({ id: "fixture-never-copy" }))), {});
});

test("pilot report preserves missing usage, held reservations and absent invoices", () => {
  const job = createTextPilot({ id: "pilot", userId: "owner", topic: "Fireflies", spendCeilingUsd: 5, now: 1 });
  const missing = quoteOperation({ id: "missing", role: "producer", kind: "structured" }, job.state.modelPolicy!.roles.producer!, new Date().toISOString());
  missing.outcome = "uncertain";
  const known = structuredClone(missing); known.id = "known"; known.outcome = "completed";
  known.reported.inputTokens = 100; known.reported.outputTokens = 20; known.reported.reasoningTokens = 10;
  known.estimatedUsd = .001; known.allowanceUsd = .002; known.unknownCosts = ["Cache details not reported"];
  job.state.usageLedger!.records.push(missing, known);
  const report = pilotUsageReport(job);
  assert.equal(report.operations, 2);
  assert.equal(report.cost.billedUsd, null);
  assert.deepEqual(report.cost.missingEstimates, ["missing"]);
  assert.equal(report.cost.estimatedReportedSubtotalUsd, .001);
  assert.equal(report.cost.heldAllowanceUsd, missing.reservedUsd + .002);
  assert.deepEqual(report.observed.inputTokens, { reportedSubtotal: 100, missingOperations: ["missing"] });
  assert.equal(report.observed.outputTokens.reportedSubtotal, 20);
  assert.equal(report.observed.reasoningTokens.reportedSubtotal, 10);
  assert.deepEqual(report.recovery, [{ operationId: "missing", outcome: "uncertain", hasResponseId: false, boundExceeded: false }]);
  assert.equal(report.cost.gaps.length, 2);
});

test("preflight runs with a credential present but makes no calls or live authorization", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-text-pilot.ts", "--topic", "How do fireflies make light?"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10_000,
    env: { ...process.env, OPENAI_API_KEY: "fixture-never-send" },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.providerCalls, 0); assert.equal(output.spendingCeilingUsd, null);
  assert.equal(output.mode, "preflight-only"); assert.equal(output.allocations.audio, 0);
  assert.ok(output.quotes.some((quote: { role: string; reservationUsd: number }) => quote.role === "research" && quote.reservationUsd > 0));
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-never-send/);
});

test("live runner rejects absent spending authorization before storage or provider work", () => {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/run-text-pilot.ts", "--run", "--topic", "Fireflies"], {
    cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 10_000,
    env: { ...process.env, OPENAI_API_KEY: "fixture-never-send" },
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires --ceiling/);
  assert.doesNotMatch(result.stdout + result.stderr, /fixture-never-send/);
});

test("explicit reconciliation preserves the failed record and bound until its known response is retrieved", () => {
  const job = createTextPilot({ id: "pilot", userId: "owner", topic: "Fireflies", spendCeilingUsd: 5, now: 1 });
  const record = quoteOperation({ id: "saved", role: "producer", kind: "structured" }, job.state.modelPolicy!.roles.producer!, new Date().toISOString());
  record.outcome = "completed"; record.boundExceeded = true; record.responseId = "resp_known";
  record.error = { code: "reservation_exceeded", category: "configuration", message: "Count needs review", ambiguous: false };
  job.state.usageLedger!.records.push(record);
  job.status = "paused"; job.pause = { code: "needs_input", reason: "Review" };
  job.state.execution = { revision: 1, steps: { current: { id: "saved", key: "current", step: { stage: "commission", substep: "produce" },
    inputHash: "a".repeat(64), inputs: [], prompt: { id: "producer", version: "1" }, phase: "failed", usageRecordId: "saved", resultRefs: [], createdAt: 1, updatedAt: 2 } } };
  const next = prepareKnownResponseReconciliation(job, "current");
  assert.equal(job.state.execution.steps.current.phase, "failed");
  assert.equal(next.state.execution!.steps.current.phase, "uncertain");
  assert.equal(next.state.usageLedger!.records[0].responseId, "resp_known");
  assert.equal(next.state.usageLedger!.records[0].boundExceeded, true);
  assert.equal(next.config.limits.spendCeilingUsd, 5);
  assert.equal(next.state.usageLedger!.records.length, 1);
  assert.throws(() => prepareKnownResponseReconciliation(job, "different"));
  record.responseId = null;
  assert.throws(() => prepareKnownResponseReconciliation(job, "current"));
});

test("local pilot saves and releases its lease after workspace synchronization replaces the database inode", async () => {
  mkdirSync(".episode-cache", { recursive: true });
  const directory = mkdtempSync(resolve(".episode-cache/pilot-storage-")), file = resolve(directory, "run.sqlite");
  try {
    const DB = createPilotDatabase(file), store = createD1EpisodeStore(DB);
    const job = createTextPilot({ id: "pilot", userId: "owner", topic: "Fireflies", spendCeilingUsd: 5, now: Date.now() });
    withPilotDatabase(file, db => db.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(job.id, job.userId, job.userId, job.status, JSON.stringify(job), job.createdAt, job.updatedAt));
    const lease = (await store.claim(job.id, job.userId))!;
    writeFileSync(file + ".replacement", readFileSync(file)); renameSync(file + ".replacement", file);
    const next = structuredClone(lease.job); next.status = "paused"; next.pause = { code: "user_paused", reason: "Keep saved work" };
    await store.save(lease, next); await store.release(lease);
    assert.equal((await store.read(job.id, job.userId))!.pause?.code, "user_paused");
    const second = await createD1EpisodeStore(createPilotDatabase(file)).claim(job.id, job.userId);
    assert.ok(second); await store.release(second);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
