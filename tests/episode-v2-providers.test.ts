import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { createModelPolicy, MODEL_CATALOG, PROVIDER_DOCS_VERIFIED_AT } from "../lib/episode-v2/model-policy.ts";
import { createProviderAdapter, InputAllowanceError, ProviderOperationError, type ProviderRequest } from "../lib/episode-v2/providers.ts";
import { allowanceUsed, createUsageLedger, usageLedgerSchema, type UsageLedger } from "../lib/episode-v2/usage.ts";
import { createFiveMinuteConfig } from "../lib/episode-v2/config.ts";
import { episodeV2JobSchema } from "../lib/episode-v2/contracts.ts";

const parsedSchema = z.object({ answer: z.string() }).strict();
function request(id = "attempt-1"): ProviderRequest<z.infer<typeof parsedSchema>> {
  return { id, role: "guest", kind: "structured", instructions: "Answer using the supplied evidence.", input: "Fixture question",
    schemaName: "fixture_result", jsonSchema: { type: "object", properties: { answer: { type: "string" } }, required: ["answer"], additionalProperties: false },
    parse: value => parsedSchema.parse(value),
  };
}
function ledger(): UsageLedger {
  return createUsageLedger({ spendCeilingUsd: 10, allocations: { research: 2, text: 5, review: 2, audio: 1 }, maxOperations: 64, maxSearchCalls: 8, maxSourceReads: 8 });
}
const rawUsage = { input_tokens: 1000, input_tokens_details: { cached_tokens: 100, cache_write_tokens: 200 },
  output_tokens: 100, output_tokens_details: { reasoning_tokens: 50 }, total_tokens: 1100 };
function completed(extra: Record<string, unknown> = {}) {
  return { id: "resp_fixture", status: "completed", model: "gpt-6.1-sol", service_tier: "default", usage: rawUsage, output: [], output_text: JSON.stringify({ answer: "A qualified answer." }), ...extra };
}
const respond = (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "x-request-id": "req_fixture" } });

test("role policy validates documented effort support and confines web tools to research", () => {
  const p = createModelPolicy();
  assert.equal(p.verifiedAt, PROVIDER_DOCS_VERIFIED_AT);
  assert.equal(p.roles.synthesis?.reasoningEffort, "xhigh");
  assert.equal(p.roles.review?.reasoningEffort, "xhigh");
  assert.equal(p.roles.host?.reasoningEffort, "medium");
  assert.equal(p.roles.guest?.reasoningEffort, "xhigh");
  assert.equal(p.roles.guest_preparation?.reasoningEffort, "xhigh");
  assert.equal(p.roles.guest?.maxOutputTokens, 8192);
  assert.equal(p.roles.guest_preparation?.maxOutputTokens, 8192);
  assert.equal(p.roles.guest?.maxToolCalls, 0);
  assert.throws(() => createModelPolicy({ guest: { reasoningEffort: "none" } }));
  assert.throws(() => createModelPolicy({ host: { maxToolCalls: 1 } }));
  assert.equal(createModelPolicy({ contribution_request: { reasoningEffort: "none" } }).roles.contribution_request?.reasoningEffort, "none");
});

test("reservation is saved before fetch and reported tokens reconcile without counting reasoning twice", async () => {
  const l = ledger(), snapshots: UsageLedger[] = [];
  let calls = 0, clock = 0;
  const adapter = createProviderAdapter({ apiKey: "test-only", now: () => clock += 10, fetch: async (_input, init) => {
    calls++;
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].records[0].outcome, "reserved");
    const body = JSON.parse(String(init?.body));
    assert.equal(body.reasoning.effort, "xhigh"); assert.equal(body.service_tier, "default");
    assert.equal(body.reasoning.mode, "standard"); assert.equal(body.text.format.strict, true);
    assert.equal(body.max_output_tokens, 8192); assert.equal(body.tools, undefined);
    assert.equal(body.temperature, undefined); assert.equal(body.top_p, undefined);
    return respond(completed());
  } });
  const result = await adapter.execute(request(), l, async state => { snapshots.push(structuredClone(state)); });
  assert.equal(result.value.answer, "A qualified answer.");
  assert.equal(calls, 1); assert.equal(snapshots.length, 2);
  const record = l.records[0];
  assert.equal(record.actualModel, "gpt-6.1-sol"); assert.equal(record.responseId, "resp_fixture"); assert.equal(record.requestId, "req_fixture");
  assert.equal(record.latencyMs, 10); assert.equal(record.reported.reasoningTokens, 50);
  assert.ok(Math.abs(record.estimatedUsd! - .00291) < 1e-12);
  assert.ok(Math.abs(record.allowanceUsd - .0035) < 1e-12);
  assert.ok(record.allowanceUsd < record.reservedUsd); assert.equal(record.billedUsd, null);
  assert.equal(usageLedgerSchema.safeParse(JSON.parse(JSON.stringify(l))).success, true);
  assert.doesNotMatch(JSON.stringify(l), /test-only|Fixture question|A qualified answer/);
});

