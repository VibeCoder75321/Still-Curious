import test from "node:test";
import assert from "node:assert/strict";
import { transcriptSchema } from "../lib/episode-v2/contracts.ts";
import { createModelPolicy } from "../lib/episode-v2/model-policy.ts";
import { createProviderAdapter, type ProviderRequest } from "../lib/episode-v2/providers.ts";
import { contributionRequestSchema, guestContributionSchema, hostActionSchema } from "../lib/episode-v2/roles/contracts.ts";
import { createContributionRequestPlan } from "../lib/episode-v2/roles/contribution-request.ts";
import { createGuestRolePlan } from "../lib/episode-v2/roles/guest.ts";
import { createHostRolePlan } from "../lib/episode-v2/roles/host.ts";
import { artifactRef } from "../lib/episode-v2/stage-helpers.ts";
import { createUsageLedger } from "../lib/episode-v2/usage.ts";
import { GUEST_PREPARATION_PROMPT } from "../lib/episode-v2/prompts/guest-preparation.ts";
import { guestContributionFixture, hostActionFixture, speakingFixture } from "./fixtures/speaking.ts";

test("host decisions, guest speech and contribution requests have strict speaker ownership", () => {
  assert.deepEqual(hostActionSchema.parse(hostActionFixture), hostActionFixture);
  for (const extra of [{ speaker: "expert1" }, { turns: [{ speaker: "expert1", text: "A supplied guest answer." }] }, { guestAnswer: "An answer written by the host." }]) {
    assert.equal(hostActionSchema.safeParse({ ...hostActionFixture, ...extra }).success, false);
  }
  assert.equal(guestContributionSchema.safeParse({ ...guestContributionFixture, speaker: "expert2" }).success, false);
  assert.equal(guestContributionSchema.safeParse({ ...guestContributionFixture, turns: [] }).success, false);
  assert.equal(contributionRequestSchema.safeParse({ decision: "contribute", point: "Use the corrected estimate.", text: "A full unused speech." }).success, false);
});

test("silent yields are valid and inconsistent floor routing is rejected", () => {
  assert.equal(hostActionSchema.parse({ ...hostActionFixture, action: "yield", text: null, nextSpeaker: "expert3" }).text, null);
  for (const action of ["ask", "yield"] as const) {
    for (const nextSpeaker of ["host", null]) assert.equal(hostActionSchema.safeParse({ ...hostActionFixture, action, nextSpeaker }).success, false);
  }
  assert.equal(hostActionSchema.safeParse({ ...hostActionFixture, text: null }).success, false);
  assert.equal(hostActionSchema.safeParse({ ...hostActionFixture, action: "continue", nextSpeaker: "expert1" }).success, false);
  assert.equal(hostActionSchema.safeParse({ ...hostActionFixture, action: "close", nextSpeaker: "expert1" }).success, false);
  assert.equal(hostActionSchema.parse({ ...hostActionFixture, action: "continue", nextSpeaker: "host" }).nextSpeaker, "host");
  assert.equal(hostActionSchema.parse({ ...hostActionFixture, action: "close", nextSpeaker: null, text: null }).text, null);
});

test("a guest can give a brief qualification or sustained explanation without quotas or turn-level citations", () => {
  for (const text of ["Only in that setting.", Array(90).fill("The observation narrows the question without establishing a mechanism.").join(" ")]) {
    const speech = guestContributionSchema.parse({ text, stanceUpdate: null });
    assert.equal(speech.text, text); assert.deepEqual(Object.keys(speech).sort(), ["stanceUpdate", "text"]);
  }
  assert.equal(guestContributionSchema.safeParse({ text: " ", stanceUpdate: null }).success, false);
  assert.equal(guestContributionSchema.safeParse({ ...guestContributionFixture, claimIds: ["c1"] }).success, false);
});

test("contribution requests allow passing and one bounded point, never a full unused answer", () => {
  assert.deepEqual(contributionRequestSchema.parse({ decision: "pass", point: null }), { decision: "pass", point: null });
  assert.equal(contributionRequestSchema.parse({ decision: "contribute", point: "x".repeat(360) }).point?.length, 360);
  for (const value of [
    { decision: "pass", point: "I also want a turn." }, { decision: "contribute", point: null },
    { decision: "contribute", point: " " }, { decision: "contribute", point: "x".repeat(361) },
    { decision: "contribute", point: ["A first point", "A second point"] },
  ]) assert.equal(contributionRequestSchema.safeParse(value).success, false);
});

