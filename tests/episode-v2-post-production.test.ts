import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { assertFinalScriptApproved, episodeV2JobSchema, type EpisodeArtifact, type EpisodeV2Job } from "../lib/episode-v2/contracts.ts";
import { createD1EpisodeStore, readArtifact, saveArtifact, type ArtifactBucket, type EpisodeDatabase } from "../lib/episode-v2/persistence.ts";
import { POLL_INTERVAL_MS, runDurableStep, type StepFactory } from "../lib/episode-v2/runner.ts";
import { createEditingPlan } from "../lib/episode-v2/stages/editing.ts";
import { createRepairPlan } from "../lib/episode-v2/stages/local-repair.ts";
import { createReviewPlan } from "../lib/episode-v2/stages/review.ts";
import { createReviewLookupPlan } from "../lib/episode-v2/stages/review-lookup.ts";
import { loadPostProduction } from "../lib/episode-v2/post-production.ts";
import { artifactRef } from "../lib/episode-v2/stage-helpers.ts";
import { acceptableReview, lightEdit, materialReview, postProductionFixture, postProductionSpeech, repairOutput } from "./fixtures/post-production.ts";
import { readingFixture, researchUrls } from "./fixtures/research.ts";

const at = Date.parse("2026-10-15T17:30:00Z");
function harness(initial: EpisodeV2Job) {
  const sqlite = new DatabaseSync(":memory:"); let clock = at;
  sqlite.exec("CREATE TABLE episodes (id TEXT PRIMARY KEY, user_id TEXT, active_user_id TEXT UNIQUE, status TEXT, job_json TEXT, lock_token TEXT, lock_until INTEGER, created_at INTEGER, updated_at INTEGER)");
  sqlite.prepare("INSERT INTO episodes VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?)").run(initial.id, initial.userId, initial.userId, initial.status, JSON.stringify(episodeV2JobSchema.parse(initial)), at, at);
  const db: EpisodeDatabase = { prepare(sql) {
    let values: (string | number | null)[] = [];
    const statement = { bind(...bound: (string | number | null)[]) { values = bound; return statement; },
      async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...values).changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...values) ?? null) as T | null; } };
    return statement;
  } };
  const store = createD1EpisodeStore(db, { now: () => clock });
  return { store, close: () => sqlite.close(), tick: () => { clock += POLL_INTERVAL_MS; },
    options: { id: initial.id, userId: initial.userId, store, apiKey: "mock-only", now: () => clock } };
}
type Observed = { method: string; body: Record<string, any>; input: Record<string, any> };
function response(value: unknown, model: string, id: string, status = "completed", output: unknown[] = []) {
  return new Response(JSON.stringify({ id, status, model, service_tier: "default", output, output_text: JSON.stringify(value),
    usage: status === "completed" ? { input_tokens: 6000, output_tokens: 600, total_tokens: 6600, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 } } : null }));
}
function transport(values: unknown[], observed: Observed[] = []): typeof fetch {
  let index = 0;
  return async (_url, init) => {
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init.body)), input = JSON.parse(body.input);
    observed.push({ method: init.method!, body, input });
    assert.equal(body.text.format.strict, true); assert.equal(body.background, true);
    assert.equal(body.tools, undefined, "Editing and review operate on the supplied evidence and closed episode");
    assert.ok(index < values.length, `Unexpected operation ${index + 1}`);
    return response(values[index++], body.model, `resp_post_production_${index}`);
  };
}
function latest<K extends EpisodeArtifact["kind"]>(job: EpisodeV2Job, kind: K): Extract<EpisodeArtifact, { kind: K }> {
  const found = Object.values(job.state.artifacts).filter(artifact => artifact.kind === kind).sort((a, b) => b.version - a.version)[0];
  assert.ok(found, `Missing ${kind}`); return found as Extract<EpisodeArtifact, { kind: K }>;
}
async function step(h: ReturnType<typeof harness>, plan: StepFactory, value: unknown, observed: Observed[] = []) {
  return runDurableStep({ ...h.options, plan, fetch: transport([value], observed) });
}
async function reviewedFixture(kind: "local" | "section" = "local") {
  const fixture = await postProductionFixture(kind), h = harness(fixture.job);
  await step(h, createEditingPlan, lightEdit());
  const reviewed = await step(h, createReviewPlan, materialReview(kind === "section" ? "revise_section" : "acceptable_with_local_edit"));
  assert.equal(reviewed.job!.substep, kind === "section" ? "section_revision" : "local_edit", reviewed.job!.pause?.reason);
  return { ...fixture, h, reviewed: reviewed.job! };
}