test("billing and rate limits are distinct, sanitized and never retried", async () => {
  for (const [code, category] of [["insufficient_quota", "billing"], ["rate_limit_exceeded", "rate_limit"], ["secret-provider-echo", "rate_limit"]]) {
    const l = ledger(); let calls = 0;
    const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => {
      calls++; return new Response(JSON.stringify({ error: { code, message: "secret-provider-echo" } }), { status: 429, headers: { "x-request-id": "req_quota" } });
    } });
    await assert.rejects(adapter.execute(request(), l, async () => {}), e => e instanceof ProviderOperationError && e.detail.category === category);
    assert.equal(calls, 1); assert.equal(l.records[0].outcome, "rejected"); assert.equal(allowanceUsed(l), 0);
    assert.equal(l.records[0].reported.inputTokens, null, "A rejection does not invent reported usage");
    assert.doesNotMatch(JSON.stringify(l), /secret-provider-echo|test-only/);
    await assert.rejects(adapter.execute(request(), l, async () => {}), /already been reserved/);
    assert.equal(calls, 1);
  }
});

test("incomplete and invalid structured outputs retain their measured usage without repair calls", async () => {
  for (const [data, outcome] of [
    [completed({ status: "incomplete", output_text: '{"answer":' }), "incomplete"],
    [completed({ output_text: JSON.stringify({ wrong: "field" }) }), "invalid_output"],
  ] as const) {
    const l = ledger(); let calls = 0;
    const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => { calls++; return respond(data); } });
    await assert.rejects(adapter.execute(request(), l, async () => {}), ProviderOperationError);
    assert.equal(calls, 1); assert.equal(l.records[0].outcome, outcome);
    assert.equal(l.records[0].reported.inputTokens, 1000); assert.ok(l.records[0].allowanceUsd > 0);
    assert.ok(l.records[0].allowanceUsd < l.records[0].reservedUsd);
  }
});

test("timeouts preserve their reservation and block both duplicate and new attempts until reconciliation", async () => {
  const l = ledger(); let calls = 0;
  const adapter = createProviderAdapter({ apiKey: "test-only", policy: createModelPolicy({ guest: { timeoutMs: 5 } }), fetch: async (_input, init) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("test-only secret transport detail"))));
  } });
  await assert.rejects(adapter.execute(request(), l, async () => {}), e => e instanceof ProviderOperationError && e.detail.ambiguous);
  const r = l.records[0]; assert.equal(r.outcome, "uncertain"); assert.equal(r.allowanceUsd, r.reservedUsd);
  assert.equal(r.reported.inputTokens, null); assert.equal(r.estimatedUsd, null);
  await assert.rejects(adapter.execute(request("another-attempt"), l, async () => {}), /Reconcile/);
  assert.equal(calls, 1); assert.doesNotMatch(JSON.stringify(l), /secret transport|test-only/);
});

test("server errors remain ambiguous even if their body includes a billing code", async () => {
  const l = ledger();
  const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 503 }) });
  await assert.rejects(adapter.execute(request(), l, async () => {}), e => e instanceof ProviderOperationError && e.detail.ambiguous);
  assert.equal(l.records[0].outcome, "uncertain"); assert.equal(l.records[0].allowanceUsd, l.records[0].reservedUsd);
});

test("unknown token details remain unknown and consume a conservative allowance", async () => {
  const l = ledger();
  const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => respond(completed({ usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100 } })) });
  await adapter.execute(request(), l, async () => {});
  const r = l.records[0]; assert.equal(r.reported.cachedInputTokens, null); assert.equal(r.estimatedUsd, null);
  assert.equal(r.billedUsd, null); assert.equal(r.unknownCosts.length, 2); assert.ok(r.allowanceUsd > 0);
});

test("missing usage and pending responses never release an unknown allowance", async () => {
  for (const status of ["completed", "in_progress"]) {
    const l = ledger();
    const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => respond(completed({ usage: null, status })) });
    if (status === "completed") await adapter.execute(request(), l, async () => {});
    else await assert.rejects(adapter.execute(request(), l, async () => {}), ProviderOperationError);
    const r = l.records[0]; assert.equal(r.allowanceUsd, r.reservedUsd); assert.equal(r.estimatedUsd, null); assert.equal(r.responseId, "resp_fixture");
  }
});