test("the host can open before a transcript exists, while guests and listening bids need preceding speech", async () => {
  const { job, read } = await speakingFixture(false);
  const host = await createHostRolePlan(job, read), input = JSON.parse(host.request.input);
  assert.deepEqual(input.acceptedTranscript, { reference: null, turns: [] });
  assert.equal(input.selectedDuration.introductionTargetSeconds.min, 20);
  assert.equal(input.selectedDuration.introductionTargetSeconds.max, 30);
  await assert.rejects(createGuestRolePlan(job, read, "expert1"), /preceding exchange/);
  await assert.rejects(createContributionRequestPlan(job, read, "expert2"), /preceding exchange/);
});

test("guests receive their own private preparation and the complete accepted exchange, including corrections", async () => {
  const { job, read, transcript, preparations, cast, evidence, hostPlan } = await speakingFixture();
  const before = JSON.stringify(job);
  for (const speaker of ["expert1", "expert2", "expert3"] as const) {
    const plan = await createGuestRolePlan(job, read, speaker), input = JSON.parse(plan.request.input);
    assert.equal(plan.speaker, speaker); assert.equal(input.ownProfile.speaker, speaker);
    assert.deepEqual(input.acceptedTranscript, { reference: artifactRef(transcript), turns: transcript.data.turns });
    assert.deepEqual(input.completeEvidencePack, { reference: artifactRef(evidence), ...evidence.data });
    assert.equal(input.currentQuestionOrContribution.text, transcript.data.turns.at(-1)!.text);
    assert.equal(input.selectedDuration.remainingApproximateSeconds, 247);
    assert.equal(input.ownPreparation.thesis, preparations.find(note => note.data.speaker === speaker)!.data.thesis);
    assert.equal(input.cast, undefined); assert.equal(input.hostPlan, undefined); assert.equal(input.guestPreparationSummaries, undefined);
    for (const note of preparations.filter(note => note.data.speaker !== speaker)) assert.equal(plan.request.input.includes(note.data.thesis), false);
    for (const profile of cast.data.guests.filter(profile => profile.speaker !== speaker)) {
      assert.equal(plan.request.input.includes(profile.blindSpots[0]), false);
    }
    assert.equal(plan.request.input.includes(hostPlan.data.returnPoint), false);
    const bid = await createContributionRequestPlan(job, read, speaker);
    assert.deepEqual(JSON.parse(bid.request.input).acceptedTranscript.turns, transcript.data.turns);
  }
  assert.equal(JSON.stringify(job), before, "Building role requests must not mutate accepted speech or preparation");
});

test("the host sees all three concise preparations and live stance updates", async () => {
  const { job, read, preparations, transcript, hostPlan } = await speakingFixture();
  const plan = await createHostRolePlan(job, read), input = JSON.parse(plan.request.input);
  assert.equal(plan.speaker, "host"); assert.deepEqual(input.hostPlan, { reference: artifactRef(hostPlan), ...hostPlan.data });
  assert.deepEqual(input.guestPreparationSummaries.map((note: { thesis: string }) => note.thesis), preparations.map(note => note.data.thesis));
  assert.deepEqual(input.stanceUpdates, transcript.data.stanceUpdates); assert.deepEqual(input.hostDecisions, transcript.data.hostDecisions);
  assert.deepEqual(input.acceptedTranscript.turns, transcript.data.turns);
});

test("a later accepted transcript changes the next request and keeps every preceding turn exact", async () => {
  const { job, read, transcript } = await speakingFixture();
  const original = await createGuestRolePlan(job, read, "expert1");
  const later = transcriptSchema.parse({ ...structuredClone(transcript), id: "transcript:2", version: 2,
    data: { ...structuredClone(transcript.data), turns: [...transcript.data.turns, { id: "turn-5", speaker: "expert2", text: "I withdraw the original magnitude and will compare models against the corrected estimate." }],
      showState: { ...transcript.data.showState, estimatedSpokenSeconds: 65 } } });
  job.state.artifacts[later.id] = later;
  const next = await createGuestRolePlan(job, read, "expert1"), input = JSON.parse(next.request.input);
  assert.notEqual(next.request.input, original.request.input);
  assert.deepEqual(input.acceptedTranscript.turns.slice(0, -1), transcript.data.turns);
  assert.equal(input.currentQuestionOrContribution.text, later.data.turns.at(-1)!.text);
  assert.deepEqual(input.acceptedTranscript.reference, artifactRef(later));
});