test("an acceptable episode with a harmless imprecision advances unchanged to the text checkpoint", async () => {
  const fixture = await postProductionFixture(), h = harness(fixture.job), observed: Observed[] = [];
  const original = structuredClone(fixture.transcript);
  try {
    const edited = await step(h, createEditingPlan, lightEdit(), observed);
    assert.equal(edited.job!.stage, "review"); assert.equal(edited.job!.substep, "assess");
    assert.deepEqual(latest(edited.job!, "edit_report").data.editedTurns, original.data.turns);
    const reviewed = await step(h, createReviewPlan, acceptableReview(), observed), job = reviewed.job!;
    assert.equal(job.stage, "ready_for_audio", job.pause?.reason); assert.equal(job.substep, "wait"); assert.equal(job.status, "paused"); assert.equal(job.pause!.code, "text_checkpoint");
    assert.deepEqual(job.state.artifacts[original.id], original);
    const final = latest(job, "final_script"), review = latest(job, "review"), edit = latest(job, "edit_report");
    assert.deepEqual(final.data.turns, original.data.turns); assert.deepEqual(job.state.finalScript, { id: final.id, kind: final.kind, version: final.version });
    assertFinalScriptApproved(final, review, edit);
    assert.equal(observed.length, 2); assert.equal(job.state.usageLedger!.records.length, 2);
    assert.deepEqual(observed[0].input.acceptedTranscript.turns, original.data.turns);
    for (const call of observed) {
      assert.deepEqual(call.input.narrativePlan, { reference: artifactRef(fixture.hostPlan),
        priorities: fixture.hostPlan.data.priorities, returnPoint: fixture.hostPlan.data.returnPoint,
        endingAim: fixture.hostPlan.data.endingAim });
    }
    for (const artifact of [edit, review]) assert.ok(artifact.provenance.inputVersions.some(ref =>
      ref.id === fixture.hostPlan.id && ref.version === fixture.hostPlan.version && ref.kind === "host_plan"));
    assert.match(observed[1].body.instructions, /whole/i);
    assert.match(observed[1].body.instructions, /percentage/i);
    const held = await runDurableStep({ ...h.options, plan: createReviewPlan, fetch: transport([], observed) });
    assert.equal(held.disposition, "waiting"); assert.equal(observed.length, 2);
  } finally { h.close(); }
});

test("post-production uses the recording's pinned plan and supports legacy recordings without one", async () => {
  const { job, read, hostPlan, transcript } = await postProductionFixture();
  const newer = structuredClone(hostPlan);
  newer.id = "host_plan:newer"; newer.version += 1;
  newer.data.priorities = ["A later plan must not replace the recording's intention."];
  job.state.artifacts[newer.id] = newer;
  const original = JSON.stringify(transcript);
  const context = await loadPostProduction(job, read);
  assert.deepEqual(context.commonInput.narrativePlan!.reference, artifactRef(hostPlan));
  assert.deepEqual(context.commonInput.narrativePlan!.priorities, hostPlan.data.priorities);
  assert.equal(JSON.stringify(transcript), original);
  transcript.provenance.inputVersions = transcript.provenance.inputVersions.filter(ref => ref.kind !== "host_plan");
  const legacy = await loadPostProduction(job, read);
  assert.equal(legacy.commonInput.narrativePlan, null);
  assert.equal(legacy.inputs.some(ref => ref.kind === "host_plan"), false);
});