test("budget, count and input limits prevent fetch while preserving review and audio allocations", async () => {
  let calls = 0;
  const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => { calls++; return respond(completed()); } });
  const empty = createUsageLedger({ spendCeilingUsd: null, allocations: { text: 0, research: 0, review: 0, audio: 0 }, maxOperations: 64, maxSearchCalls: 8, maxSourceReads: 8 });
  await assert.rejects(adapter.execute(request(), empty, async () => {}), /No live spending/);
  const allocated = ledger(); allocated.allocations.text = 0;
  await assert.rejects(adapter.execute(request(), allocated, async () => {}), /Insufficient/);
  assert.equal(allocated.allocations.review, 2); assert.equal(allocated.allocations.audio, 1);
  const countLimited = ledger(); countLimited.maxOperations = 0;
  await assert.rejects(adapter.execute(request(), countLimited, async () => {}), /operation allowance/);
  await assert.rejects(adapter.execute({ ...request(), input: "x".repeat(130_000) }, ledger(), async () => {}), InputAllowanceError);
  assert.equal(calls, 0);
});

test("long episode context fits the default allowance without dropping evidence or lowering guest effort", async () => {
  const input = "x".repeat(100_000), l = ledger(); let calls = 0;
  const fetchMock: typeof fetch = async (_url, init) => {
    calls++; const body = JSON.parse(String(init?.body));
    assert.equal(body.input, input); assert.equal(body.reasoning.effort, "xhigh");
    assert.equal(body.model, "gpt-6.1-sol"); return respond(completed());
  };
  const old = createProviderAdapter({ apiKey: "test", policy: createModelPolicy({ guest: { maxInputTokens: 96_000 } }), fetch: fetchMock });
  await assert.rejects(old.execute({ ...request(), input }, l, async () => {}), InputAllowanceError);
  assert.equal(calls, 0); assert.equal(l.records.length, 0);
  await createProviderAdapter({ apiKey: "test", fetch: fetchMock }).execute({ ...request(), input }, l, async () => {});
  assert.equal(calls, 1); assert.equal(l.records.length, 1); assert.equal(l.records[0].maxima.inputTokens, 128_000);
});

test("hosted research reserves retrieval context and records actual search/source metadata", async () => {
  const l = ledger();
  const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async (_input, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.tools[0].type, "web_search"); assert.equal(body.max_tool_calls, 1); assert.equal(body.tool_choice, "required");
    assert.equal(body.tools[0].return_token_budget, "default");
    return respond(completed({ model: "gpt-6-luna", output: [{ type: "web_search_call", status: "completed", action: { type: "search", sources: [{ url: "https://example.org/study", title: "Fixture study" }] } }] }));
  } });
  const result = await adapter.execute({ ...request(), role: "research", kind: "research" }, l, async () => {});
  assert.equal(l.records[0].maxima.inputTokens, MODEL_CATALOG["gpt-6-luna"].contextTokens * 2);
  assert.equal(l.records[0].reported.searchCalls, 1); assert.equal(l.records[0].reported.sourceReads, 0);
  assert.equal(result.sources[0].url, "https://example.org/study");
});

test("source access requires the exact page to be opened, not a search result or failed open", async () => {
  for (const [type, url, status, valid] of [
    ["open_page", "https://example.org/study?utm_source=fixture", "completed", true],
    ["open_page", "https://example.org/study?different=1", "completed", false],
    ["open_page", "https://example.org/study", "failed", false],
    ["search", "https://example.org/study", "completed", false],
  ] as const) {
    const l = ledger();
    const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => respond(completed({ model: "gpt-6-luna", output: [{ type: "web_search_call", status, action: { type, url } }] })) });
    const operation = adapter.execute({ ...request(), role: "source", kind: "source", sourceUrl: "https://example.org/study" }, l, async () => {});
    if (valid) await operation; else await assert.rejects(operation, /not opened/);
    assert.equal(l.records[0].reported.sourceReads, type === "open_page" ? 1 : 0);
  }
});

test("web tools are refused for speakers and exhausted research allowances block requests", async () => {
  let calls = 0;
  const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => { calls++; return respond(completed()); } });
  await assert.rejects(adapter.execute({ ...request(), kind: "research" }, ledger(), async () => {}), /Web tools/);
  const l = ledger(); l.maxSearchCalls = 0;
  await assert.rejects(adapter.execute({ ...request(), role: "research", kind: "research" }, l, async () => {}), /tool allowance/);
  assert.equal(calls, 0);
});

