import {
  episodeBriefSchema, episodeV2JobSchema, evidencePackSchema, researchCommissionSchema, sourceRecordsSchema,
  type ArtifactRef, type EpisodeArtifact,
} from "../../lib/episode-v2/contracts.ts";
import { createFiveMinuteConfig } from "../../lib/episode-v2/config.ts";
import { evidenceFamilies } from "../../lib/episode-v2/evidence-foundation.ts";
import { canonicalJson, sha256 } from "../../lib/episode-v2/persistence.ts";
import { artifactRef } from "../../lib/episode-v2/stage-helpers.ts";
import { createUsageLedger } from "../../lib/episode-v2/usage.ts";
import { FRAMEWORK_SOURCE_SHA256, FRAMEWORK_VERSION, GUIDANCE_VERSION } from "../../lib/episode-v2/prompts/producer.ts";
import { EVIDENCE_PROMPT, type EvidenceOutput } from "../../lib/episode-v2/prompts/evidence.ts";
import { producerFixtures } from "./producer.ts";

export const evidenceFixtureTime = "2026-10-15T17:30:00.000Z";
const envelope = { schemaVersion: 2, pipelineVersion: 2, version: 1, createdAt: evidenceFixtureTime,
  provenance: { inputVersions: [] as ArtifactRef[], editorialVersion: "authored-fixture", prompt: null, modelConfiguration: null, usageRecordIds: [] as string[] } };

/** Deliberately authored material using example.org; these are not scientific sources or live model output. */
export const evidenceOutputFixture: EvidenceOutput = {
  commonBriefing: "The fixture records a shared flashing pattern in one setting. An intervention is reported, but its correction limits the magnitude; the mechanism and generality remain open. Two reports describe the same study.",
  centralClaimIds: ["c1"],
  specialistExtracts: [
    { id: "extract1", lens: "Behavioural response and measurement", summary: "Start with what the recorded response establishes and what it leaves open.", claimIds: ["c1", "c2"], storyIds: ["story1"], interpretationIds: ["i1"] },
    { id: "extract2", lens: "Models and field conditions", summary: "Compare a proposed explanation with the limits of one setting.", claimIds: ["c1"], storyIds: [], interpretationIds: ["i1"] },
  ],
  topicMap: [{ questionOrTerm: "Shared pattern", explanation: "A measured similarity in timing does not itself establish a mechanism." }],
  claims: [
    { id: "c1", statement: "In the fixture setting, repeated observations recorded a shared flashing pattern.", basis: "observation", supportStatus: "supported", passages: [{ sourceId: "study1", passageId: "body1" }], qualifications: ["One measured setting; use the correction's more limited magnitude."], reason: "A saved methods/results passage describes the observation; the correction is retained." },
    { id: "c2", statement: "An abstract reports an intervention affecting the pattern.", basis: "observation", supportStatus: "provisional", passages: [{ sourceId: "abstract1", passageId: "abstract-p1" }], qualifications: ["Only the abstract was read; the detailed methods are unavailable."], reason: "This statement is limited to what the saved abstract reports." },
  ],
  interpretations: [{ id: "i1", proposition: "Interaction between individuals could explain the recorded pattern.", attribution: "The fixture study's discussion", passages: [{ sourceId: "study1", passageId: "body1" }], strongestObjection: "The observation alone cannot rule out a shared external influence.", currentStanding: "A qualified candidate explanation, not a demonstrated mechanism.", whatWouldChangeAssessment: "A discriminating intervention with readable methods." }],
  stories: [{ id: "story1", puzzle: "Could the shared pattern survive a change to the stimulus?", attempted: "The recorded intervention changed the stimulus.", observed: "The report described a changed pattern.", whatChanged: "A correction reduced the reported magnitude.", documentedDetails: ["The report contains a stimulus intervention", "The later correction limits its effect"], passages: [{ sourceId: "study1", passageId: "body1" }, { sourceId: "correction1", passageId: "correction-p1" }], qualifications: ["The report and correction describe one study; no invented discovery scene or generalisation."] }],
  openQuestions: ["Which mechanism best predicts responses in another setting?"],
  limitations: ["Several records are reports of one study, not independent confirmations.", "The intervention paper is abstract-only."],
  coverageDecision: { status: "sufficient", centralQuestion: "What does a shared flashing pattern tell us about coordination?", reason: "The read material supports a bounded account of the observation and its limitations." },
};

