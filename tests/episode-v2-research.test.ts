import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { type EpisodeV2Job, type SourceRecords } from "../lib/episode-v2/contracts.ts";
import { createD1EpisodeStore, type EpisodeDatabase } from "../lib/episode-v2/persistence.ts";
import { POLL_INTERVAL_MS, runDurableStep, type StepFactory } from "../lib/episode-v2/runner.ts";
import { createSourceDiscoveryPlan } from "../lib/episode-v2/stages/source-discovery.ts";
import { createSourceReadingPlan } from "../lib/episode-v2/stages/source-reading.ts";
import { sourceReadingOutputSchema } from "../lib/episode-v2/prompts/research.ts";
import { latestArtifactRef } from "../lib/episode-v2/stage-helpers.ts";
import { discoveryFixture, readingFixture, researchAt, researchJob, researchUrls } from "./fixtures/research.ts";
import { prepareSourceAbandonment } from "../lib/episode-v2/source-abandonment.ts";
import { quoteOperation, createProviderAdapter } from "../lib/episode-v2/providers.ts";
import { reserveUsage, usageRecordSchema } from "../lib/episode-v2/usage.ts";

function harness(initial = researchJob()) {
  const sqlite = new DatabaseSync(":memory:"); let clock = researchAt;
  sqlite.exec("CREATE TABLE episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)");
  sqlite.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.userId, initial.status, JSON.stringify(initial), clock, clock);
  const db: EpisodeDatabase = { prepare(sql) {
    let values: (string | number | null)[] = [];
    const statement = { bind(...bound: (string | number | null)[]) { values = bound; return statement; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; },
    }; return statement;
  } };
  const store = createD1EpisodeStore(db, { now: () => clock });
  return { store, tick() { clock += POLL_INTERVAL_MS; }, options: { id: initial.id, userId: initial.userId, store,
    apiKey: "mock-only", now: () => clock },
    advance(plan: StepFactory, fetch: typeof globalThis.fetch) { return runDurableStep({ id: initial.id, userId: initial.userId, store, apiKey: "mock-only", now: () => clock, plan, fetch }); },
  };
}
const response = (value: unknown, action: "search" | "open_page", options: { queued?: boolean; failed?: boolean; url?: string; id?: string; observedUrls?: string[] } = {}) => new Response(JSON.stringify({
  id: options.id ?? "resp_research", status: options.queued ? "queued" : "completed", model: "gpt-6-luna", service_tier: "default",
  output: options.queued ? [] : [{ type: "web_search_call", status: options.failed ? "failed" : "completed", action: {
    type: action, ...(options.url ? { url: options.url } : {}), sources: (options.observedUrls ?? (action === "search" ? researchUrls : [])).map(url => ({ url, title: "Mock source" })),
  } }], output_text: JSON.stringify(value), usage: options.queued ? null : {
    input_tokens: 1400, output_tokens: 600, total_tokens: 2000,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 },
  },
}));
function sources(job: EpisodeV2Job): SourceRecords {
  return job.state.artifacts[latestArtifactRef(job, "source_records")!.id] as SourceRecords;
}
const discoveryFetch: typeof fetch = async () => response(discoveryFixture, "search");

test("discovery and reading omit self relationships while preserving links to other saved sources", async () => {
  const h = harness(), discovery = structuredClone(discoveryFixture);
  discovery.candidates[0].relationships = [{ url: researchUrls[0], relation: "related", note: "Redundant self link" },
    { url: researchUrls[2], relation: "related", note: "Relevant correction" }];
  const found = await h.advance(createSourceDiscoveryPlan, async () => response(discovery, "search"));
  assert.deepEqual(sources(found.job!).data.sources[0].relationships, [{ sourceId: "source-3", relation: "related", note: "Relevant correction" }]);
  const reading = readingFixture(0);
  reading.relationships = [{ url: researchUrls[0], relation: "same_study", note: "Same page" },
    { url: researchUrls[2], relation: "related", note: "Relevant correction" }];
  const read = await h.advance(createSourceReadingPlan, async () => response(reading, "open_page", { url: researchUrls[0] }));
  assert.equal(sources(read.job!).data.sources[0].relationships!.some(link => link.sourceId === "source-1"), false);
  assert.equal(sources(read.job!).data.sources[0].relationships!.some(link => link.sourceId === "source-3"), true);
});

async function interruptedSource() {
  const h = harness(); await h.advance(createSourceDiscoveryPlan, discoveryFetch);
  const result = await h.advance(createSourceReadingPlan, async () => { throw new Error("Mock interrupted source POST"); });
  const job = result.job!, previous = sources(job);
  return { job, previous, decision: { stepKey: `research.read:${previous.version + 1}:source-1`, at: new Date(researchAt).toISOString(),
    reason: "Discard the unknown result and continue using other sources, keeping the full allowance.", authorization: "Explicit fixture approval with the existing cap." } };
}