test("inaccessible-source recording is opt-in and still requires an observed exact attempted open", async () => {
  for (const [url, status, valid] of [
    ["https://example.org/study", "failed", true],
    ["https://example.org/other", "failed", false],
    ["https://example.org/study", "in_progress", false],
  ] as const) {
    const l = ledger();
    const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => respond(completed({
      model: "gpt-6-luna", output: [{ type: "web_search_call", status, action: { type: "open_page", url } }],
    })) });
    const operation = adapter.execute({ ...request(), role: "source", kind: "source",
      sourceUrl: "https://example.org/study", allowInaccessible: true }, l, async () => {});
    if (valid) {
      const result = await operation;
      assert.equal(result.actions[0].status, "failed");
      assert.equal(l.records[0].reported.sourceReads, 1);
    } else await assert.rejects(operation, /not opened/);
  }
});

test("reported work above the reservation prevents subsequent calls", async () => {
  const l = ledger(); let calls = 0;
  const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => { calls++; return respond(completed({ usage: { ...rawUsage, input_tokens: 200_000 } })); } });
  await assert.rejects(adapter.execute(request(), l, async () => {}), /exceeded/);
  assert.equal(l.records[0].boundExceeded, true);
  await assert.rejects(adapter.execute(request("another"), l, async () => {}), /Reconcile/);
  assert.equal(calls, 1);
});

test("only empty nonterminal attempts beyond an echoed fully processed tool limit are excluded", async () => {
  for (const variant of ["ignored", "completed", "payload", "no_echo", "unknown_status"] as const) {
    const l = ledger();
    const extra = { type: "web_search_call", status: variant === "completed" ? "completed" : variant === "unknown_status" ? "mystery" : "searching",
      action: { type: "open_page", ...(variant === "payload" || variant === "completed" ? { url: "https://example.org/other" } : {}) } };
    const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => respond(completed({
      model: "gpt-6-luna", ...(variant === "no_echo" ? {} : { max_tool_calls: 1 }),
      output: [{ type: "web_search_call", status: "completed", action: { type: "open_page", url: "https://example.org/study" } }, extra],
    })) });
    const operation = adapter.execute({ ...request(), role: "source", kind: "source", sourceUrl: "https://example.org/study" }, l, async () => {});
    if (variant === "ignored") {
      const result = await operation;
      assert.equal(result.actions[1].ignored, true);
      assert.equal(l.records[0].reported.webSearchCalls, 1);
      assert.equal(l.records[0].reported.sourceReads, 1);
      assert.equal(l.records[0].ignoredWebAttempts, 1);
      assert.equal(l.records[0].boundExceeded, false);
    } else {
      await assert.rejects(operation, /exceeded/);
      assert.equal(l.records[0].reported.webSearchCalls, 2);
      assert.equal(l.records[0].boundExceeded, true);
    }
  }
});

test("persistence failures before and after fetch cannot cause a blind provider retry", async () => {
  for (const failAt of [1, 2]) {
    const l = ledger(); let calls = 0, saves = 0;
    const adapter = createProviderAdapter({ apiKey: "test-only", fetch: async () => { calls++; return respond(completed()); } });
    await assert.rejects(adapter.execute(request(), l, async () => { if (++saves === failAt) throw new Error("secret persistence detail"); }),
      e => e instanceof ProviderOperationError && e.detail.category === "persistence" && !e.message.includes("secret"));
    assert.equal(calls, failAt === 1 ? 0 : 1);
    await assert.rejects(adapter.execute(request(), l, async () => {}), /already been reserved/);
    assert.equal(calls, failAt === 1 ? 0 : 1);
  }
});

test("stored ledger limits must agree with the episode's authorized configuration", () => {
  const l = ledger();
  l.maxSearchCalls = 4;
  const config = createFiveMinuteConfig({ spendCeilingUsd: 10 });
  const saved = {
    schemaVersion: 2, pipelineVersion: 2, id: "job", userId: "owner", topic: "Question", lengthMinutes: 5,
    createdAt: 0, updatedAt: 0, status: "running", stage: "commission", substep: "produce", config, progress: {},
    state: { artifacts: {}, sources: [], modelPolicy: createModelPolicy(), usageLedger: l },
  };
  assert.equal(episodeV2JobSchema.safeParse(saved).success, true);
  assert.equal(episodeV2JobSchema.safeParse({ ...saved, config: createFiveMinuteConfig() }).success, false);
  assert.equal(episodeV2JobSchema.safeParse({ ...saved, state: { ...saved.state, usageLedger: { ...l, maxOperations: 100 } } }).success, false);
});