test("post-production refuses a pinned plan with a different foundation or returned identity", async () => {
  for (const mismatch of ["episodeBrief", "evidencePack", "cast", "identity"] as const) {
    const { job, read, hostPlan } = await postProductionFixture();
    if (mismatch === "identity") hostPlan.version += 1;
    else hostPlan.data[mismatch].version += 1;
    await assert.rejects(loadPostProduction(job, read), /recorded host plan/i);
  }
});

test("editorial review counts the edited speech and holds a missing exchange without fabricating turns", async () => {
  const fixture = await postProductionFixture(), h = harness(fixture.job), observed: Observed[] = [];
  const original = structuredClone(fixture.transcript);
  try {
    await step(h, createEditingPlan, { patches: [{ turnId: "turn-4", before: original.data.turns[3].text,
      after: "That is the question.", reason: "An authored short replacement exercises review context." }], summary: "The promise remains underdeveloped." }, observed);
    const reviewed = await step(h, createReviewPlan, {
      outcome: "revise_section", summary: "The central promised explanation never arrives.",
      notes: ["Story: The opening poses a puzzle that remains unexplained.", "Insight: The distinction is useful.",
        "Voices: Too little speech to judge consistently.", "Interaction: A required perspective is absent.", "Pacing: The conclusion outruns the explanation."],
      issues: [{ id: "editorial-gap", turnIds: ["turn-4", "turn-5"], concern: "The answer and ending omit the promised central explanation.",
        evidenceNote: "This concerns the accepted exchange, not an unsupported scientific claim.", passages: [],
        recommendedChange: "Hold: completing the promise needs a new guest contribution." }], lookupRequest: null,
    }, observed);
    assert.equal(reviewed.job!.substep, "section_revision", reviewed.job!.pause?.reason);
    const participation = observed[1].input.participation;
    assert.deepEqual(participation.guests.map((guest: { words: number }) => guest.words), [14, 4, 0]);
    assert.deepEqual(participation.guestsNotYetHeard, ["expert3"]);
    assert.deepEqual(observed[1].input.editedEpisode.turns[3].text, "That is the question.");
    const held = await step(h, createRepairPlan, { status: "hold", patches: [], resolvedIssueIds: [],
      nearbyCoherenceChecked: false, summary: "An absent explanation cannot be supplied by editing the existing exchange." }, observed);
    assert.equal(held.job!.status, "paused");
    assert.equal(held.job!.pause!.code, "material_review_issue");
    assert.equal(held.job!.state.finalScript, undefined);
    assert.deepEqual(held.job!.state.artifacts[original.id], original);
    assert.equal(observed.length, 3, "One edit, review and bounded hold; no new conversation or lookup");
  } finally { h.close(); }
});

test("a local overstatement changes only its exact affected substring and gets a separate review", async () => {
  const { h, transcript } = await reviewedFixture();
  const before = "It proves that every flashing insect uses the same mechanism.", after = "It records a shared timing pattern in one setting, while the mechanism remains open.";
  try {
    const repaired = await step(h, createRepairPlan, repairOutput(before, after)), job = repaired.job!;
    assert.equal(job.substep, "recheck", job.pause?.reason);
    const edit = latest(job, "edit_report"); assert.equal(edit.version, 2);
    assert.deepEqual(edit.data.editedTurns.filter(turn => turn.id !== "turn-2"), transcript.data.turns.filter(turn => turn.id !== "turn-2"));
    assert.equal(edit.data.editedTurns[1].text, postProductionSpeech.overstatement.replace(before, after));
    assert.deepEqual(job.state.artifacts[transcript.id], transcript);
    const final = await step(h, createReviewPlan, acceptableReview());
    assert.equal(final.job!.stage, "ready_for_audio", final.job!.pause?.reason);
    assert.equal(latest(final.job!, "review").version, 2);
    assert.deepEqual(latest(final.job!, "final_script").data.turns, edit.data.editedTurns);
    assert.equal(final.job!.state.usageLedger!.records.length, 4, "No whole-conversation rerun or automatic retry");
  } finally { h.close(); }
});

