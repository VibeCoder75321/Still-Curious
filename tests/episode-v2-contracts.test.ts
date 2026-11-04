import test from "node:test";
import assert from "node:assert/strict";
import {
  artifactSchema, assertEvidencePackSources, assertFinalScriptApproved, assertJobTransition, assertStepTransition,
  castSchema, decodeStoredEpisodeJob, editReportSchema, episodeV2JobSchema, evidencePackSchema,
  finalScriptSchema, pipelineVersionOf, reviewSchema, sourceRecordsSchema, spokenTurnSchema, transcriptSchema,
} from "../lib/episode-v2/contracts.ts";
import { createFiveMinuteConfig, fiveMinuteConfigSchema } from "../lib/episode-v2/config.ts";

const createdAt = "2026-10-15T14:00:00Z";
const reference = (kind: string, id = kind) => ({ id, kind, version: 1 });
function wrap<K extends string, D>(kind: K, data: D) {
  return {
    schemaVersion: 2, pipelineVersion: 2, id: kind, kind, version: 1, createdAt,
    provenance: {
      inputVersions: [], editorialVersion: "framework-2.1",
      prompt: { id: kind, version: "fixture-1" },
      modelConfiguration: null, usageRecordIds: [],
    },
    data,
  };
}

function fixtures() {
  const turn = { id: "t1", speaker: "host", text: "What can this observation tell us?" };
  const sourceRecords = wrap("source_records", {
    sources: [{
      id: "s1", title: "Fixture observation", url: "https://example.org/observation", authors: ["Fixture author"],
      accessedAt: createdAt, sourceType: "primary_study", evidenceFamilyId: "study-1",
      publicationStatus: "published", notices: [], readingCoverage: "partial",
      accessNote: "Synthetic test material, not live research.",
      passages: [{ id: "p1", text: "A pattern was observed under specified conditions.", locator: "Results", coverage: "body" }],
    }],
  });
  const pack = wrap("evidence_pack", {
    sourceRecords: reference("source_records"), commission: reference("research_commission"),
    commonBriefing: "Distinguish an observed pattern from its explanation.",
    topicMap: [{ questionOrTerm: "Pattern", explanation: "An observation requiring explanation." }],
    claims: [{
      id: "c1", statement: "The fixture reports a pattern.", supportStatus: "supported",
      passages: [{ sourceId: "s1", passageId: "p1" }], qualifications: ["Specified conditions only."], reason: "Direct observation.",
    }],
    interpretations: [], stories: [], openQuestions: ["What produced the pattern?"], limitations: ["One fixture study."],
    coverageDecision: { status: "sufficient", centralQuestion: "What does the pattern establish?", reason: "Enough for the narrow question." },
  });
  const cast = wrap("cast", {
    host: { speaker: "host", name: "Alex", approach: "Prepared curiosity." },
    guests: ["expert1", "expert2", "expert3"].map((speaker, i) => ({
      speaker, fictional: true, name: `Guest ${i + 1}`, expertise: ["Observation and explanation"],
      trustedMethods: ["Experiment"], temperament: "Patient", intellectualTendencies: ["Tests assumptions"],
      confidenceStyle: "Qualified", humour: "Dry", blindSpots: ["May favour experiments"], conditionsForRevision: ["Contrary evidence"],
    })),
  });
  const brief = wrap("episode_brief", {
    originalRequest: "What does a shared pattern tell us?", mainCuriosity: "Evidence and explanation", interpretation: "explicit",
    centralQuestion: "What can we infer?", listenerPromise: "Understand observation versus explanation.",
    startingKnowledge: "General interest", essentialFoundations: ["Observation"], deeperFocus: "Testing explanations",
    exclusions: ["A complete survey"], secondaryQuestions: [], premisesToCheck: [], lengthMinutes: 5, atmosphere: "Calm and engaged",
  });
  const commission = wrap("research_commission", {
    episodeBrief: reference("episode_brief"), questions: ["What was observed?"],
    evidenceRequirements: ["Read the report"], alternativesToExamine: ["Other explanations"], storiesToSeek: [], avoid: ["Invented details"],
  });
  const prep = wrap("guest_preparation", {
    speaker: "expert1", cast: reference("cast"), evidencePack: reference("evidence_pack"), thesis: "Test the inference.",
    supportingClaims: ["c1"], qualifications: ["Limited conditions"], strongestCounterargument: "Another cause may fit.",
    examplesOrStories: [], unresolved: ["Mechanism"], whatWouldChangeMyView: "A discriminating experiment.", possibleOveremphasis: "Experimental control",
  });
  const host = wrap("host_plan", {
    episodeBrief: reference("episode_brief"), evidencePack: reference("evidence_pack"), cast: reference("cast"),
    guestPreparations: {
      expert1: reference("guest_preparation", "prep1"), expert2: reference("guest_preparation", "prep2"), expert3: reference("guest_preparation", "prep3"),
    },
    priorities: ["Answer the question"], questions: [{ question: "What is established?", intendedGuest: "expert1", possibleFollowUps: [] }],
    possibleDetours: [], returnPoint: "The inference", endingAim: "Explain the remaining limit.",
  });
  const transcript = wrap("transcript", {
    evidencePack: reference("evidence_pack"), cast: reference("cast"), turns: [turn], stanceUpdates: [],
    hostDecisions: [{ afterTurnId: "t1", action: "ask", nextSpeaker: "expert1", purpose: "Explain the observation" }],
    showState: { currentTopic: "Inference", unresolvedQuestions: ["Mechanism"], detourReturnPoint: null, nextSpeaker: "expert1", estimatedSpokenSeconds: 5 },
  });
  const edit = wrap("edit_report", {
    transcript: reference("transcript"), editedTurns: [turn], changes: [], summary: "Preserved the question.",
  });
  const review = wrap("review", {
    editReport: reference("edit_report"), evidencePack: reference("evidence_pack"),
    outcome: "acceptable", summary: "The central explanation is sound.", notes: ["A small uncertainty remains open."], issues: [],
  });
  const final = wrap("final_script", {
    cast: reference("cast"), editReport: reference("edit_report"), review: reference("review"), turns: [turn],
    resolvedIssueIds: [], nearbyCoherenceChecked: false,
  });
  return { brief, commission, sourceRecords, pack, cast, prep, host, transcript, edit, review, final };
}

