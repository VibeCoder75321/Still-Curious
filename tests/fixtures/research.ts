import { episodeBriefSchema, researchCommissionSchema, episodeV2JobSchema, type EpisodeV2Job } from "../../lib/episode-v2/contracts.ts";
import { createFiveMinuteConfig } from "../../lib/episode-v2/config.ts";
import { createUsageLedger } from "../../lib/episode-v2/usage.ts";
import type { DiscoveryOutput, SourceReadingOutput } from "../../lib/episode-v2/prompts/research.ts";
import { producerFixtures } from "./producer.ts";

export const researchAt = Date.parse("2026-10-15T18:00:00Z");
export const researchUrls = ["https://example.org/study", "https://example.org/report", "https://example.org/correction", "https://example.org/inaccessible"];
const candidate = (title: string, url: string, sourceType: DiscoveryOutput["candidates"][number]["sourceType"] = "primary_study") => ({
  title, url, doi: null, authors: ["Research fixture author"], publishedOn: "2024-01-01", sourceType,
  evidenceFamilyId: "synchrony-study", publicationStatus: "published" as const, notices: [], relationships: [],
  qualifications: ["This authored fixture supplies no real scientific evidence."], accessNote: "Discovered through a mocked search.",
  snippet: { text: "A bounded observation of synchrony.", locator: "Search result snippet" },
});
export const discoveryFixture: DiscoveryOutput = {
  candidates: [candidate("Synchrony study", researchUrls[0]), candidate("Report on the synchrony study", researchUrls[1], "commentary"),
    candidate("Correction to the synchrony study", researchUrls[2]), candidate("Inaccessible alternative", researchUrls[3])],
  coverageRationale: "Read the primary observation, associated correction and an alternative; the report is not independent evidence.",
  gaps: ["Read the actual observations and correction."],
};
discoveryFixture.candidates[1].relationships = [{ url: researchUrls[0], relation: "reports_on", note: "Reports the same underlying study." }];
discoveryFixture.candidates[2].relationships = [{ url: researchUrls[0], relation: "corrects", note: "The correction narrows the population to one species." }];
discoveryFixture.candidates[3].evidenceFamilyId = "alternative-study";

export function readingFixture(index: number, inaccessible = false): SourceReadingOutput {
  const { snippet: _snippet, ...metadata } = structuredClone(discoveryFixture.candidates[index]);
  return { ...metadata, readingCoverage: inaccessible ? "inaccessible" : "partial", fullTextAvailable: false,
    accessNote: inaccessible ? "The exact page could not be opened." : "Relevant body passage read; full body not claimed.",
    passages: inaccessible ? [] : [{ text: index === 2 ? "The observation applies only to the measured species." : "The measured flashes became more synchronized under the observation conditions.", locator: index === 2 ? "Correction, paragraph 2" : "Results, paragraph 3", coverage: "body" }],
    coverageRationale: "Distinguish observations from interpretation and retain the species limitation.", gaps: index === 3 ? [] : ["Read the remaining commissioned sources."],
  };
}
export function researchJob(): EpisodeV2Job {
  const fixture = producerFixtures[1], envelope = {
    schemaVersion: 2, pipelineVersion: 2, version: 1, createdAt: new Date(researchAt).toISOString(),
    provenance: { inputVersions: [], editorialVersion: "authored-fixture", prompt: null, modelConfiguration: null, usageRecordIds: [] },
  };
  const brief = episodeBriefSchema.parse({ ...envelope, id: "episode-brief:1", kind: "episode_brief", data: { ...fixture.output.brief, originalRequest: fixture.request, lengthMinutes: 5 } });
  const commission = researchCommissionSchema.parse({ ...envelope, id: "research-commission:1", kind: "research_commission",
    data: { ...fixture.output.research, episodeBrief: { id: brief.id, kind: brief.kind, version: brief.version } } });
  return episodeV2JobSchema.parse({ schemaVersion: 2, pipelineVersion: 2, id: "research-fixture", userId: "owner", topic: fixture.request,
    lengthMinutes: 5, createdAt: researchAt, updatedAt: researchAt, stage: "research", substep: "discover", status: "running", progress: {},
    config: createFiveMinuteConfig({ spendCeilingUsd: 20 }), state: { artifacts: { [brief.id]: brief, [commission.id]: commission }, sources: [],
      usageLedger: createUsageLedger({ spendCeilingUsd: 20, allocations: { research: 8, text: 7, review: 4, audio: 1 }, maxOperations: 64, maxSearchCalls: 4, maxSourceReads: 8 }) } });
}