test("an invented firsthand anecdote is removed from its affected section while all other speech survives", async () => {
  const { h, transcript } = await reviewedFixture("section");
  try {
    const repaired = await step(h, createRepairPlan, repairOutput("I discovered this mechanism in the field myself. ", ""));
    assert.equal(repaired.job!.substep, "recheck", repaired.job!.pause?.reason);
    const edit = latest(repaired.job!, "edit_report");
    assert.equal(edit.data.editedTurns[1].text, "The recorded pattern still needs a discriminating test.");
    assert.deepEqual(edit.data.editedTurns.filter(turn => turn.id !== "turn-2"), transcript.data.turns.filter(turn => turn.id !== "turn-2"));
    assert.equal(edit.data.repair!.mode, "section"); assert.deepEqual(repaired.job!.state.artifacts[transcript.id], transcript);
    const final = await step(h, createReviewPlan, acceptableReview()); assert.equal(final.job!.stage, "ready_for_audio");
  } finally { h.close(); }
});

test("a queued local repair resumes with GET only and produces one immutable replacement edit", async () => {
  const { h, job, transcript } = await reviewedFixture(), methods: string[] = []; let model = "";
  const output = repairOutput("It proves that every flashing insect uses the same mechanism.", "It records a pattern in one setting; the mechanism remains open.");
  const fetch: typeof globalThis.fetch = async (_url, init) => {
    methods.push(init!.method!); if (init?.method === "POST") model = JSON.parse(String(init.body)).model;
    return response(output, model, "resp_saved_local_repair", init?.method === "POST" ? "queued" : "completed");
  };
  await runDurableStep({ ...h.options, plan: createRepairPlan, fetch });
  const checkpoint = (await h.store.read(job.id, job.userId))!, originalEdit = structuredClone(latest(checkpoint, "edit_report")); h.close();
  assert.equal(checkpoint.substep, "local_edit"); assert.equal(latest(checkpoint, "edit_report").version, 1);
  const resumed = harness(checkpoint); resumed.tick();
  try {
    const result = await runDurableStep({ ...resumed.options, plan: createRepairPlan, fetch });
    assert.equal(result.job!.substep, "recheck", result.job!.pause?.reason); assert.deepEqual(methods, ["POST", "GET"]);
    assert.deepEqual(result.job!.state.artifacts[originalEdit.id], originalEdit); assert.deepEqual(result.job!.state.artifacts[transcript.id], transcript);
    assert.equal(Object.values(result.job!.state.artifacts).filter(artifact => artifact.kind === "edit_report").length, 2);
  } finally { resumed.close(); }
});

test("a repair outside flagged turns or section neighbours is rejected without changing the episode", async () => {
  for (const mode of ["local", "section"] as const) {
    const { h, transcript } = await reviewedFixture(mode), before = structuredClone((await h.store.read("evidence-fixture", "owner"))!);
    const turn = mode === "local" ? transcript.data.turns[0] : transcript.data.turns[4];
    try {
      const result = await step(h, createRepairPlan, repairOutput(turn.text, "Unrelated rewritten speech.", turn.id));
      assert.equal(result.job!.status, "paused"); assert.equal(result.job!.pause!.code, "needs_input");
      assert.deepEqual(latest(result.job!, "edit_report"), latest(before, "edit_report"));
      assert.deepEqual(result.job!.state.artifacts[transcript.id], transcript); assert.equal(Object.values(result.job!.state.artifacts).some(artifact => artifact.kind === "final_script"), false);
    } finally { h.close(); }
  }
});

