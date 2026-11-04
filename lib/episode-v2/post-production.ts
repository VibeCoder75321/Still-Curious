import { z } from "zod";
import { hostPlanSchema, reviewEvidenceSchema, type ArtifactRef, type EpisodeReview, type EpisodeV2Job, type HostPlan, type ReviewEvidence, type SpokenTurn } from "./contracts.ts";
import { requireFrozenEvidence } from "./evidence-foundation.ts";
import { editorialContext } from "./stages/preparation.ts";
import { artifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "./stage-helpers.ts";
import { castForModel } from "./personality-context.ts";

const text = z.string().min(1).refine(value => value.trim().length > 0, "Text must not be blank");
export const patchSchema = z.object({ turnId: text, before: text, after: z.string().nullable(), reason: text }).strict();
export type TurnPatch = z.infer<typeof patchSchema>;
const string = { type: "string", minLength: 1 };
export const PATCH_JSON_SCHEMA = { type: "object", properties: { turnId: string, before: string,
  after: { anyOf: [{ type: "string" }, { type: "null" }] }, reason: string },
  required: ["turnId", "before", "after", "reason"], additionalProperties: false };

/** Exact substring patches retain every unselected byte, speaker and surviving turn ID. */
export function applyTurnPatches(turns: SpokenTurn[], raw: TurnPatch[], allowedIds?: Set<string>) {
  const patches = z.array(patchSchema).max(128).parse(raw);
  if (new Set(patches.map(patch => patch.turnId)).size !== patches.length) throw new Error("Use one unambiguous patch per affected turn");
  const edits = new Map(patches.map(patch => [patch.turnId, patch]));
  if (patches.some(patch => !turns.some(turn => turn.id === patch.turnId) || (allowedIds && !allowedIds.has(patch.turnId)))) throw new Error("A patch targets speech outside the permitted passage or section");
  const editedTurns = turns.flatMap(turn => {
    const patch = edits.get(turn.id); if (!patch) return [{ ...turn }];
    const index = turn.text.indexOf(patch.before);
    if (index < 0 || index !== turn.text.lastIndexOf(patch.before)) throw new Error("The exact affected text must occur once in its saved turn");
    if (patch.after === null) {
      if (patch.before !== turn.text) throw new Error("Removing a turn requires its complete original text");
      return [];
    }
    const text = turn.text.slice(0, index) + patch.after + turn.text.slice(index + patch.before.length);
    if (!text.trim() || text === turn.text) throw new Error("A replacement must produce a nonempty, changed spoken turn");
    return [{ ...turn, text }];
  });
  if (!editedTurns.length) throw new Error("An edit cannot remove the entire episode");
  return { editedTurns, changes: patches.map(patch => ({ sourceTurnIds: [patch.turnId], resultTurnIds: patch.after === null ? [] : [patch.turnId], reason: patch.reason })) };
}

export function artifactRefsOfKind<K extends ArtifactRef["kind"]>(job: EpisodeV2Job, kind: K) {
  return [...Object.values(job.state.artifacts).map(artifactRef), ...Object.values(job.state.artifactBlobs ?? {}).map(blob => blob.artifact)]
    .filter((ref): ref is ArtifactRef & { kind: K } => ref.kind === kind).sort((a, b) => a.version - b.version);
}
export async function loadReviewEvidence(job: EpisodeV2Job, read: ArtifactReader, review: EpisodeReview): Promise<ReviewEvidence[]> {
  const values = await Promise.all(artifactRefsOfKind(job, "review_evidence").map(read));
  return values.map(value => reviewEvidenceSchema.parse(value)).filter(value => value.data.review.id === review.id && value.data.review.version === review.version);
}

export async function loadPostProduction(job: EpisodeV2Job, read: ArtifactReader) {
  const evidence = await requireFrozenEvidence(job, read), brief = await requireLatestArtifact(job, read, "episode_brief");
  const cast = await requireLatestArtifact(job, read, "cast"), sources = await requireLatestArtifact(job, read, "source_records");
  const transcript = await requireLatestArtifact(job, read, "transcript");
  if (!transcript.data.conversation?.closed || transcript.data.showState.nextSpeaker !== null || !transcript.data.turns.length) throw new StageBlockedError("Editing requires the saved closed conversation.");
  if (transcript.data.cast.id !== cast.id || transcript.data.cast.version !== cast.version
    || transcript.data.evidencePack.id !== evidence.id || transcript.data.evidencePack.version !== evidence.version) throw new StageBlockedError("The completed conversation uses a different cast or evidence foundation.");
  // Use the plan actually supplied to the recording, never a newer preparation.
  // Older transcripts without a pinned plan remain reviewable on their own merits.
  const planRef = transcript.provenance.inputVersions.find(ref => ref.kind === "host_plan");
  let hostPlan: HostPlan | null = null;
  if (planRef) {
    try { hostPlan = hostPlanSchema.parse(await read(planRef)); }
    catch { throw new StageBlockedError("The recorded host plan is unavailable or invalid. Restore its exact saved version before reviewing."); }
  }
  const same = (a: ArtifactRef, b: ArtifactRef) => a.id === b.id && a.kind === b.kind && a.version === b.version;
  if (hostPlan && (!same(artifactRef(hostPlan), planRef!)
    || !same(hostPlan.data.episodeBrief, artifactRef(brief))
    || !same(hostPlan.data.evidencePack, artifactRef(evidence))
    || !same(hostPlan.data.cast, artifactRef(cast)))) {
    throw new StageBlockedError("The recorded host plan uses a different episode brief, cast or evidence foundation.");
  }
  const editorial = await editorialContext(job, brief);
  const editorialVersion = `${editorial.editorialVersion}/post-production-2`;
  const inputs = [brief, cast, evidence, sources, transcript, ...(hostPlan ? [hostPlan] : [])].map(artifactRef);
  return { brief, cast, evidence, sources, transcript, editorialVersion, inputs,
    commonInput: { episodeBrief: { reference: artifactRef(brief), ...brief.data }, cast: castForModel(cast),
      narrativePlan: hostPlan ? { reference: artifactRef(hostPlan), priorities: hostPlan.data.priorities,
        returnPoint: hostPlan.data.returnPoint, endingAim: hostPlan.data.endingAim } : null,
      frozenEvidencePack: { reference: artifactRef(evidence), ...evidence.data }, sourceRecords: sources.data,
      frameworkGuidance: editorial.frameworkGuidance, originalProgrammeBrief: editorial.originalProgrammeBrief,
      selectedDuration: { targetDurationSeconds: job.config.targetDurationSeconds, spokenWordTarget: job.config.spokenWordTarget,
        audioCharacterAllowance: job.config.audio.maxCharacters },
      acceptedTranscriptReference: artifactRef(transcript) } };
}
