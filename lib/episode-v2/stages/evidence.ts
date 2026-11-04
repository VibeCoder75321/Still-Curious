import { evidencePackSchema, type EpisodeV2Job } from "../contracts.ts";
import { assertReadEvidence, evidenceFamilies } from "../evidence-foundation.ts";
import { canonicalJson, sha256 } from "../persistence.ts";
import {
  EVIDENCE_INSTRUCTIONS, EVIDENCE_JSON_SCHEMA, EVIDENCE_PROMPT, evidenceInput, evidenceOutputSchema,
  FOUNDATION_EVIDENCE_JSON_SCHEMA, validateFoundationEvidence,
} from "../prompts/evidence.ts";
import { FRAMEWORK_VERSION } from "../prompts/producer.ts";
import { DISCUSSION_VERSION, EVIDENCE_FOUNDATIONS_INSTRUCTIONS } from "../discussion-design.ts";
import type { StepPlan } from "../runner.ts";
import { artifactEnvelope, artifactRef, latestArtifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "../stage-helpers.ts";

export async function createEvidencePlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  const commission = await requireLatestArtifact(job, read, "research_commission");
  const brief = await read(commission.data.episodeBrief);
  if (brief.kind !== "episode_brief") throw new StageBlockedError("The research commission needs its exact episode brief.");
  const sources = await requireLatestArtifact(job, read, "source_records");
  if (sources.data.research && canonicalJson(sources.data.research.commission) !== canonicalJson(artifactRef(commission))) throw new StageBlockedError("Reconcile the source records with the current research commission before synthesis.");
  const previous = latestArtifactRef(job, "evidence_pack");
  const version = (previous?.version ?? 0) + 1;
  const coherent = job.state.discussionVersion === DISCUSSION_VERSION;
  const parse = (value: unknown) => coherent ? validateFoundationEvidence(value, brief.data.essentialFoundations ?? []) : evidenceOutputSchema.parse(value);
  return {
    key: `research.synthesize:${sources.version}:${commission.version}`, step: { stage: "research", substep: "synthesize" },
    inputs: [artifactRef(brief), artifactRef(commission), artifactRef(sources)], prompt: coherent ? { ...EVIDENCE_PROMPT, version: DISCUSSION_VERSION } : EVIDENCE_PROMPT,
    editorialVersion: `framework-${FRAMEWORK_VERSION}/evidence-editor-1`,
    request: {
      kind: "structured", role: "synthesis", instructions: EVIDENCE_INSTRUCTIONS + (coherent ? `\n\n${EVIDENCE_FOUNDATIONS_INSTRUCTIONS}` : ""),
      input: evidenceInput(job, brief, commission, sources), schemaName: coherent ? "still_curious_evidence_v17" : "still_curious_evidence_v1", jsonSchema: coherent ? FOUNDATION_EVIDENCE_JSON_SCHEMA : EVIDENCE_JSON_SCHEMA,
      parse,
    },
    async finish(result, savedJob) {
      const output = parse(result.value);
      const envelope = artifactEnvelope(result, savedJob, "evidence_pack", version);
      const pack = evidencePackSchema.parse({
        ...envelope, data: {
          ...output, stories: output.stories.map(({ attempted, ...story }) => ({ ...story, ...(attempted === null ? {} : { attempted }) })),
          sourceRecords: artifactRef(sources), commission: artifactRef(commission), evidenceFamilies: evidenceFamilies(sources),
          foundation: { version: "frozen-evidence-v1", sourceRecordsSha256: await sha256(canonicalJson(sources.data)), frozenAt: envelope.createdAt },
        },
      });
      assertReadEvidence(pack, sources);
      if (pack.data.coverageDecision.status === "insufficient") return {
        artifacts: [pack], next: { stage: "research", substep: "synthesize" },
        pause: { code: "needs_input", reason: `The available evidence cannot yet support this episode: ${pack.data.coverageDecision.reason}` },
        progress: { message: "Evidence gap saved for an explicit scope decision", completed: 4 },
      };
      return {
        artifacts: [pack], next: { stage: "casting", substep: "cast" },
        progress: { message: pack.data.coverageDecision.status === "narrowed" ? "Evidence frozen for a narrower supported question" : "Shared evidence pack frozen", completed: 4 },
      };
    },
  };
}