function job() {
  return episodeV2JobSchema.parse({
    schemaVersion: 2, pipelineVersion: 2, id: "job1", userId: "owner", topic: "A question", lengthMinutes: 5,
    status: "running", stage: "commission", substep: "produce", config: createFiveMinuteConfig(),
    progress: {}, state: { artifacts: {}, sources: [] }, createdAt: 1000, updatedAt: 1000,
  });
}

test("all v2 artifacts preserve versioned inputs and round-trip through the discriminated schema", () => {
  for (const item of Object.values(fixtures())) {
    assert.deepEqual(artifactSchema.parse(JSON.parse(JSON.stringify(item))), item);
  }
  const brief = fixtures().brief;
  assert.equal(artifactSchema.safeParse({ ...brief, provenance: { ...brief.provenance, prompt: { id: "producer" } } }).success, false);
  assert.equal(artifactSchema.safeParse({ ...brief, pipelineVersion: 3 }).success, false);
});

test("spoken turns accept brief replies and sustained explanations without citations or word quotas", () => {
  const short = { id: "a", speaker: "expert1", text: "Perhaps." };
  const long = { id: "b", speaker: "expert2", text: "A sustained explanation. ".repeat(100) };
  assert.deepEqual(spokenTurnSchema.parse(short), short);
  assert.deepEqual(spokenTurnSchema.parse(long), long);
  assert.equal(spokenTurnSchema.safeParse({ ...short, text: "  " }).success, false);
  assert.equal(spokenTurnSchema.safeParse({ ...short, speaker: "narrator" }).success, false);
  assert.equal(spokenTurnSchema.safeParse({ ...short, claim_ids: [] }).success, false, "production metadata belongs outside spoken turns");
  const f = fixtures().transcript;
  assert.equal(transcriptSchema.safeParse({ ...f, data: { ...f.data, turns: [short, short] } }).success, false);
  assert.equal(transcriptSchema.safeParse({ ...f, data: { ...f.data, stanceUpdates: [{ speaker: "expert1", afterTurnId: "missing", update: "Changed view" }] } }).success, false);
});

