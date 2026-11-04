import { DISCUSSION_VERSION, RESEARCH_FOUNDATIONS_INSTRUCTIONS } from "../discussion-design.ts";
import type { SourceRecords } from "../contracts.ts";
import { DISCOVERY_INSTRUCTIONS, DISCOVERY_JSON_SCHEMA, DISCOVERY_PROMPT, RESEARCH_EDITORIAL_VERSION, discoveryOutputSchema } from "../prompts/research.ts";
import { assertResearchAllowance, beforeResearchAttempt, maximumSourceRecords, researchAllowance, researchMetadata, saveDiscovery } from "../research-storage.ts";
import { artifactRef, latestArtifactRef, requireLatestArtifact, StageBlockedError } from "../stage-helpers.ts";
import type { StepFactory } from "../runner.ts";

export const createSourceDiscoveryPlan: StepFactory = async (job, read) => {
  const commission = await requireLatestArtifact(job, read, "research_commission");
  const brief = await read(commission.data.episodeBrief);
  if (brief.kind !== "episode_brief") throw new StageBlockedError("The commission's episode brief is unavailable.");
  const previousRef = latestArtifactRef(job, "source_records");
  const previous = previousRef ? await read(previousRef) as SourceRecords : undefined;
  const research = researchMetadata(previous, commission);
  if (research.pendingSourceIds.length) throw new StageBlockedError("Read the saved discovery candidates before another search.");
  const key = `research.discover:${commission.version}:${(previous?.version ?? 0) + 1}`;
  const before = beforeResearchAttempt(job, key);
  assertResearchAllowance(before, "research");
  const maximumCandidates = maximumSourceRecords(job) - (previous?.data.sources.length ?? 0);
  if (maximumCandidates < 1) throw new StageBlockedError("The saved source limit is reached; review the research coverage.", "budget");
  return {
    key, step: { stage: "research", substep: "discover" },
    inputs: [artifactRef(commission), artifactRef(brief), ...(previousRef ? [previousRef] : [])],
    prompt: job.state.discussionVersion ? { ...DISCOVERY_PROMPT, version: DISCUSSION_VERSION } : DISCOVERY_PROMPT, editorialVersion: RESEARCH_EDITORIAL_VERSION,
    request: {
      kind: "research", role: "research", instructions: DISCOVERY_INSTRUCTIONS + (job.state.discussionVersion ? `\n\n${RESEARCH_FOUNDATIONS_INSTRUCTIONS}` : ""),
      input: JSON.stringify({ episodeBrief: brief.data, researchCommission: commission.data, episodeRequestedAt: new Date(job.createdAt).toISOString(),
        savedResearch: previous?.data ?? null, discoveryRound: research.discoveryRounds + 1,
        maximumCandidates, allowance: researchAllowance(before) }),
      schemaName: "still_curious_source_discovery_v1", jsonSchema: DISCOVERY_JSON_SCHEMA,
      parse: value => discoveryOutputSchema.parse(value),
    },
    finish(result, savedJob) {
      const { artifact, next } = saveDiscovery(result, savedJob, commission, previous, discoveryOutputSchema.parse(result.value));
      return { artifacts: [artifact], next, progress: { message: "Source discovery and coverage rationale saved", sourceCount: artifact.data.sources.length } };
    },
  };
};
