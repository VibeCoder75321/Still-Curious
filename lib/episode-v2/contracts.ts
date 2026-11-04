import { z } from "zod";
import { durationProfileSchema, episodeConfigSchema, episodeLengthSchema } from "./config.ts";
import { modelPolicySchema } from "./model-policy.ts";
import { usageLedgerSchema } from "./usage.ts";
import { DISCUSSION_VERSION, positionSchema, discussionPointSchema, interactionReviewSchema, foundationCoverageSchema } from "./discussion-design.ts";
import { audioStateSchema, audioHeldUsd } from "./audio-state.ts";
import { personalityManifestSchema } from "./personality.ts";

const text = z.string().min(1).refine(value => value.trim().length > 0, "Text must not be blank");
const texts = z.array(text);
const revision = z.number().int().positive();
const timestamp = z.string().datetime({ offset: true });
const httpUrl = z.string().url().refine(value => /^https?:\/\//i.test(value), "Use an HTTP or HTTPS source URL");

export const speakerSchema = z.enum(["host", "expert1", "expert2", "expert3"]);
export const guestSpeakerSchema = z.enum(["expert1", "expert2", "expert3"]);
export type Speaker = z.infer<typeof speakerSchema>;
export type GuestSpeaker = z.infer<typeof guestSpeakerSchema>;

export const artifactKindSchema = z.enum([
  "episode_brief", "research_commission", "source_records", "evidence_pack", "cast",
  "guest_preparation", "host_plan", "transcript", "edit_report", "review", "review_evidence", "final_script",
]);
export const artifactRefSchema = z.object({ id: text, kind: artifactKindSchema, version: revision }).strict();
export type ArtifactRef = z.infer<typeof artifactRefSchema>;

function ref<K extends z.infer<typeof artifactKindSchema>>(kind: K) {
  return artifactRefSchema.extend({ kind: z.literal(kind) });
}

/** Identifies the inputs actually used. Provider accounting is added in Task 03. */
export const provenanceSchema = z.object({
  inputVersions: z.array(artifactRefSchema),
  editorialVersion: text,
  prompt: z.object({ id: text, version: text }).strict().nullable(),
  modelConfiguration: z.object({ model: text, reasoningEffort: text.optional() }).strict().nullable(),
  usageRecordIds: texts,
}).strict();

function artifact<K extends z.infer<typeof artifactKindSchema>, D extends z.ZodTypeAny>(kind: K, data: D) {
  return z.object({
    schemaVersion: z.literal(2), pipelineVersion: z.literal(2),
    id: text, kind: z.literal(kind), version: revision, createdAt: timestamp,
    provenance: provenanceSchema, data,
  }).strict();
}

/** A supplied original brief is retained verbatim, separately from operational guidance. */
export const programmeBriefSchema = z.object({
  id: text, version: text, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().min(1).max(65_536).refine(value => value.trim().length > 0, "Text must not be blank"),
}).strict();
export type ProgrammeBrief = z.infer<typeof programmeBriefSchema>;
export const durationAdaptationSchema = z.object({
  profileVersion: durationProfileSchema, targetDurationSeconds: z.union([z.literal(300), z.literal(900)]),
  introductionTargetSeconds: z.object({ min: z.number().int().positive(), max: z.number().int().positive() }).strict(),
  scopeDecision: z.enum(["preserved", "narrowed"]), scopeRationale: text,
  introductionPurpose: text, discussionFocus: text, endingAim: text,
}).strict().superRefine((value, ctx) => {
  if (value.targetDurationSeconds !== (value.profileVersion === "five-minute-pilot-v1" ? 300 : 900)) {
    ctx.addIssue({ code: "custom", path: ["targetDurationSeconds"], message: "Duration must match the selected profile" });
  }
  if (value.introductionTargetSeconds.min > value.introductionTargetSeconds.max || value.introductionTargetSeconds.max >= value.targetDurationSeconds) {
    ctx.addIssue({ code: "custom", path: ["introductionTargetSeconds"], message: "Introduction range must leave time for the discussion" });
  }
});
const editorialInputsSchema = z.object({
  frameworkVersion: text, frameworkSourceSha256: z.string().regex(/^[a-f0-9]{64}$/), guidanceVersion: text,
  programmeBrief: programmeBriefSchema.omit({ text: true }).nullable(),
}).strict();

export const episodeBriefSchema = artifact("episode_brief", z.object({
  originalRequest: text,
  mainCuriosity: text,
  interpretation: z.enum(["explicit", "inferred"]),
  interpretationNote: text.optional(),
  centralQuestion: text,
  listenerPromise: text,
  startingKnowledge: text,
  essentialFoundations: texts,
  deeperFocus: text,
  exclusions: texts,
  secondaryQuestions: texts,
  premisesToCheck: texts,
  lengthMinutes: episodeLengthSchema,
  atmosphere: text,
  // Optional only to preserve already-saved v2 contract fixtures/artifacts.
  durationAdaptation: durationAdaptationSchema.optional(),
  editorialInputs: editorialInputsSchema.optional(),
}).strict());

export const researchCommissionSchema = artifact("research_commission", z.object({
  episodeBrief: ref("episode_brief"),
  originalRequest: text.optional(),
  lengthMinutes: episodeLengthSchema.optional(),
  questions: texts.min(1),
  evidenceRequirements: texts.min(1),
  alternativesToExamine: texts,
  storiesToSeek: texts,
  avoid: texts,
  evidenceSufficiency: text.optional(),
}).strict());

export const passageRefSchema = z.object({ sourceId: text, passageId: text }).strict();
const passageRefs = z.array(passageRefSchema);
export const sourcePassageSchema = z.object({
  id: text, text, locator: text,
  coverage: z.enum(["snippet", "abstract", "body"]),
}).strict();

function uniqueIds(values: { id: string }[], ctx: z.RefinementCtx, path: (string | number)[] = []) {
  const seen = new Set<string>();
  values.forEach((value, i) => {
    if (seen.has(value.id)) ctx.addIssue({ code: "custom", path: [...path, i, "id"], message: "IDs must be unique" });
    seen.add(value.id);
  });
}

export const sourceRecordSchema = z.object({
  id: text, title: text, url: httpUrl, doi: text.optional(), authors: texts,
  publishedOn: text.optional(), accessedAt: timestamp,
  sourceType: z.enum(["primary_study", "review", "institutional", "historical", "commentary", "other"]),
  evidenceFamilyId: text,
  relationships: z.array(z.object({
    sourceId: text, relation: z.enum(["same_study", "reports_on", "corrects", "supersedes", "retracts", "related"]), note: text,
  }).strict()).optional(),
  qualifications: texts.optional(),
  publicationStatus: z.enum(["published", "corrected", "retracted", "expression_of_concern", "unknown"]),
  notices: z.array(z.object({ type: text, url: httpUrl, note: text }).strict()),
  readingCoverage: z.enum(["discovered", "snippet", "abstract", "partial", "full", "inaccessible"]),
  accessNote: text,
  passages: z.array(sourcePassageSchema),
}).strict().superRefine((value, ctx) => {
  uniqueIds(value.passages, ctx, ["passages"]);
  const body = value.passages.some(p => p.coverage === "body");
  if (["partial", "full"].includes(value.readingCoverage) && !body) {
    ctx.addIssue({ code: "custom", path: ["passages"], message: "Body reading requires a saved body passage" });
  }
  if (["discovered", "snippet", "abstract", "inaccessible"].includes(value.readingCoverage) && body) {
    ctx.addIssue({ code: "custom", path: ["readingCoverage"], message: "Reading coverage does not match saved body material" });
  }
});
export const sourceRecordsSchema = artifact("source_records", z.object({
  sources: z.array(sourceRecordSchema),
  research: z.object({
    commission: ref("research_commission"), discoveryRounds: z.number().int().nonnegative(),
    readSourceIds: texts, pendingSourceIds: texts, skippedSourceIds: texts.optional(), coverageRationale: text, gaps: texts,
    stopReason: z.enum(["continue", "coverage", "allowance", "no_candidates"]),
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  uniqueIds(value.sources, ctx, ["sources"]);
  const ids = new Set(value.sources.map(source => source.id));
  value.sources.forEach((source, index) => {
    if (source.relationships?.some(relation => relation.sourceId === source.id || !ids.has(relation.sourceId))) {
      ctx.addIssue({ code: "custom", path: ["sources", index, "relationships"], message: "Source relationships must name another saved source" });
    }
  });
  if (value.research) {
    const { readSourceIds, pendingSourceIds, skippedSourceIds = [] } = value.research;
    const selected = [...readSourceIds, ...pendingSourceIds, ...skippedSourceIds];
    if (selected.some(id => !ids.has(id)) || new Set(selected).size !== selected.length) {
      ctx.addIssue({ code: "custom", path: ["research"], message: "Read, pending and skipped sources must be unique, disjoint saved source IDs" });
    }
  }
}));

export const claimRecordSchema = z.object({
  id: text, statement: text,
  basis: z.enum(["observation", "inference", "interpretation"]).optional(),
  supportStatus: z.enum(["supported", "provisional", "contested", "contradicted", "outside_material_read"]),
  passages: passageRefs,
  qualifications: texts,
  reason: text,
}).strict().superRefine((value, ctx) => {
  if (value.supportStatus !== "outside_material_read" && !value.passages.length) {
    ctx.addIssue({ code: "custom", path: ["passages"], message: "An evidence assessment needs source passages" });
  }
});
export const evidencePackSchema = artifact("evidence_pack", z.object({
  sourceRecords: ref("source_records"),
  commission: ref("research_commission"),
  commonBriefing: text,
  foundation: z.object({
    version: z.literal("frozen-evidence-v1"), sourceRecordsSha256: z.string().regex(/^[a-f0-9]{64}$/), frozenAt: timestamp,
  }).strict().optional(),
  centralClaimIds: texts.optional(),
  foundationCoverage: foundationCoverageSchema.optional(),
  evidenceFamilies: z.array(z.object({ id: text, sourceIds: texts.min(1) }).strict()).optional(),
  specialistExtracts: z.array(z.object({
    id: text, lens: text, summary: text, claimIds: texts, storyIds: texts, interpretationIds: texts,
  }).strict()).optional(),
  topicMap: z.array(z.object({ questionOrTerm: text, explanation: text }).strict()),
  claims: z.array(claimRecordSchema),
  interpretations: z.array(z.object({
    id: text, proposition: text, attribution: text, passages: passageRefs.min(1),
    strongestObjection: text, currentStanding: text, whatWouldChangeAssessment: text,
  }).strict()),
  stories: z.array(z.object({
    id: text, puzzle: text, attempted: text.optional(), observed: text, whatChanged: text,
    documentedDetails: texts, passages: passageRefs.min(1), qualifications: texts,
  }).strict()),
  openQuestions: texts,
  limitations: texts,
  coverageDecision: z.object({
    status: z.enum(["sufficient", "narrowed", "insufficient"]), centralQuestion: text, reason: text,
  }).strict(),
}).strict().superRefine((value, ctx) => {
  uniqueIds(value.claims, ctx, ["claims"]);
  uniqueIds(value.interpretations, ctx, ["interpretations"]);
  uniqueIds(value.stories, ctx, ["stories"]);
}));

export const guestProfileSchema = z.object({
  speaker: guestSpeakerSchema, fictional: z.literal(true), name: text, expertise: texts.min(1),
  trustedMethods: texts.min(1), temperament: text.optional(), intellectualTendencies: texts,
  confidenceStyle: text.optional(), humour: text.optional(), blindSpots: texts, conditionsForRevision: texts,
  evidencePerspective: z.object({ sharedClaimIds: texts.min(1), rationale: text }).strict().optional(),
}).strict();
export const castSchema = artifact("cast", z.object({
  evidencePack: ref("evidence_pack").optional(),
  perspectiveComparison: text.optional(),
  host: z.object({ speaker: z.literal("host"), name: text, approach: text }).strict(),
  guests: z.array(guestProfileSchema).length(3),
  personality: personalityManifestSchema.optional(),
}).strict().superRefine((value, ctx) => {
  if (new Set(value.guests.map(g => g.speaker)).size !== 3) {
    ctx.addIssue({ code: "custom", path: ["guests"], message: "Cast needs expert1, expert2 and expert3 exactly once" });
  }
  if (value.personality && value.guests.some(guest => {
    const snapshot = value.personality!.cast.find(item => item.id === guest.speaker);
    return !snapshot || snapshot.name !== guest.name || snapshot.expertise !== guest.expertise.join("; ");
  })) ctx.addIssue({ code: "custom", path: ["personality"], message: "Saved personality identities must match the cast" });
}));

export const guestPreparationSchema = artifact("guest_preparation", z.object({
  speaker: guestSpeakerSchema,
  cast: ref("cast"), evidencePack: ref("evidence_pack"),
  thesis: text, supportingClaims: texts, qualifications: texts, strongestCounterargument: text,
  examplesOrStories: texts, unresolved: texts, whatWouldChangeMyView: text, possibleOveremphasis: text,
  position: positionSchema.optional(),
}).strict());
export const hostPlanSchema = artifact("host_plan", z.object({
  episodeBrief: ref("episode_brief"), evidencePack: ref("evidence_pack"), cast: ref("cast"),
  guestPreparations: z.object({
    expert1: ref("guest_preparation"), expert2: ref("guest_preparation"), expert3: ref("guest_preparation"),
  }).strict(),
  priorities: texts.min(1),
  questions: z.array(z.object({ question: text, intendedGuest: guestSpeakerSchema, possibleFollowUps: texts }).strict()).min(1),
  possibleDetours: texts, returnPoint: text, endingAim: text,
  discussionPoints: z.array(discussionPointSchema).min(1).max(4).optional(),
}).strict());

/** The complete audio-facing shape. Evidence and routing stay outside the turn. */
export const spokenTurnSchema = z.object({ id: text, speaker: speakerSchema, text }).strict();
export type SpokenTurn = z.infer<typeof spokenTurnSchema>;
const turns = z.array(spokenTurnSchema).superRefine((value, ctx) => uniqueIds(value, ctx));
const finishedTurns = z.array(spokenTurnSchema).min(1).superRefine((value, ctx) => uniqueIds(value, ctx));

export const conversationStateSchema = z.object({
  version: z.literal(1), operationCount: z.number().int().nonnegative(), bidRounds: z.number().int().nonnegative(),
  bidQueue: z.array(guestSpeakerSchema).max(3), refreshRequestId: text.nullable(),
  requests: z.array(z.object({
    id: text, speaker: guestSpeakerSchema, point: text.nullable(), offeredAfterTurnId: text,
    status: z.enum(["offered", "parked", "accepted", "declined", "used", "passed"]),
    usedAtTurnId: text.nullable(), feedback: z.object({ useful: z.boolean(), reason: text }).strict().nullable(),
  }).strict()),
  responseDue: z.object({ speaker: guestSpeakerSchema, afterTurnId: text, reason: text }).strict().nullable(),
  responseQueue: z.array(z.object({ speaker: guestSpeakerSchema, afterTurnId: text, reason: text }).strict()).max(32),
  invitation: z.object({ speaker: guestSpeakerSchema, point: text.nullable(), requestId: text.nullable() }).strict().nullable(),
  closed: z.boolean(),
  remaining: z.object({ approximateSeconds: z.number().finite().nonnegative(), turns: z.number().int().nonnegative(),
    providerOperations: z.number().int().nonnegative(), textAllowanceUsd: z.number().finite().nonnegative(), bidRounds: z.number().int().nonnegative() }).strict(),
}).strict().superRefine((value, ctx) => {
  uniqueIds(value.requests, ctx, ["requests"]);
  if (new Set(value.bidQueue).size !== value.bidQueue.length) ctx.addIssue({ code: "custom", path: ["bidQueue"], message: "A guest bids once per collection round" });
  if (value.refreshRequestId && !value.requests.some(request => request.id === value.refreshRequestId)) ctx.addIssue({ code: "custom", path: ["refreshRequestId"], message: "Refresh must name a saved request" });
});
export type ConversationState = z.infer<typeof conversationStateSchema>;

export const transcriptSchema = artifact("transcript", z.object({
  evidencePack: ref("evidence_pack"), cast: ref("cast"), turns,
  stanceUpdates: z.array(z.object({ speaker: guestSpeakerSchema, afterTurnId: text, update: text }).strict()),
  hostDecisions: z.array(z.object({
    afterTurnId: text.nullable(), action: z.enum(["ask", "yield", "continue", "close", "request_contributions"]),
    nextSpeaker: speakerSchema.nullable(), purpose: text,
    pointToAddress: text.nullable().optional(), clarificationNeeded: z.boolean().optional(),
  }).strict()),
  showState: z.object({
    currentTopic: text, unresolvedQuestions: texts, detourReturnPoint: text.nullable(),
    nextSpeaker: speakerSchema.nullable(), estimatedSpokenSeconds: z.number().finite().nonnegative(),
  }).strict(),
  conversation: conversationStateSchema.optional(),
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.turns.map(t => t.id));
  for (const [field, updates] of [["stanceUpdates", value.stanceUpdates], ["hostDecisions", value.hostDecisions]] as const) {
    updates.forEach((u, i) => {
      if (u.afterTurnId !== null && !ids.has(u.afterTurnId)) {
        ctx.addIssue({ code: "custom", path: [field, i, "afterTurnId"], message: "Unknown transcript turn" });
      }
    });
  }
  if (value.conversation) {
    const state = value.conversation;
    for (const request of state.requests) {
      if (!ids.has(request.offeredAfterTurnId) || (request.usedAtTurnId !== null && !ids.has(request.usedAtTurnId))) ctx.addIssue({ code: "custom", path: ["conversation", "requests"], message: "Request must reference accepted speech" });
      if ((request.status === "passed") !== (request.point === null)) ctx.addIssue({ code: "custom", path: ["conversation", "requests"], message: "Only passing requests omit their point" });
      if (request.status === "used" && request.usedAtTurnId === null) ctx.addIssue({ code: "custom", path: ["conversation", "requests"], message: "Used requests need an accepted contribution" });
      if (request.feedback && request.status !== "used") ctx.addIssue({ code: "custom", path: ["conversation", "requests"], message: "Only served requests receive usefulness feedback" });
    }
    if (state.responseDue && !ids.has(state.responseDue.afterTurnId)) ctx.addIssue({ code: "custom", path: ["conversation", "responseDue"], message: "Response opportunity must follow accepted speech" });
    if (state.responseQueue.some(response => !ids.has(response.afterTurnId))) ctx.addIssue({ code: "custom", path: ["conversation", "responseQueue"], message: "Queued response must follow accepted speech" });
    if (state.invitation?.requestId && !state.requests.some(request => request.id === state.invitation!.requestId && request.status === "accepted" && request.speaker === state.invitation!.speaker)) ctx.addIssue({ code: "custom", path: ["conversation", "invitation"], message: "Invitation must name the accepted request for this guest" });
    if (state.closed && (value.showState.nextSpeaker !== null || state.bidQueue.length || state.invitation)) ctx.addIssue({ code: "custom", path: ["conversation", "closed"], message: "Closed conversation has no next floor holder" });
  }
}));

export const editReportSchema = artifact("edit_report", z.object({
  transcript: ref("transcript"), editedTurns: finishedTurns,
  previousEditReport: ref("edit_report").optional(),
  repair: z.object({ review: ref("review"), mode: z.enum(["local", "section"]), resolvedIssueIds: texts,
    nearbyCoherenceChecked: z.boolean(), held: z.boolean(), reason: text }).strict().optional(),
  changes: z.array(z.object({ sourceTurnIds: texts.min(1), resultTurnIds: texts, reason: text }).strict()),
  summary: text,
}).strict().superRefine((value, ctx) => {
  const ids = new Set(value.editedTurns.map(t => t.id));
  value.changes.forEach((change, i) => {
    if (change.resultTurnIds.some(id => !ids.has(id))) {
      ctx.addIssue({ code: "custom", path: ["changes", i, "resultTurnIds"], message: "Edit references an unknown edited turn" });
    }
  });
}));

export const reviewOutcomeSchema = z.enum(["acceptable", "acceptable_with_local_edit", "revise_section"]);
export const reviewIssueSchema = z.object({
  id: text, turnIds: texts.min(1), concern: text, evidenceNote: text,
  passages: passageRefs, recommendedChange: text,
}).strict();
const reviewCommon = { editReport: ref("edit_report"), evidencePack: ref("evidence_pack"), summary: text, notes: texts,
  interactionReview: interactionReviewSchema.optional(),
  lookupRequest: z.object({ issueId: text, url: httpUrl, question: text }).strict().nullable().optional() };
export const reviewSchema = artifact("review", z.discriminatedUnion("outcome", [
  z.object({ ...reviewCommon, outcome: z.literal("acceptable"), issues: z.array(reviewIssueSchema).length(0) }).strict(),
  z.object({ ...reviewCommon, outcome: z.literal("acceptable_with_local_edit"), issues: z.array(reviewIssueSchema).min(1) }).strict(),
  z.object({ ...reviewCommon, outcome: z.literal("revise_section"), issues: z.array(reviewIssueSchema).min(1) }).strict(),
]).superRefine((value, ctx) => {
  uniqueIds(value.issues, ctx, ["issues"]);
  if (value.lookupRequest && !value.issues.some(issue => issue.id === value.lookupRequest!.issueId)) ctx.addIssue({ code: "custom", path: ["lookupRequest"], message: "A consequential lookup must name a saved material issue" });
}));

export const reviewEvidenceSchema = artifact("review_evidence", z.object({
  review: ref("review"), issueId: text, question: text, source: sourceRecordSchema,
}).strict());

export const finalScriptSchema = artifact("final_script", z.object({
  cast: ref("cast"), editReport: ref("edit_report"), review: ref("review"), turns: finishedTurns,
  resolvedIssueIds: texts, nearbyCoherenceChecked: z.boolean(),
}).strict());

export const artifactSchema = z.discriminatedUnion("kind", [
  episodeBriefSchema, researchCommissionSchema, sourceRecordsSchema, evidencePackSchema, castSchema,
  guestPreparationSchema, hostPlanSchema, transcriptSchema, editReportSchema, reviewSchema, reviewEvidenceSchema, finalScriptSchema,
]);
export type EpisodeArtifact = z.infer<typeof artifactSchema>;
export type EpisodeBrief = z.infer<typeof episodeBriefSchema>;
export type ResearchCommission = z.infer<typeof researchCommissionSchema>;
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
export type SourceRecords = z.infer<typeof sourceRecordsSchema>;
export type EvidencePack = z.infer<typeof evidencePackSchema>;
export type Cast = z.infer<typeof castSchema>;
export type GuestPreparation = z.infer<typeof guestPreparationSchema>;
export type HostPlan = z.infer<typeof hostPlanSchema>;
export type Transcript = z.infer<typeof transcriptSchema>;
export type EditReport = z.infer<typeof editReportSchema>;
export type EpisodeReview = z.infer<typeof reviewSchema>;
export type ReviewEvidence = z.infer<typeof reviewEvidenceSchema>;
export type ReviewOutcome = z.infer<typeof reviewOutcomeSchema>;
export type FinalScript = z.infer<typeof finalScriptSchema>;

export function assertEvidencePackSources(pack: EvidencePack, records: SourceRecords): void {
  evidencePackSchema.parse(pack); sourceRecordsSchema.parse(records);
  if (pack.data.sourceRecords.id !== records.id || pack.data.sourceRecords.version !== records.version) {
    throw new Error("Evidence pack and source record versions do not match");
  }
  const passages = new Set(records.data.sources.flatMap(source => source.passages.map(p => JSON.stringify([source.id, p.id]))));
  for (const item of [...pack.data.claims, ...pack.data.interpretations, ...pack.data.stories]) {
    if (item.passages.some(p => !passages.has(JSON.stringify([p.sourceId, p.passageId])))) {
      throw new Error("Evidence references a passage absent from the saved source records");
    }
  }
}

/** A final script must resolve the specific review for the version it names. */
export function assertFinalScriptApproved(script: FinalScript, review: EpisodeReview, edit?: EditReport): void {
  finalScriptSchema.parse(script);
  reviewSchema.parse(review);
  if (script.data.review.id !== review.id || script.data.review.version !== review.version
    || script.data.editReport.id !== review.data.editReport.id || script.data.editReport.version !== review.data.editReport.version) {
    throw new Error("Final script and review versions do not match");
  }
  if (review.data.outcome === "revise_section") throw new Error("Affected section needs revision and a new review");
  if (edit && (script.data.editReport.id !== edit.id || script.data.editReport.version !== edit.version
    || JSON.stringify(script.data.turns) !== JSON.stringify(edit.data.editedTurns))) throw new Error("Final script must exactly match the specifically reviewed edit version");
  const turnIds = new Set(script.data.turns.map(t => t.id));
  const resolved = new Set(script.data.resolvedIssueIds);
  if (resolved.size !== script.data.resolvedIssueIds.length
    || review.data.issues.some(issue => !resolved.has(issue.id) || issue.turnIds.some(id => !turnIds.has(id)))
    || [...resolved].some(id => !review.data.issues.some(issue => issue.id === id))) {
    throw new Error("Final script must resolve exactly the review's local issues");
  }
  if (review.data.outcome === "acceptable_with_local_edit" && !script.data.nearbyCoherenceChecked) {
    throw new Error("Local edits need a nearby coherence check");
  }
}

export const stageSchema = z.enum([
  "commission", "research", "casting", "preparation", "conversation", "editing", "review",
  "ready_for_audio", "tts", "assembling", "ready",
]);
export type Stage = z.infer<typeof stageSchema>;
export const STAGE_SUBSTEPS = {
  commission: ["produce"], research: ["discover", "read", "synthesize"], casting: ["cast"],
  preparation: ["expert1", "expert2", "expert3", "host"],
  conversation: ["host", "expert1", "expert2", "expert3", "request_expert1", "request_expert2", "request_expert3"],
  editing: ["edit"], review: ["assess", "lookup", "local_edit", "section_revision", "recheck"],
  ready_for_audio: ["wait"], tts: ["synthesize"], assembling: ["assemble"], ready: ["complete"],
} as const satisfies Record<Stage, readonly string[]>;
export type Substep = typeof STAGE_SUBSTEPS[Stage][number];
const stepFields = { stage: stageSchema, substep: text };
export const stepSchema = z.object(stepFields).strict().superRefine((value, ctx) => {
  if (!(STAGE_SUBSTEPS[value.stage] as readonly string[]).includes(value.substep)) {
    ctx.addIssue({ code: "custom", path: ["substep"], message: "Substep does not belong to this stage" });
  }
});
export type Step = { [S in Stage]: { stage: S; substep: typeof STAGE_SUBSTEPS[S][number] } }[Stage];

// Internal loops are bounded by the job's limits when the runner is implemented.
const nextSteps: Record<string, readonly string[]> = {
  "commission.produce": ["research.discover"],
  "research.discover": ["research.read", "research.synthesize"],
  "research.read": ["research.read", "research.discover", "research.synthesize"],
  "research.synthesize": ["research.discover", "casting.cast"],
  "casting.cast": ["preparation.expert1"],
  "preparation.expert1": ["preparation.expert2"],
  "preparation.expert2": ["preparation.expert3"],
  "preparation.expert3": ["preparation.host"],
  "preparation.host": ["conversation.host"],
  "conversation.host": ["conversation.host", "conversation.expert1", "conversation.expert2", "conversation.expert3", "conversation.request_expert1", "conversation.request_expert2", "conversation.request_expert3", "editing.edit"],
  ...Object.fromEntries(["expert1", "expert2", "expert3"].map(speaker => [
    `conversation.${speaker}`, ["conversation.host", "conversation.request_expert1", "conversation.request_expert2", "conversation.request_expert3"],
  ])),
  ...Object.fromEntries(["expert1", "expert2", "expert3"].map(speaker => [
    `conversation.request_${speaker}`, ["conversation.host", "conversation.request_expert1", "conversation.request_expert2", "conversation.request_expert3"],
  ])),
  "editing.edit": ["review.assess"],
  "review.assess": ["ready_for_audio.wait", "review.lookup", "review.local_edit", "review.section_revision"],
  "review.lookup": ["review.local_edit", "review.section_revision"],
  "review.local_edit": ["review.recheck"],
  "review.section_revision": ["review.recheck"],
  "review.recheck": ["ready_for_audio.wait"],
  "ready_for_audio.wait": ["tts.synthesize"],
  "tts.synthesize": ["tts.synthesize", "assembling.assemble"],
  "assembling.assemble": ["ready.complete"],
  "ready.complete": [],
};

export function assertStepTransition(from: Step, to: Step): void {
  stepSchema.parse(from); stepSchema.parse(to);
  if (!nextSteps[`${from.stage}.${from.substep}`]?.includes(`${to.stage}.${to.substep}`)) {
    throw new Error(`Invalid episode transition: ${from.stage}.${from.substep} to ${to.stage}.${to.substep}`);
  }
}

export const privateArtifactRefSchema = z.object({
  artifact: artifactRefSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().positive().max(262_144), key: text,
}).strict();
export const stepAttemptSchema = z.object({
  id: text, key: text, step: stepSchema, inputHash: z.string().regex(/^[a-f0-9]{64}$/),
  inputs: z.array(artifactRefSchema), prompt: z.object({ id: text, version: text }).strict(),
  phase: z.enum(["submitted", "pending", "completed", "uncertain", "failed"]),
  usageRecordId: text, resultRefs: z.array(artifactRefSchema),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  nextPollAt: z.number().int().nonnegative().optional(), reason: text.optional(),
}).strict();
export const executionStateSchema = z.object({
  revision: z.number().int().nonnegative(), steps: z.record(stepAttemptSchema),
}).strict();
export type StepAttempt = z.infer<typeof stepAttemptSchema>;

const jobFields = {
  id: text, userId: text, topic: text, title: text.optional(), lengthMinutes: z.literal(5),
  createdAt: z.union([z.number().finite().nonnegative(), timestamp]),
  updatedAt: z.union([z.number().finite().nonnegative(), timestamp]),
  archivedAt: z.number().finite().nonnegative().optional(),
  archiveContext: z.object({
    status: z.string(), stage: z.string(), substep: z.string().optional(),
    pause: z.object({ code: z.string(), reason: z.string() }).optional(),
    recordedAt: z.number().finite().nonnegative(),
  }).strict().optional(),
  audioKey: text.optional(), audio: z.record(z.unknown()).optional(), error: text.optional(),
  errorAmbiguous: z.boolean().optional(),
};
export const episodeStatusSchema = z.enum(["running", "paused", "failed", "ready"]);
export type EpisodeStatus = z.infer<typeof episodeStatusSchema>;
export const episodeV2JobSchema = z.object({
  ...jobFields, schemaVersion: z.literal(2), pipelineVersion: z.literal(2),
  lengthMinutes: episodeLengthSchema,
  textOnly: z.literal(true).optional(),
  requestedAudio: z.object({ allowanceUsd: z.number().finite().positive(), auditionFirst: z.boolean() }).strict().optional(),
  status: episodeStatusSchema, ...stepFields,
  config: episodeConfigSchema,
  progress: z.record(z.unknown()),
  state: z.object({
    artifacts: z.record(artifactSchema), sources: z.array(sourceRecordSchema),
    personalitySeed: z.string().uuid().optional(),
    discussionVersion: z.literal(DISCUSSION_VERSION).optional(),
    finalScript: ref("final_script").optional(),
    modelPolicy: modelPolicySchema.optional(),
    usageLedger: usageLedgerSchema.optional(),
    execution: executionStateSchema.optional(),
    artifactBlobs: z.record(privateArtifactRefSchema).optional(),
    programmeBrief: programmeBriefSchema.optional(),
    audioPipeline: audioStateSchema.optional(),
  }).strict(),
  pause: z.object({
    code: z.enum(["text_checkpoint", "audio_audition", "budget", "ambiguous_provider_result", "cancelled", "user_paused", "needs_input", "material_review_issue"]),
    reason: text,
  }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.lengthMinutes !== value.config.lengthMinutes) {
    ctx.addIssue({ code: "custom", path: ["lengthMinutes"], message: "Episode length must match its configuration" });
  }
  const step = stepSchema.safeParse({ stage: value.stage, substep: value.substep });
  if (!step.success) for (const issue of step.error.issues) ctx.addIssue(issue);
  if ((value.status === "paused") !== !!value.pause) {
    ctx.addIssue({ code: "custom", path: ["pause"], message: "Only paused jobs carry a pause reason, and it is required" });
  }
  if (value.status === "failed" && !value.error) {
    ctx.addIssue({ code: "custom", path: ["error"], message: "Failed jobs need a reason" });
  }
  if ((value.status === "ready") !== (value.stage === "ready")) {
    ctx.addIssue({ code: "custom", path: ["status"], message: "Ready status and stage must agree" });
  }
  if (value.status === "ready" && !value.audioKey) {
    ctx.addIssue({ code: "custom", path: ["audioKey"], message: "Ready means audio is saved" });
  }
  if (value.stage === "ready_for_audio" && value.status === "running") {
    ctx.addIssue({ code: "custom", path: ["status"], message: "The text checkpoint pauses before audio spending" });
  }
  if (value.pause?.code === "text_checkpoint" && value.stage !== "ready_for_audio") {
    ctx.addIssue({ code: "custom", path: ["pause"], message: "Text checkpoint reason belongs to ready_for_audio" });
  }
  const ledger = value.state.usageLedger;
  for (const artifact of Object.values(value.state.artifacts)) {
    if (artifact.kind === "cast" && artifact.data.personality
      && (artifact.data.personality.episode_id !== value.id || artifact.data.personality.seed !== value.state.personalitySeed)) {
      ctx.addIssue({ code: "custom", path: ["state", "artifacts", artifact.id], message: "Saved personality cast must belong to this episode and seed" });
    }
  }
  if (value.requestedAudio && (value.textOnly || Math.abs(value.requestedAudio.allowanceUsd * 100 - Math.round(value.requestedAudio.allowanceUsd * 100)) > 1e-7
    || (value.config.limits.spendCeilingUsd !== null && value.requestedAudio.allowanceUsd >= value.config.limits.spendCeilingUsd))) {
    ctx.addIssue({ code: "custom", path: ["requestedAudio"], message: "Requested audio needs a whole-cent allowance inside the episode's total limit" });
  }
  const audio = value.state.audioPipeline;
  if (audio && (!ledger || audio.allowanceUsd > ledger.allocations.audio + 1e-9
    || audioHeldUsd(audio) > audio.allowanceUsd + 1e-9
    || audioHeldUsd(audio) + ledger.records.reduce((sum, record) => sum + record.allowanceUsd, 0) > (ledger.spendCeilingUsd ?? 0) + 1e-9)) {
    ctx.addIssue({ code: "custom", path: ["state", "audioPipeline"], message: "Audio and text reservations must fit their shared spending ceiling" });
  }
  if (ledger && (ledger.spendCeilingUsd !== value.config.limits.spendCeilingUsd
    || ledger.maxOperations !== value.config.limits.maxProviderOperations
    || ledger.maxSearchCalls !== value.config.limits.maxSearchCalls
    || ledger.maxSourceReads !== value.config.limits.maxSourceReads)) {
    ctx.addIssue({ code: "custom", path: ["state", "usageLedger"], message: "Ledger allowances must match the episode configuration" });
  }
  for (const [key, item] of Object.entries(value.state.artifacts)) {
    if (item.id !== key) ctx.addIssue({ code: "custom", path: ["state", "artifacts", key], message: "Artifact key must match its ID" });
  }
  for (const [key, blob] of Object.entries(value.state.artifactBlobs ?? {})) {
    if (blob.artifact.id !== key || key in value.state.artifacts) {
      ctx.addIssue({ code: "custom", path: ["state", "artifactBlobs", key], message: "Artifact storage references must have unique matching IDs" });
    }
  }
  for (const [key, attempt] of Object.entries(value.state.execution?.steps ?? {})) {
    const record = ledger?.records.find(record => record.id === attempt.usageRecordId && record.id === attempt.id);
    if (attempt.key !== key || !record) {
      ctx.addIssue({ code: "custom", path: ["state", "execution", "steps", key], message: "Attempt must match its key and saved usage reservation" });
    }
    if (record?.abandonment && (attempt.phase !== "failed" || attempt.resultRefs.length > 0)) {
      ctx.addIssue({ code: "custom", path: ["state", "execution", "steps", key], message: "An abandoned source attempt cannot retain accepted output or resume automatically" });
    }
    if (attempt.phase === "completed" && (record?.outcome !== "completed" || record.boundExceeded || !attempt.resultRefs.length
      || attempt.resultRefs.some(ref => {
        const item = value.state.artifacts[ref.id] ?? value.state.artifactBlobs?.[ref.id]?.artifact;
        return !item || item.kind !== ref.kind || item.version !== ref.version;
      }))) {
      ctx.addIssue({ code: "custom", path: ["state", "execution", "steps", key], message: "Completed attempts require accepted output versions and settled usage" });
    }
  }
  if (["ready_for_audio", "tts", "assembling", "ready"].includes(value.stage) && value.status !== "failed") {
    const pointer = value.state.finalScript;
    const script = pointer ? value.state.artifacts[pointer.id] : undefined;
    const review = script?.kind === "final_script" ? value.state.artifacts[script.data.review.id] : undefined;
    if (!pointer || script?.kind !== "final_script" || script.version !== pointer.version || review?.kind !== "review") {
      ctx.addIssue({ code: "custom", path: ["state", "finalScript"], message: "Audio stages need an explicit final script and its saved review" });
    } else {
      try { assertFinalScriptApproved(script, review); }
      catch (error) {
        ctx.addIssue({ code: "custom", path: ["state", "finalScript"], message: error instanceof Error ? error.message : "Final script is not accepted" });
      }
    }
  }
});
export type EpisodeV2Job = z.infer<typeof episodeV2JobSchema>;

/** Validates phase/status changes; the future runner also checks artifacts, budgets and locks. */
export function assertJobTransition(from: EpisodeV2Job, to: EpisodeV2Job): void {
  episodeV2JobSchema.parse(from); episodeV2JobSchema.parse(to);
  if (from.id !== to.id || from.userId !== to.userId) throw new Error("An episode transition cannot change identity or owner");
  if (from.status === "failed" || from.status === "ready") throw new Error("Terminal episodes cannot advance");
  const sameStep = from.stage === to.stage && from.substep === to.substep;
  if (to.status === "failed" || (to.status === "paused" && sameStep)) {
    if (!sameStep) throw new Error("An interrupted episode must retain its step");
    return;
  }
  if (from.status === "paused" && sameStep && to.status === "running") return;
  if (from.status === "paused" && from.stage !== "ready_for_audio") throw new Error("Resume the saved step before advancing");
  if (to.status === "paused" && to.stage !== "ready_for_audio") throw new Error("Pause at the saved step");
  // Membership was checked above; the type assertion does not permit extra substeps.
  assertStepTransition({ stage: from.stage, substep: from.substep } as Step, { stage: to.stage, substep: to.substep } as Step);
}

/** Legacy artifacts are deliberately opaque: preserve old word arrays and clip layouts. */
export const legacyEpisodeJobSchema = z.object({
  ...jobFields,
  schemaVersion: z.literal(1).optional(), pipelineVersion: z.literal(1).optional(),
  status: text, stage: text, progress: z.record(z.unknown()).optional(),
  state: z.object({ artifacts: z.record(z.unknown()), sources: z.array(z.unknown()).optional() }).passthrough(),
}).passthrough();
export type LegacyEpisodeJob = z.infer<typeof legacyEpisodeJobSchema>;
export type StoredEpisodeJob = LegacyEpisodeJob | EpisodeV2Job;

export function decodeStoredEpisodeJob(value: unknown): StoredEpisodeJob {
  try {
    const input: unknown = typeof value === "string" ? JSON.parse(value) : value;
    const versions = z.object({ schemaVersion: z.unknown().optional(), pipelineVersion: z.unknown().optional() }).passthrough().parse(input);
    // A malformed/future version must never fall back to the unversioned reader.
    return versions.pipelineVersion === 2 || versions.schemaVersion === 2
      ? episodeV2JobSchema.parse(input) : legacyEpisodeJobSchema.parse(input);
  } catch {
    throw new Error("Stored episode record is invalid or uses an unsupported version");
  }
}

export function pipelineVersionOf(job: StoredEpisodeJob): 1 | 2 {
  return job.pipelineVersion === 2 ? 2 : 1;
}