test("explicit source abandonment keeps unknown usage reserved, preserves unread evidence and advances to another source", async () => {
  const { job, previous, decision } = await interruptedSource(), before = JSON.stringify(job);
  const next = prepareSourceAbandonment(job, previous, decision), abandoned = next.state.usageLedger!.records.at(-1)!;
  const priorRecord = job.state.usageLedger!.records.at(-1)!;
  assert.equal(JSON.stringify(job), before);
  assert.equal(next.config.limits.spendCeilingUsd, job.config.limits.spendCeilingUsd);
  assert.equal(abandoned.outcome, "uncertain"); assert.equal(abandoned.responseId, null); assert.equal(abandoned.estimatedUsd, null);
  assert.equal(abandoned.allowanceUsd, priorRecord.reservedUsd); assert.deepEqual(abandoned.reported, priorRecord.reported);
  assert.equal(next.state.execution!.steps[decision.stepKey].phase, "failed");
  const skipped = sources(next);
  assert.deepEqual(skipped.data.research!.skippedSourceIds, ["source-1"]);
  assert.equal(skipped.data.research!.readSourceIds.includes("source-1"), false);
  assert.equal(skipped.data.sources[0].readingCoverage, previous.data.sources[0].readingCoverage);
  assert.deepEqual(skipped.data.sources[0].passages, previous.data.sources[0].passages);
  const h = harness(next); let calls = 0;
  const result = await h.advance(createSourceReadingPlan, async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    assert.match(body.input, /Open and read this source URL: https:\/\/example.org\/report/);
    return response(readingFixture(1), "open_page", { url: researchUrls[1] });
  });
  assert.equal(calls, 1); assert.deepEqual(sources(result.job!).data.research!.readSourceIds, ["source-2"]);
  assert.equal(result.job!.state.usageLedger!.records.find(record => record.id === abandoned.id)!.allowanceUsd, priorRecord.reservedUsd);
});

test("abandonment requires a current unknown source and recorded authorization; it cannot release money or retry that ID", async () => {
  const { job, previous, decision } = await interruptedSource();
  const interruptedReservation = structuredClone(job); interruptedReservation.state.usageLedger!.records.at(-1)!.outcome = "reserved";
  const resolved = prepareSourceAbandonment(interruptedReservation, previous, decision);
  assert.equal(resolved.state.usageLedger!.records.at(-1)!.outcome, "uncertain");
  assert.equal(resolved.state.usageLedger!.records.at(-1)!.allowanceUsd, job.state.usageLedger!.records.at(-1)!.reservedUsd);
  for (const patch of [{ authorization: " " }, { reason: " " }, { stepKey: "different" }]) {
    assert.throws(() => prepareSourceAbandonment(job, previous, { ...decision, ...patch }));
  }
  const known = structuredClone(job); known.state.usageLedger!.records.at(-1)!.responseId = "resp_known";
  assert.throws(() => prepareSourceAbandonment(known, previous, decision));
  const bound = structuredClone(job); bound.state.usageLedger!.records.at(-1)!.boundExceeded = true;
  assert.throws(() => prepareSourceAbandonment(bound, previous, decision));
  const next = prepareSourceAbandonment(job, previous, decision), record = next.state.usageLedger!.records.at(-1)!;
  assert.equal(usageRecordSchema.safeParse({ ...record, allowanceUsd: 0 }).success, false);
  assert.equal(usageRecordSchema.safeParse({ ...record, outcome: "completed" }).success, false);
  const plan = await createSourceReadingPlan(next, async ref => next.state.artifacts[ref.id]);
  let calls = 0;
  const adapter = createProviderAdapter({ apiKey: "mock-only", fetch: async () => { calls++; throw new Error("Must not submit"); } });
  await assert.rejects(adapter.retrieve({ ...plan.request, id: record.id }, next.state.usageLedger!, async () => {}));
  assert.equal(calls, 0);
  const quote = quoteOperation({ id: "new-source", role: "source", kind: "source" }, record.settings, decision.at);
  const cap = record.reservedUsd + quote.reservedUsd - 0.01;
  const ledger = { ...structuredClone(next.state.usageLedger!), spendCeilingUsd: cap,
    allocations: { research: cap, text: 0, review: 0, audio: 0 }, records: [record] };
  assert.throws(() => reserveUsage(ledger, quote), /Insufficient allowance/);
});