test("an unresolved material issue holds the edited episode instead of regenerating the conversation", async () => {
  const { h, transcript } = await reviewedFixture("section");
  try {
    const result = await step(h, createRepairPlan, { status: "hold", patches: [], summary: "The story has no documentary support and needs an editorial decision.", resolvedIssueIds: [], nearbyCoherenceChecked: false });
    assert.equal(result.job!.status, "paused"); assert.equal(result.job!.pause!.code, "material_review_issue");
    assert.deepEqual(latest(result.job!, "edit_report").data.editedTurns, transcript.data.turns);
    assert.equal(latest(result.job!, "edit_report").data.repair!.held, true);
    assert.equal(result.job!.stage, "review"); assert.equal(result.job!.substep, "section_revision");
    assert.equal(result.job!.state.finalScript, undefined); assert.equal(result.job!.state.usageLedger!.records.length, 3);
  } finally { h.close(); }
});

test("exhausted local and section repair caps hold before any provider operation", async () => {
  for (const mode of ["local", "section"] as const) {
    const { h, job } = await reviewedFixture(mode), checkpoint = (await h.store.read(job.id, job.userId))!; h.close();
    checkpoint.config.limits[mode === "local" ? "maxLocalRepairPasses" : "maxSectionRevisionPasses"] = 0;
    const held = harness(checkpoint); let calls = 0;
    try {
      const result = await runDurableStep({ ...held.options, plan: createRepairPlan, fetch: async () => { calls++; throw new Error("Must stop before provider"); } });
      assert.equal(calls, 0); assert.equal(result.job!.pause!.code, "material_review_issue"); assert.equal(result.job!.state.usageLedger!.records.length, 2);
    } finally { held.close(); }
  }
});

test("a material recheck result pauses after the bounded repair with no additional rewrite", async () => {
  const { h } = await reviewedFixture();
  try {
    await step(h, createRepairPlan, repairOutput("It proves that every flashing insect uses the same mechanism.", "It records a pattern in one setting."));
    const result = await step(h, createReviewPlan, materialReview());
    assert.equal(result.job!.status, "paused"); assert.equal(result.job!.pause!.code, "material_review_issue");
    assert.equal(result.job!.stage, "review"); assert.equal(result.job!.substep, "recheck");
    assert.equal(result.job!.state.finalScript, undefined); assert.equal(latest(result.job!, "edit_report").version, 2);
    assert.equal(result.job!.state.usageLedger!.records.length, 4);
  } finally { h.close(); }
});

test("final approval rejects substituted turns and mismatched edit or review versions", async () => {
  const { job } = await postProductionFixture(), h = harness(job);
  try {
    await step(h, createEditingPlan, lightEdit());
    const result = await step(h, createReviewPlan, acceptableReview()), saved = result.job!;
    const final = latest(saved, "final_script"), review = latest(saved, "review"), edit = latest(saved, "edit_report");
    const altered = structuredClone(final); altered.data.turns[0].text = "An unreviewed substitute.";
    assert.throws(() => assertFinalScriptApproved(altered, review, edit), /exactly match/);
    const wrongEdit = structuredClone(final); wrongEdit.data.editReport.version++;
    assert.throws(() => assertFinalScriptApproved(wrongEdit, review, edit), /versions/);
    const wrongReview = structuredClone(final); wrongReview.data.review.version++;
    assert.throws(() => assertFinalScriptApproved(wrongReview, review, edit), /versions/);
  } finally { h.close(); }
});