test("sources distinguish reading coverage and evidence resolves to the frozen source version", () => {
  const f = fixtures();
  const records = sourceRecordsSchema.parse(f.sourceRecords);
  const pack = evidencePackSchema.parse(f.pack);
  assert.doesNotThrow(() => assertEvidencePackSources(pack, records));
  const source = f.sourceRecords.data.sources[0];
  const snippetOnly = { ...source, readingCoverage: "full", passages: [{ ...source.passages[0], coverage: "snippet" }] };
  assert.equal(sourceRecordsSchema.safeParse({ ...f.sourceRecords, data: { sources: [snippetOnly] } }).success, false);
  assert.equal(sourceRecordsSchema.safeParse({ ...f.sourceRecords, data: { sources: [{ ...source, url: "file:///private" }] } }).success, false);
  assert.throws(() => assertEvidencePackSources(pack, { ...records, version: 2 }), /versions/);
  const badPack = evidencePackSchema.parse({ ...f.pack, data: { ...f.pack.data, claims: [{ ...f.pack.data.claims[0], passages: [{ sourceId: "s1", passageId: "missing" }] }] } });
  assert.throws(() => assertEvidencePackSources(badPack, records), /passage absent/);
  assert.equal(evidencePackSchema.safeParse({ ...f.pack, data: { ...f.pack.data, claims: [{ ...f.pack.data.claims[0], passages: [] }] } }).success, false);
});

test("casting requires three distinct guest identities without imposing speaking functions", () => {
  const cast = fixtures().cast;
  assert.equal(castSchema.safeParse(cast).success, true);
  assert.equal(castSchema.safeParse({ ...cast, data: { ...cast.data, guests: [cast.data.guests[0], cast.data.guests[0], cast.data.guests[2]] } }).success, false);
});

test("editing can remove a redundant turn while preserving the source and result mapping", () => {
  const edit = fixtures().edit;
  assert.equal(editReportSchema.safeParse({ ...edit, data: { ...edit.data, changes: [{ sourceTurnIds: ["removed-turn"], resultTurnIds: [], reason: "Repetition" }] } }).success, true);
  assert.equal(editReportSchema.safeParse({ ...edit, data: { ...edit.data, changes: [{ sourceTurnIds: ["t1"], resultTurnIds: ["missing"], reason: "Clarity" }] } }).success, false);
});

test("holistic review accepts minor uncertainty and local edits require a specific resolution", () => {
  const f = fixtures();
  const script = finalScriptSchema.parse(f.final);
  const acceptable = reviewSchema.parse(f.review);
  assert.doesNotThrow(() => assertFinalScriptApproved(script, acceptable));
  const issue = { id: "i1", turnIds: ["t1"], concern: "An overstatement", evidenceNote: "A qualification matters.", passages: [{ sourceId: "s1", passageId: "p1" }], recommendedChange: "Qualify this phrase." };
  const local = reviewSchema.parse({ ...f.review, data: { ...f.review.data, outcome: "acceptable_with_local_edit", issues: [issue] } });
  assert.throws(() => assertFinalScriptApproved(script, local), /resolve/);
  const resolved = { ...script, data: { ...script.data, resolvedIssueIds: ["i1"], nearbyCoherenceChecked: true } };
  assert.doesNotThrow(() => assertFinalScriptApproved(resolved, local));
  assert.throws(() => assertFinalScriptApproved({ ...resolved, data: { ...resolved.data, nearbyCoherenceChecked: false } }, local), /coherence/);
  assert.throws(() => assertFinalScriptApproved(resolved, { ...local, version: 2 }), /versions/);
  const section = reviewSchema.parse({ ...f.review, data: { ...f.review.data, outcome: "revise_section", issues: [issue] } });
  assert.throws(() => assertFinalScriptApproved(resolved, section), /new review/);
  assert.equal(reviewSchema.safeParse({ ...f.review, data: { ...f.review.data, accuracyPercent: 92 } }).success, false);
  assert.equal(reviewSchema.safeParse({ ...f.review, data: { ...f.review.data, issues: [issue] } }).success, false);
});