test("discovery saves observed identities, same-study relationships, correction and a bounded coverage plan", async () => {
  const h = harness();
  const result = await h.advance(createSourceDiscoveryPlan, async (_url, init) => {
    const request = JSON.parse(String(init?.body)), input = JSON.parse(request.input);
    assert.equal(request.tool_choice, "required"); assert.equal(request.max_tool_calls, 1);
    assert.equal(input.maximumCandidates, 16); assert.equal(input.allowance.remainingSearchCalls, 4);
    assert.equal(input.savedResearch, null); return response(discoveryFixture, "search");
  });
  assert.equal(result.job!.substep, "read");
  const saved = sources(result.job!); assert.equal(saved.data.sources.length, 4);
  assert.equal(saved.data.sources[0].readingCoverage, "snippet");
  assert.equal(saved.data.sources[0].publicationStatus, "corrected");
  assert.equal(saved.data.sources[0].notices[0].url, researchUrls[2]);
  assert.equal(saved.data.sources[1].evidenceFamilyId, saved.data.sources[0].evidenceFamilyId);
  assert.equal(saved.data.sources[1].relationships![0].sourceId, saved.data.sources[0].id);
  assert.deepEqual(saved.data.research!.pendingSourceIds, saved.data.sources.map(source => source.id));
  assert.equal(saved.data.research!.coverageRationale, discoveryFixture.coverageRationale);
  assert.equal(saved.data.sources[0].accessedAt, new Date(researchAt).toISOString());
  assert.equal(saved.provenance.usageRecordIds.length, 1);
});

test("one source reading per durable step keeps passages and locators and preserves correction status", async () => {
  const h = harness(); await h.advance(createSourceDiscoveryPlan, discoveryFetch);
  const result = await h.advance(createSourceReadingPlan, async (_url, init) => {
    const request = JSON.parse(String(init?.body)); assert.match(request.input, /Open and read this source URL: https:\/\/example.org\/study/);
    return response(readingFixture(0), "open_page", { url: researchUrls[0] });
  });
  const saved = sources(result.job!); assert.equal(saved.version, 2);
  assert.equal(saved.data.sources[0].readingCoverage, "partial");
  assert.equal(saved.data.sources[0].passages[0].locator, "Results, paragraph 3");
  assert.equal(saved.data.sources[0].publicationStatus, "corrected");
  assert.deepEqual(saved.data.research!.readSourceIds, ["source-1"]);
  assert.deepEqual(saved.data.research!.pendingSourceIds, ["source-2", "source-3", "source-4"]);
  assert.equal((result.job!.state.artifacts["source-records:1"] as SourceRecords).data.sources[0].readingCoverage, "snippet");
});

test("failed exact source opening records inaccessible without turning its discovery snippet into evidence", async () => {
  const h = harness(); await h.advance(createSourceDiscoveryPlan, discoveryFetch);
  for (let index = 0; index < 3; index++) await h.advance(createSourceReadingPlan, async () => response(readingFixture(index), "open_page", { url: researchUrls[index] }));
  const result = await h.advance(createSourceReadingPlan, async () => response(readingFixture(3, true), "open_page", { url: researchUrls[3], failed: true }));
  const saved = sources(result.job!), source = saved.data.sources[3];
  assert.equal(source.readingCoverage, "inaccessible"); assert.equal(source.passages.length, 1);
  assert.equal(source.passages[0].coverage, "snippet"); assert.match(source.accessNote, /could not be opened/);
  assert.equal(result.job!.substep, "synthesize"); assert.equal(saved.data.research!.stopReason, "coverage");
  assert.deepEqual(saved.data.research!.pendingSourceIds, []);
});

test("failed opening cannot produce read passages or claim full reading", async () => {
  const h = harness(); await h.advance(createSourceDiscoveryPlan, discoveryFetch);
  const result = await h.advance(createSourceReadingPlan, async () => response(readingFixture(0), "open_page", { url: researchUrls[0], failed: true }));
  assert.equal(result.job!.pause!.code, "needs_input");
  assert.equal(sources(result.job!).version, 1);
});

test("an inaccessible correction remains attached and rediscovery updates known publication and family metadata", async () => {
  const h = harness(); await h.advance(createSourceDiscoveryPlan, discoveryFetch);
  for (let index = 0; index < 4; index++) {
    const output = readingFixture(index, index === 2);
    output.gaps = ["A later publication-status notice remains to be checked."];
    const result = await h.advance(createSourceReadingPlan, async () => response(output, "open_page", { url: researchUrls[index], failed: index === 2 }));
    assert.equal(sources(result.job!).data.sources[0].publicationStatus, "corrected");
  }
  const discovered = structuredClone(discoveryFixture.candidates[0]);
  discovered.publicationStatus = "retracted";
  discovered.evidenceFamilyId = "resolved-study-identity";
  discovered.notices = [{ type: "retraction", url: "https://example.org/retraction", note: "A later publication-status notice." }];
  const result = await h.advance(createSourceDiscoveryPlan, async () => response({ candidates: [discovered], coverageRationale: "Retraction found for the known study.", gaps: ["The retraction needs editorial review."] }, "search"));
  const source = sources(result.job!).data.sources[0];
  assert.equal(source.publicationStatus, "retracted");
  assert.equal(source.evidenceFamilyId, "resolved-study-identity");
  assert.equal(sources(result.job!).data.sources[1].evidenceFamilyId, source.evidenceFamilyId);
  assert.ok(source.notices.some(notice => notice.type === "retraction"));
  assert.equal(source.readingCoverage, "partial");
});