export async function frozenEvidenceFixture() {
  const producer = producerFixtures[1];
  const config = createFiveMinuteConfig({ spendCeilingUsd: 20 });
  const brief = episodeBriefSchema.parse({ ...envelope, id: "episode-brief:1", kind: "episode_brief", data: {
    ...producer.output.brief, originalRequest: producer.request, lengthMinutes: 5,
    durationAdaptation: { ...producer.output.adaptation, profileVersion: config.profileVersion, targetDurationSeconds: 300, introductionTargetSeconds: config.introductionTargetSeconds },
    editorialInputs: { frameworkVersion: FRAMEWORK_VERSION, frameworkSourceSha256: FRAMEWORK_SOURCE_SHA256, guidanceVersion: GUIDANCE_VERSION, programmeBrief: null },
  } });
  const commission = researchCommissionSchema.parse({ ...envelope, id: "research-commission:1", kind: "research_commission", data: {
    ...producer.output.research, originalRequest: producer.request, lengthMinutes: 5, episodeBrief: artifactRef(brief),
  } });
  const common = { authors: ["Fixture author"], accessedAt: evidenceFixtureTime, publicationStatus: "published", notices: [], sourceType: "primary_study", evidenceFamilyId: "study-family-1", accessNote: "Authored test material only." };
  const sources = sourceRecordsSchema.parse({ ...envelope, id: "source-records:1", kind: "source_records", data: {
    research: { commission: artifactRef(commission), discoveryRounds: 1, readSourceIds: ["study1", "report1", "correction1", "abstract1", "unread1"], pendingSourceIds: [], coverageRationale: "Enough read material for a bounded discussion of the observation.", gaps: ["Full intervention methods are unavailable."], stopReason: "coverage" },
    sources: [
      { ...common, id: "study1", title: "Authored pattern study", url: "https://example.org/study", publishedOn: "2025-01-01", publicationStatus: "corrected", notices: [{ type: "correction", url: "https://example.org/correction", note: "The effect magnitude was corrected." }], readingCoverage: "partial", passages: [{ id: "body1", text: "In this fixture setting we recorded a shared timing pattern. The intervention changed the pattern; see the corrected magnitude.", locator: "Results section, paragraph 2", coverage: "body" }] },
      { ...common, id: "report1", title: "Report of the same authored study", url: "https://example.org/report", sourceType: "institutional", relationships: [{ sourceId: "study1", relation: "reports_on", note: "Reports the same study, not a replication." }], readingCoverage: "partial", passages: [{ id: "report-p1", text: "This institutional report describes the authored pattern study.", locator: "Paragraph 1", coverage: "body" }] },
      { ...common, id: "correction1", title: "Correction to the authored pattern study", url: "https://example.org/correction", relationships: [{ sourceId: "study1", relation: "corrects", note: "Reduces the reported magnitude." }], readingCoverage: "full", passages: [{ id: "correction-p1", text: "The reported magnitude should be reduced; the observed direction remains as reported.", locator: "Correction notice, paragraph 1", coverage: "body" }] },
      { ...common, id: "abstract1", title: "Authored intervention abstract", url: "https://example.org/abstract", evidenceFamilyId: "study-family-2", readingCoverage: "abstract", passages: [{ id: "abstract-p1", text: "The abstract reports a stimulus intervention and a changed timing pattern.", locator: "Abstract", coverage: "abstract" }] },
      { ...common, id: "unread1", title: "Inaccessible authored paper", url: "https://example.org/inaccessible", evidenceFamilyId: "study-family-3", readingCoverage: "inaccessible", passages: [] },
    ],
  } });
  const evidence = evidencePackSchema.parse({ ...envelope, id: "evidence-pack:1", kind: "evidence_pack",
    provenance: { ...envelope.provenance, inputVersions: [artifactRef(brief), artifactRef(commission), artifactRef(sources)], prompt: EVIDENCE_PROMPT },
    data: { ...structuredClone(evidenceOutputFixture), sourceRecords: artifactRef(sources), commission: artifactRef(commission), evidenceFamilies: evidenceFamilies(sources),
      foundation: { version: "frozen-evidence-v1", sourceRecordsSha256: await sha256(canonicalJson(sources.data)), frozenAt: evidenceFixtureTime } },
  });
  const job = episodeV2JobSchema.parse({ schemaVersion: 2, pipelineVersion: 2, id: "evidence-fixture", userId: "owner", topic: producer.request, lengthMinutes: 5,
    createdAt: Date.parse(evidenceFixtureTime), updatedAt: Date.parse(evidenceFixtureTime), stage: "casting", substep: "cast", status: "running", progress: {}, config,
    state: { artifacts: Object.fromEntries([brief, commission, sources, evidence].map(value => [value.id, value])), sources: [], usageLedger: createUsageLedger({
      spendCeilingUsd: 20, allocations: { research: 8, text: 7, review: 4, audio: 1 }, maxOperations: 64, maxSearchCalls: 4, maxSourceReads: 8,
    }) },
  });
  const read = async (ref: ArtifactRef): Promise<EpisodeArtifact> => {
    const value = job.state.artifacts[ref.id];
    if (!value || value.kind !== ref.kind || value.version !== ref.version) throw new Error("Fixture artifact reference does not resolve");
    return value;
  };
  return { job, brief, commission, sources, evidence, read };
}