test("pilot configuration has short opening guidance, soft total word targets and configurable caps", () => {
  const a = createFiveMinuteConfig();
  assert.deepEqual(a.introductionTargetSeconds, { min: 20, max: 30 });
  assert.equal(a.targetDurationSeconds, 300);
  assert.deepEqual(a.spokenWordTarget, { min: 550, max: 700 });
  assert.equal(a.limits.spendCeilingUsd, null);
  const b = createFiveMinuteConfig({ maxConversationTurns: 20, spendCeilingUsd: 1 });
  assert.equal(b.limits.maxConversationTurns, 20);
  assert.equal(a.limits.maxConversationTurns, 32, "Each job receives its own config");
  assert.equal(fiveMinuteConfigSchema.safeParse({ ...a, lengthMinutes: 15 }).success, false);
  assert.equal(fiveMinuteConfigSchema.safeParse({ ...a, introductionTargetSeconds: { min: 30, max: 20 } }).success, false);
  assert.equal(fiveMinuteConfigSchema.safeParse({ ...a, wordsPerTurn: 30 }).success, false);
  assert.throws(() => createFiveMinuteConfig({ maxConversationTurns: 0 }));
});

test("stage contracts allow the intended bounded loops and reject skipped or reversed stages", () => {
  assert.doesNotThrow(() => assertStepTransition({ stage: "research", substep: "read" }, { stage: "research", substep: "discover" }));
  assert.doesNotThrow(() => assertStepTransition({ stage: "conversation", substep: "host" }, { stage: "conversation", substep: "expert2" }));
  assert.doesNotThrow(() => assertStepTransition({ stage: "review", substep: "local_edit" }, { stage: "review", substep: "recheck" }));
  assert.throws(() => assertStepTransition({ stage: "commission", substep: "produce" }, { stage: "tts", substep: "synthesize" }), /Invalid episode transition/);
  assert.throws(() => assertStepTransition({ stage: "preparation", substep: "expert1" }, { stage: "preparation", substep: "host" }), /Invalid episode transition/);
  assert.throws(() => assertStepTransition({ stage: "review", substep: "assess" }, { stage: "conversation", substep: "host" }), /Invalid episode transition/);
});

