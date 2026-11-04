import { DISCUSSION_VERSION, RESEARCH_FOUNDATIONS_INSTRUCTIONS } from "../discussion-design.ts";
import { SOURCE_READING_INSTRUCTIONS, SOURCE_READING_JSON_SCHEMA, SOURCE_READING_PROMPT, RESEARCH_EDITORIAL_VERSION, sourceReadingOutputSchema } from "../prompts/research.ts";
import { assertResearchAllowance, beforeResearchAttempt, researchAllowance, researchMetadata, saveSourceReading } from "../research-storage.ts";
import { artifactRef, requireLatestArtifact, StageBlockedError } from "../stage-helpers.ts";
import type { StepFactory } from "../runner.ts";

export const createSourceReadingPlan: StepFactory = async (job, read) => {
  const commission = await requireLatestArtifact(job, read, "research_commission");
  const brief = await read(commission.data.episodeBrief);
  if (brief.kind !== "episode_brief") throw new StageBlockedError("The commission's episode brief is unavailable.");
  const previous = await requireLatestArtifact(job, read, "source_records");
  const research = researchMetadata(previous, commission);
  const selected = previous.data.sources.find(source => source.id === research.pendingSourceIds[0]);
  if (!selected) throw new StageBlockedError("No saved candidate is waiting to be read; review the research coverage.");
  const key = `research.read:${previous.version + 1}:${selected.id}`;
  const before = beforeResearchAttempt(job, key);
  assertResearchAllowance(before, "source");
  return {
    key, step: { stage: "research", substep: "read" },
    inputs: [artifactRef(commission), artifactRef(brief), artifactRef(previous)],
    prompt: job.state.discussionVersion ? { ...SOURCE_READING_PROMPT, version: DISCUSSION_VERSION } : SOURCE_READING_PROMPT, editorialVersion: RESEARCH_EDITORIAL_VERSION,
    request: {
      kind: "source", role: "source", sourceUrl: selected.url, allowInaccessible: true,
      instructions: SOURCE_READING_INSTRUCTIONS + (job.state.discussionVersion ? `\n\n${RESEARCH_FOUNDATIONS_INSTRUCTIONS}` : ""),
      input: JSON.stringify({ episodeBrief: brief.data, researchCommission: commission.data, episodeRequestedAt: new Date(job.createdAt).toISOString(),
        selectedSource: selected, savedResearch: previous.data, allowance: researchAllowance(before) }),
      schemaName: "still_curious_source_reading_v1", jsonSchema: SOURCE_READING_JSON_SCHEMA,
      parse: value => sourceReadingOutputSchema.parse(value),
    },
    finish(result, savedJob) {
      const { artifact, next } = saveSourceReading(result, savedJob, commission, previous, selected, sourceReadingOutputSchema.parse(result.value));
      return { artifacts: [artifact], next, progress: { message: "Source access and relevant passages saved", readSourceCount: artifact.data.research!.readSourceIds.length } };
    },
  };
};
