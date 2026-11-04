import { episodeBriefSchema, researchCommissionSchema, type EpisodeV2Job } from "../contracts.ts";
import { sha256 } from "../persistence.ts";
import {
  FRAMEWORK_SOURCE_SHA256, FRAMEWORK_VERSION, GUIDANCE_VERSION, PRODUCER_INSTRUCTIONS,
  PRODUCER_JSON_SCHEMA, PRODUCER_PROMPT, producerInput, producerOutputSchema,
} from "../prompts/producer.ts";
import type { StepPlan } from "../runner.ts";

export const PRODUCER_STEP_KEY = "commission.produce:1";
export const EPISODE_BRIEF_ID = "episode-brief:1";
export const RESEARCH_COMMISSION_ID = "research-commission:1";

/** The topic/full brief are already saved job inputs; their exact text enters the plan hash. */
export async function createProducerPlan(job: EpisodeV2Job): Promise<StepPlan> {
  const programme = job.state.programmeBrief;
  if (programme && (new TextEncoder().encode(programme.text).length > 65_536 || await sha256(programme.text) !== programme.sha256)) {
    throw new Error("The saved original programme brief exceeds its allowance or does not match its version hash");
  }
  if (([EPISODE_BRIEF_ID, RESEARCH_COMMISSION_ID].some(id => job.state.artifacts[id] || job.state.artifactBlobs?.[id]))
    && job.state.execution?.steps[PRODUCER_STEP_KEY]?.phase !== "completed") {
    throw new Error("Producer output exists without its completed attempt; reconcile it before commissioning again");
  }
  const programmeRef = programme ? { id: programme.id, version: programme.version, sha256: programme.sha256 } : null;
  return {
    key: PRODUCER_STEP_KEY, step: { stage: "commission", substep: "produce" }, inputs: [],
    prompt: PRODUCER_PROMPT,
    editorialVersion: `framework-${FRAMEWORK_VERSION}/${GUIDANCE_VERSION}${programme ? `/programme-${programme.id}@${programme.version}:${programme.sha256}` : "/original-unavailable"}`,
    request: {
      kind: "structured", role: "producer", instructions: PRODUCER_INSTRUCTIONS, input: producerInput(job),
      schemaName: "still_curious_producer_v1", jsonSchema: PRODUCER_JSON_SCHEMA, parse: value => producerOutputSchema.parse(value),
    },
    finish(result, savedJob) {
      const output = producerOutputSchema.parse(result.value);
      const record = savedJob.state.usageLedger?.records.find(r => r.id === result.usageRecordId);
      if (!record?.finishedAt) throw new Error("A producer result requires its saved usage record");
      const envelope = {
        schemaVersion: 2 as const, pipelineVersion: 2 as const, version: 1, createdAt: record.finishedAt,
        // The runner stamps accepted prompt/input/model/usage provenance atomically.
        provenance: { inputVersions: [], editorialVersion: "pending", prompt: null, modelConfiguration: null, usageRecordIds: [] },
      };
      const brief = episodeBriefSchema.parse({
        ...envelope, id: EPISODE_BRIEF_ID, kind: "episode_brief",
        data: {
          ...output.brief, originalRequest: savedJob.topic, lengthMinutes: savedJob.lengthMinutes,
          durationAdaptation: {
            ...output.adaptation, profileVersion: savedJob.config.profileVersion,
            targetDurationSeconds: savedJob.config.targetDurationSeconds,
            introductionTargetSeconds: savedJob.config.introductionTargetSeconds,
          },
          editorialInputs: {
            frameworkVersion: FRAMEWORK_VERSION, frameworkSourceSha256: FRAMEWORK_SOURCE_SHA256,
            guidanceVersion: GUIDANCE_VERSION, programmeBrief: programmeRef,
          },
        },
      });
      const commission = researchCommissionSchema.parse({
        ...envelope, id: RESEARCH_COMMISSION_ID, kind: "research_commission",
        data: {
          ...output.research, originalRequest: savedJob.topic, lengthMinutes: savedJob.lengthMinutes,
          episodeBrief: { id: brief.id, kind: brief.kind, version: brief.version },
        },
      });
      return {
        artifacts: [brief, commission], next: { stage: "research", substep: "discover" }, title: output.title,
        progress: { message: "Episode brief and research commission saved", completed: 1 },
      };
    },
  };
}