test("snippet and abstract coverage cannot be promoted to full text by a label", () => {
  const reading = readingFixture(0);
  reading.readingCoverage = "full"; reading.fullTextAvailable = true;
  reading.passages = [{ text: "Snippet text", locator: "Search result", coverage: "snippet" }];
  assert.equal(sourceReadingOutputSchema.safeParse(reading).success, false);
  reading.passages[0].coverage = "abstract";
  assert.equal(sourceReadingOutputSchema.safeParse(reading).success, false);
  reading.passages[0].coverage = "body"; reading.fullTextAvailable = false;
  assert.equal(sourceReadingOutputSchema.safeParse(reading).success, false);
});

test("unobserved discovery URLs and a substituted reading destination cannot enter saved research", async () => {
  const h = harness();
  const result = await h.advance(createSourceDiscoveryPlan, async () => response(discoveryFixture, "search", { observedUrls: [researchUrls[0]] }));
  assert.equal(result.job!.pause!.code, "needs_input"); assert.equal(latestArtifactRef(result.job!, "source_records"), undefined);
  const next = harness(); await next.advance(createSourceDiscoveryPlan, discoveryFetch);
  const read = await next.advance(createSourceReadingPlan, async () => response(readingFixture(0), "open_page", { url: "https://example.org/other" }));
  assert.equal(read.job!.state.usageLedger!.records[1].error!.code, "source_not_opened");
  assert.equal(sources(read.job!).version, 1);
});

test("research stops at the configured reading allowance with unresolved candidates retained", async () => {
  const initial = researchJob(); initial.config.limits.maxSourceReads = 1; initial.state.usageLedger!.maxSourceReads = 1;
  const limited = structuredClone(discoveryFixture); limited.candidates = [limited.candidates[0], limited.candidates[1]];
  const h = harness(initial); await h.advance(createSourceDiscoveryPlan, async () => response(limited, "search"));
  const result = await h.advance(createSourceReadingPlan, async () => response(readingFixture(0), "open_page", { url: researchUrls[0] }));
  assert.equal(result.job!.substep, "synthesize");
  assert.equal(sources(result.job!).data.research!.stopReason, "allowance");
  assert.deepEqual(sources(result.job!).data.research!.pendingSourceIds, ["source-2"]);
  assert.equal(result.job!.state.usageLedger!.records.length, 2);
});

test("empty discovery records an honest no-candidates stop without a fixed three-source quota", async () => {
  const h = harness(); const result = await h.advance(createSourceDiscoveryPlan, async () => response({ candidates: [], coverageRationale: "No useful source was observed.", gaps: ["Central question remains unsupported."] }, "search"));
  assert.equal(result.job!.substep, "synthesize"); assert.equal(sources(result.job!).data.sources.length, 0);
  assert.equal(sources(result.job!).data.research!.stopReason, "no_candidates");
});

for (const kind of ["discovery", "reading"] as const) test(`${kind} resumes the same request fingerprint after a pending reservation and uses GET only`, async () => {
  const h = harness(); if (kind === "reading") await h.advance(createSourceDiscoveryPlan, discoveryFetch);
  const factory = kind === "discovery" ? createSourceDiscoveryPlan : createSourceReadingPlan;
  const calls: string[] = []; const transport: typeof fetch = async (_url, init) => {
    calls.push(init!.method!); return response(kind === "discovery" ? discoveryFixture : readingFixture(0), kind === "discovery" ? "search" : "open_page", {
      queued: init?.method === "POST", url: kind === "reading" ? researchUrls[0] : undefined,
    });
  };
  const pending = await h.advance(factory, transport); assert.equal(pending.job!.status, "running");
  h.tick(); const completed = await h.advance(factory, transport);
  assert.equal(completed.disposition, "saved"); assert.equal(completed.job!.status, "running");
  assert.equal(sources(completed.job!).version, kind === "discovery" ? 1 : 2);
  assert.deepEqual(calls, ["POST", "GET"]);
  assert.equal(completed.job!.state.usageLedger!.records.length, kind === "discovery" ? 1 : 2);
});