test("paused and failed jobs retain their step; text readiness is distinct from audio readiness", () => {
  const initial = job();
  const paused = episodeV2JobSchema.parse({ ...initial, status: "paused", pause: { code: "budget", reason: "Allowance exhausted" } });
  assert.doesNotThrow(() => assertJobTransition(initial, paused));
  assert.doesNotThrow(() => assertJobTransition(paused, initial));
  const research = episodeV2JobSchema.parse({ ...initial, stage: "research", substep: "discover" });
  assert.doesNotThrow(() => assertJobTransition(initial, research));
  assert.throws(() => assertJobTransition(paused, research), /Resume/);
  const failed = episodeV2JobSchema.parse({ ...initial, status: "failed", error: "Known failure" });
  assert.doesNotThrow(() => assertJobTransition(initial, failed));
  assert.throws(() => assertJobTransition(failed, initial), /Terminal/);
  assert.equal(episodeV2JobSchema.safeParse({ ...initial, status: "paused" }).success, false);
  assert.equal(episodeV2JobSchema.safeParse({ ...initial, stage: "research", substep: "host" }).success, false);
  const f = fixtures();
  const accepted = { ...initial, state: {
    artifacts: { final_script: finalScriptSchema.parse(f.final), review: reviewSchema.parse(f.review) },
    sources: [], finalScript: { id: "final_script", kind: "final_script", version: 1 },
  } };
  const checkpoint = episodeV2JobSchema.parse({ ...accepted, stage: "ready_for_audio", substep: "wait", status: "paused", pause: { code: "text_checkpoint", reason: "Text pilot complete" } });
  const review = episodeV2JobSchema.parse({ ...initial, stage: "review", substep: "assess" });
  assert.doesNotThrow(() => assertJobTransition(review, checkpoint));
  const tts = episodeV2JobSchema.parse({ ...accepted, stage: "tts", substep: "synthesize" });
  assert.doesNotThrow(() => assertJobTransition(checkpoint, tts));
  assert.equal(episodeV2JobSchema.safeParse({ ...accepted, status: "ready", stage: "ready", substep: "complete" }).success, false, "No saved audio key");
  const ready = episodeV2JobSchema.parse({ ...accepted, status: "ready", stage: "ready", substep: "complete", audioKey: "saved.mp3" });
  assert.throws(() => assertJobTransition(ready, initial), /Terminal/);
  assert.equal(episodeV2JobSchema.safeParse({ ...tts, state: { artifacts: {}, sources: [] } }).success, false, "Audio spending requires an accepted text version");
  assert.equal(episodeV2JobSchema.safeParse({ ...tts, state: { ...tts.state, finalScript: { id: "final_script", kind: "final_script", version: 2 } } }).success, false, "A stale approval cannot authorize a new script version");
  assert.throws(() => assertJobTransition(initial, { ...research, userId: "someone-else" }), /owner/);
});

test("unversioned and explicit v1 jobs preserve opaque legacy script and partial audio state", () => {
  const legacy = {
    id: "legacy", userId: "owner", topic: "A question", lengthMinutes: 5, status: "running", stage: "tts",
    createdAt, updatedAt: createdAt, state: { artifacts: {
      script: { turns: [{ id: "t1", speaker: "host", words: ["An", "older", "draft"], factual: false, claim_ids: [] }] },
      clips: [{ key: "saved-clip", turnId: "t1", requestId: "req_old" }],
    }, sources: [], openaiCalls: 4 }, progress: { ttsIndex: 1 }, customOldField: "preserve",
  };
  assert.deepEqual(decodeStoredEpisodeJob(JSON.stringify(legacy)), legacy);
  assert.equal(pipelineVersionOf(decodeStoredEpisodeJob(legacy)), 1);
  const explicit = { ...legacy, schemaVersion: 1, pipelineVersion: 1 };
  assert.deepEqual(decodeStoredEpisodeJob(explicit), explicit);
  const { progress: _progress, ...withoutProgress } = legacy;
  assert.deepEqual(decodeStoredEpisodeJob(withoutProgress), withoutProgress);
});

test("v2 saved jobs validate artifact IDs and versions; unknown versions never fall back to v1", () => {
  const initial = job();
  const brief = artifactSchema.parse(fixtures().brief);
  const saved = { ...initial, state: { artifacts: { [brief.id]: brief }, sources: [] } };
  assert.deepEqual(decodeStoredEpisodeJob(JSON.stringify(saved)), saved);
  assert.equal(pipelineVersionOf(decodeStoredEpisodeJob(saved)), 2);
  assert.throws(() => decodeStoredEpisodeJob({ ...saved, state: { artifacts: { wrong: brief }, sources: [] } }), /invalid/);
  for (const versions of [{ schemaVersion: 3, pipelineVersion: 3 }, { schemaVersion: 1, pipelineVersion: 2 }, { schemaVersion: 2 }, { pipelineVersion: 2 }]) {
    assert.throws(() => decodeStoredEpisodeJob({ ...saved, schemaVersion: undefined, pipelineVersion: undefined, ...versions }), /unsupported version/);
  }
  assert.throws(() => decodeStoredEpisodeJob("secret-echo-invalid-json"), error => error instanceof Error && !error.message.includes("secret-echo"));
});