test("one failed consequential lookup records inaccessible evidence separately and preserves the frozen foundation", async () => {
  const fixture = await postProductionFixture("local"), h = harness(fixture.job);
  const foundation = structuredClone(fixture.evidence), sourceRecords = structuredClone(fixture.sources), original = structuredClone(fixture.transcript);
  try {
    await step(h, createEditingPlan, lightEdit());
    const issue = { ...materialReview(), lookupRequest: { issueId: "issue-1", url: researchUrls[3], question: "Does this paper provide a documented basis for the universal mechanism claim?" } };
    const assessment = await step(h, createReviewPlan, issue); assert.equal(assessment.job!.substep, "lookup", assessment.job!.pause?.reason);
    let calls = 0;
    const lookup = await runDurableStep({ ...h.options, plan: createReviewLookupPlan, fetch: async (_url, init) => {
      calls++; assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init.body)); assert.equal(body.max_tool_calls, 1); assert.equal(body.tool_choice, "required");
      assert.match(body.input, /Open and read this source URL: https:\/\/example.org\/inaccessible/);
      return response(readingFixture(3, true), body.model, "resp_post_conversation_lookup", "completed", [{ type: "web_search_call", status: "failed", action: { type: "open_page", url: researchUrls[3] } }]);
    } });
    assert.equal(calls, 1); assert.equal(lookup.job!.substep, "local_edit", lookup.job!.pause?.reason);
    const supplement = latest(lookup.job!, "review_evidence");
    assert.equal(supplement.data.source.readingCoverage, "inaccessible"); assert.deepEqual(supplement.data.source.passages, []);
    assert.deepEqual(lookup.job!.state.artifacts[foundation.id], foundation); assert.deepEqual(lookup.job!.state.artifacts[sourceRecords.id], sourceRecords);
    assert.deepEqual(lookup.job!.state.artifacts[original.id], original);
    const repairCalls: Observed[] = [];
    const held = await step(h, createRepairPlan, { status: "hold", patches: [], summary: "The requested source remains inaccessible; the universal explanation has no support.", resolvedIssueIds: [], nearbyCoherenceChecked: false }, repairCalls);
    assert.equal(held.job!.pause!.code, "material_review_issue"); assert.equal(repairCalls[0].input.postConversationEvidence[0].source.readingCoverage, "inaccessible");
    const checkpoint = structuredClone(lookup.job!); checkpoint.stage = "review"; checkpoint.substep = "lookup";
    const capped = harness(checkpoint); let extraCalls = 0;
    try {
      const result = await runDurableStep({ ...capped.options, plan: createReviewLookupPlan, fetch: async () => { extraCalls++; throw new Error("Lookup allowance is exhausted"); } });
      assert.equal(extraCalls, 0); assert.equal(result.job!.pause!.code, "material_review_issue");
    } finally { capped.close(); }
  } finally { h.close(); }
});

test("light editing reads the exact closed conversation from owned private storage after restart", async () => {
  const fixture = await postProductionFixture(), objects = new Map<string, string>(), metadata: { contentType: string; cacheControl: string }[] = [];
  const bucket: ArtifactBucket = {
    async put(key, value, options) { objects.set(key, value); metadata.push(options!.httpMetadata); },
    async get(key) { const value = objects.get(key); if (!value) return null; const data = new TextEncoder().encode(value).buffer; return { size: data.byteLength, async arrayBuffer() { return data; } }; },
  };
  delete fixture.job.state.artifacts[fixture.transcript.id];
  const reference = await saveArtifact(fixture.job, fixture.transcript, bucket), checkpoint = JSON.parse(JSON.stringify(fixture.job)), h = harness(checkpoint), observed: Observed[] = [];
  try {
    assert.equal(checkpoint.state.artifacts[reference.id], undefined);
    const result = await runDurableStep({ ...h.options, plan: createEditingPlan, bucket, fetch: transport([lightEdit()], observed) });
    assert.equal(result.job!.substep, "assess", result.job!.pause?.reason);
    assert.deepEqual(observed[0].input.acceptedTranscript.turns, fixture.transcript.data.turns);
    assert.deepEqual(latest(result.job!, "edit_report").data.editedTurns, fixture.transcript.data.turns);
    assert.deepEqual(await readArtifact(result.job!, reference, bucket), fixture.transcript);
    assert.deepEqual(metadata, [{ contentType: "application/json", cacheControl: "private, no-store" }]);
  } finally { h.close(); }
});