test("changed foundations, private-note metadata and host-plan inputs block role requests before provider submission", async () => {
  type Fixture = Awaited<ReturnType<typeof speakingFixture>>;
  const mutations: ((fixture: Fixture) => void)[] = [
    ({ sources }) => { sources.data.sources[0].accessNote += " Changed after evidence was frozen."; },
    ({ cast }) => { cast.data.evidencePack!.version++; },
    ({ cast }) => { cast.provenance.prompt!.version = "changed"; },
    ({ hostPlan }) => { hostPlan.data.cast.version++; },
    ({ hostPlan }) => { hostPlan.provenance.prompt!.version = "changed"; },
    ({ preparations }) => { preparations[0].provenance.prompt = { ...GUEST_PREPARATION_PROMPT, version: "changed" }; },
    ({ preparations }) => { preparations[0].provenance.inputVersions = preparations[0].provenance.inputVersions.filter(ref => ref.kind !== "source_records"); },
    ({ brief }) => { brief.data.editorialInputs!.frameworkSourceSha256 = "0".repeat(64); },
    ({ job }) => { job.state.programmeBrief = { id: "changed", version: "2", sha256: "0".repeat(64), text: "Unverified changed programme guidance" }; },
    ({ transcript }) => { transcript.data.cast.version++; },
  ];
  for (const mutate of mutations) {
    const fixture = await speakingFixture(); mutate(fixture);
    await assert.rejects(createHostRolePlan(fixture.job, fixture.read));
    await assert.rejects(createGuestRolePlan(fixture.job, fixture.read, "expert1"));
    await assert.rejects(createContributionRequestPlan(fixture.job, fixture.read, "expert1"));
    assert.equal(fixture.job.state.usageLedger!.records.length, 0);
  }
});

test("mocked host, guest and listening requests use structured provider output with no web tools", async () => {
  const { job, read, transcript } = await speakingFixture(), before = JSON.stringify(transcript);
  const host = await createHostRolePlan(job, read), guest = await createGuestRolePlan(job, read, "expert1"), bid = await createContributionRequestPlan(job, read, "expert2");
  const plans = [host, guest, bid], outputs = [hostActionFixture, guestContributionFixture, { decision: "pass", point: null }];
  const policy = createModelPolicy(), observed: Record<string, any>[] = [];
  const ledger = createUsageLedger({ spendCeilingUsd: 20, allocations: { research: 4, text: 12, review: 3, audio: 1 }, maxOperations: 64, maxSearchCalls: 4, maxSourceReads: 8 });
  const adapter = createProviderAdapter({ apiKey: "mock-only", policy, fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); observed.push(body);
    assert.equal(body.tools, undefined); assert.equal(body.max_tool_calls, undefined); assert.equal(body.text.format.strict, true);
    return new Response(JSON.stringify({ id: `resp_role_${observed.length}`, status: "completed", model: body.model, service_tier: "default", output: [],
      output_text: JSON.stringify(outputs[observed.length - 1]), usage: { input_tokens: 3000, output_tokens: 300, total_tokens: 3300,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 } } }));
  } });
  for (let index = 0; index < plans.length; index++) {
    const plan = plans[index];
    assert.equal(plan.request.kind, "structured"); assert.equal(policy.roles[plan.request.role]!.maxToolCalls, 0);
    assert.match(plan.request.instructions, /no web|Use no web/i);
    assert.match(plan.request.instructions, /no live research|Do not start research|do not call for live research/i);
    assert.match(plan.request.instructions, /qualify a recollection|qualified recollection|say what remains uncertain|factual certainty/i);
    const request = { ...plan.request, id: `role-attempt-${index}` } as ProviderRequest<unknown>;
    const result = await adapter.execute(request, ledger, async () => {});
    assert.deepEqual(result.value, outputs[index]);
  }
  assert.equal(observed.length, 3); assert.deepEqual(ledger.records.map(record => record.role), ["host", "guest", "contribution_request"]);
  assert.equal(JSON.stringify(job.state.artifacts[transcript.id]), before, "Provider parsing cannot append or revise transcript turns");
  assert.equal(ledger.records.every(record => record.reported.searchCalls === 0 && record.reported.sourceReads === 0), true);
});