test("the one-pass edit allowance prevents another edit of a newly supplied closed snapshot", async () => {
  const fixture = await postProductionFixture(), first = harness(fixture.job);
  await step(first, createEditingPlan, lightEdit());
  const checkpoint = (await first.store.read(fixture.job.id, fixture.job.userId))!; first.close();
  const newer = structuredClone(fixture.transcript); newer.id = "transcript:6"; newer.version = 6;
  checkpoint.state.artifacts[newer.id] = newer; checkpoint.stage = "editing"; checkpoint.substep = "edit";
  const h = harness(checkpoint); let calls = 0;
  try {
    const result = await runDurableStep({ ...h.options, plan: createEditingPlan, fetch: async () => { calls++; throw new Error("Pass allowance exhausted"); } });
    assert.equal(calls, 0); assert.equal(result.job!.pause!.code, "budget");
    assert.equal(latest(result.job!, "edit_report").version, 1);
    assert.deepEqual(result.job!.state.artifacts[fixture.transcript.id], fixture.transcript);
  } finally { h.close(); }
});

test("a final permitted review with a material issue holds before paying for a repair that cannot be rechecked", async () => {
  const fixture = await postProductionFixture("local"); fixture.job.config.limits.maxReviewPasses = 1;
  const h = harness(fixture.job);
  try {
    await step(h, createEditingPlan, lightEdit());
    const result = await step(h, createReviewPlan, materialReview());
    assert.equal(result.job!.status, "paused"); assert.equal(result.job!.pause!.code, "material_review_issue");
    assert.equal(result.job!.substep, "assess"); assert.equal(result.job!.state.usageLedger!.records.length, 2);
    const attempts = Object.values(result.job!.state.execution!.steps); assert.equal(attempts.some(attempt => attempt.step.substep === "local_edit"), false);
    assert.deepEqual(result.job!.state.artifacts[fixture.transcript.id], fixture.transcript);
  } finally { h.close(); }
});

test("read supplemental evidence reaches repair and recheck without changing the conversation's foundation", async () => {
  const fixture = await postProductionFixture("local"), h = harness(fixture.job);
  const foundation = structuredClone(fixture.evidence);
  try {
    await step(h, createEditingPlan, lightEdit());
    const review = { ...materialReview(), lookupRequest: { issueId: "issue-1", url: researchUrls[2], question: "What limitation does the correction place on the claimed generality?" } };
    await step(h, createReviewPlan, review);
    const lookedUp = await runDurableStep({ ...h.options, plan: createReviewLookupPlan, fetch: async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      return response(readingFixture(2), body.model, "resp_read_review_correction", "completed", [
        { type: "web_search_call", status: "completed", action: { type: "open_page", url: researchUrls[2] } },
      ]);
    } });
    assert.equal(lookedUp.job!.substep, "local_edit", lookedUp.job!.pause?.reason);
    const supplement = latest(lookedUp.job!, "review_evidence");
    assert.equal(supplement.data.source.readingCoverage, "partial");
    assert.equal(supplement.data.source.passages[0].coverage, "body");
    const repairCalls: Observed[] = [];
    await step(h, createRepairPlan, repairOutput("It proves that every flashing insect uses the same mechanism.", "The correction limits the observation to one setting and leaves the mechanism open."), repairCalls);
    assert.equal(repairCalls[0].input.postConversationEvidence[0].source.id, supplement.data.source.id);
    const rechecks: Observed[] = [];
    const accepted = await step(h, createReviewPlan, acceptableReview(), rechecks);
    assert.equal(accepted.job!.stage, "ready_for_audio", accepted.job!.pause?.reason);
    assert.equal(rechecks[0].input.supplementalEvidence[0].id, supplement.id);
    assert.ok(latest(accepted.job!, "review").provenance.inputVersions.some(ref => ref.id === supplement.id));
    assert.deepEqual(accepted.job!.state.artifacts[foundation.id], foundation);
    assert.deepEqual(accepted.job!.state.artifacts[fixture.transcript.id], fixture.transcript);
    assertFinalScriptApproved(latest(accepted.job!, "final_script"), latest(accepted.job!, "review"), latest(accepted.job!, "edit_report"));
    assert.equal(accepted.job!.state.usageLedger!.records.length, 5);
  } finally { h.close(); }
});
