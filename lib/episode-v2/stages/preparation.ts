import {
  guestPreparationSchema, hostPlanSchema, type ArtifactRef, type Cast, type EpisodeBrief,
  type EpisodeV2Job, type EvidencePack, type GuestPreparation, type GuestSpeaker, type SourceRecords,
} from "../contracts.ts";
import { requireFrozenEvidence } from "../evidence-foundation.ts";
import { sha256 } from "../persistence.ts";
import {
  artifactEnvelope, artifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader,
} from "../stage-helpers.ts";
import {
  GUEST_PREPARATION_INSTRUCTIONS, GUEST_PREPARATION_JSON_SCHEMA, GUEST_PREPARATION_PROMPT,
  PREPARATION_GUIDANCE, PREPARATION_GUIDANCE_VERSION, guestPreparationOutputSchema, type GuestPreparationOutput,
  positionedGuestPreparationOutputSchema, POSITIONED_GUEST_PREPARATION_JSON_SCHEMA,
} from "../prompts/guest-preparation.ts";
import {
  HOST_PREPARATION_INSTRUCTIONS, HOST_PREPARATION_JSON_SCHEMA, HOST_PREPARATION_PROMPT, hostPreparationOutputSchema,
  discussionHostPreparationOutputSchema, DISCUSSION_HOST_PREPARATION_JSON_SCHEMA,
} from "../prompts/host-preparation.ts";
import { FRAMEWORK_SOURCE_SHA256, FRAMEWORK_VERSION, GUIDANCE_VERSION } from "../prompts/producer.ts";
import { compatiblePreparationPrompt } from "../prompts/compatibility.ts";
import type { StepPlan } from "../runner.ts";
import { castForModel, guestForModel, castPromptVersion, isCoherentCast } from "../personality-context.ts";
import { PERSONALITY_PRIORITY } from "../personality.ts";
import { POSITION_INSTRUCTIONS, DISCUSSION_PLAN_INSTRUCTIONS, type Position } from "../discussion-design.ts";

export const GUEST_SPEAKERS = ["expert1", "expert2", "expert3"] as const;
export const guestPreparationId = (speaker: GuestSpeaker) => `guest-preparation:${speaker}:1`;
export const guestPreparationKey = (speaker: GuestSpeaker) => `preparation.${speaker}:1`;
export const HOST_PLAN_ID = "host-plan:1";
export const HOST_PREPARATION_STEP_KEY = "preparation.host:1";
const sameRef = (a: ArtifactRef | undefined, b: ArtifactRef) => !!a && a.id === b.id && a.kind === b.kind && a.version === b.version;

export async function editorialContext(job: EpisodeV2Job, brief: EpisodeBrief) {
  const editorial = brief.data.editorialInputs;
  if (!editorial || editorial.frameworkVersion !== FRAMEWORK_VERSION
    || editorial.frameworkSourceSha256 !== FRAMEWORK_SOURCE_SHA256 || editorial.guidanceVersion !== GUIDANCE_VERSION) {
    throw new StageBlockedError("The episode brief's editorial metadata is missing or changed. Review it before preparing the speakers.");
  }
  const programme = job.state.programmeBrief;
  if (programme && (new TextEncoder().encode(programme.text).length > 65_536 || await sha256(programme.text) !== programme.sha256)) {
    throw new StageBlockedError("The saved original programme brief does not match its version hash or exceeds its allowance.");
  }
  const commissioned = editorial.programmeBrief;
  if (programme
    ? !commissioned || commissioned.id !== programme.id || commissioned.version !== programme.version || commissioned.sha256 !== programme.sha256
    : commissioned !== null) {
    throw new StageBlockedError("The programme brief changed after commissioning. Review the affected preparation before continuing.");
  }
  return {
    editorialVersion: `framework-${FRAMEWORK_VERSION}/${PREPARATION_GUIDANCE_VERSION}${programme ? `/programme-${programme.id}@${programme.version}:${programme.sha256}` : "/original-unavailable"}`,
    frameworkGuidance: { version: FRAMEWORK_VERSION, sourceSha256: FRAMEWORK_SOURCE_SHA256, guidanceVersion: PREPARATION_GUIDANCE_VERSION, text: PREPARATION_GUIDANCE },
    originalProgrammeBrief: programme ? { status: "available", ...programme } : { status: "not_available", note: "No verified verbatim original programme brief has been supplied. Do not reconstruct it." },
  };
}

async function inputs(job: EpisodeV2Job, read: ArtifactReader) {
  const evidence = await requireFrozenEvidence(job, read);
  const cast = await requireLatestArtifact(job, read, "cast");
  const brief = await requireLatestArtifact(job, read, "episode_brief");
  const evidenceRef = artifactRef(evidence), briefRef = artifactRef(brief);
  if (!sameRef(cast.data.evidencePack, evidenceRef)
    || !cast.provenance.inputVersions.some(ref => sameRef(ref, evidenceRef))
    || !cast.provenance.inputVersions.some(ref => sameRef(ref, briefRef))) {
    throw new StageBlockedError("The cast was not prepared against the current frozen evidence and episode brief. Review the affected preparation.");
  }
  const sourceArtifact = await read(evidence.data.sourceRecords);
  if (sourceArtifact.kind !== "source_records") throw new StageBlockedError("Saved evidence source material is unavailable.");
  const context = await editorialContext(job, brief);
  return { evidence, cast, brief, sources: sourceArtifact, context };
}

export function validateGuestEvidence(value: unknown, evidence: EvidencePack, requirePosition = false) {
  const note: GuestPreparationOutput & { position?: Position } = requirePosition ? positionedGuestPreparationOutputSchema.parse(value) : guestPreparationOutputSchema.parse(value);
  const claims = new Map(evidence.data.claims.map(claim => [claim.id, claim]));
  if (new Set(note.supportingClaims).size !== note.supportingClaims.length
    || note.supportingClaims.some(id => !claims.has(id) || ["outside_material_read", "contradicted"].includes(claims.get(id)!.supportStatus))) {
    throw new Error("Guest support must identify distinct supported, provisional or contested claims in the frozen pack");
  }
  const stories = new Set(evidence.data.stories.map(story => story.id));
  if (new Set(note.examplesOrStories).size !== note.examplesOrStories.length || note.examplesOrStories.some(id => !stories.has(id))) {
    throw new Error("Guest examples must identify distinct documented stories in the frozen pack");
  }
  if (note.position && (new Set(note.position.claimIds).size !== note.position.claimIds.length || note.position.claimIds.some(id => !note.supportingClaims.includes(id)))) {
    throw new Error("A defended position must cite distinct claims from the guest's validated supporting evidence");
  }
  return note;
}

export function validateHostPreparation(value: unknown, evidence: EvidencePack, coherent: boolean) {
  if (!coherent) return hostPreparationOutputSchema.parse(value);
  const plan = discussionHostPreparationOutputSchema.parse(value);
  const claims = new Set(evidence.data.claims.filter(c => !["outside_material_read", "contradicted"].includes(c.supportStatus)).map(c => c.id));
  for (const point of plan.discussionPoints) {
    if (new Set(point.guests).size !== point.guests.length || new Set(point.claimIds).size !== point.claimIds.length || point.claimIds.some(id => !claims.has(id))) {
      throw new Error("A planned discussion needs distinct guests and valid shared evidence");
    }
  }
  return plan;
}

export function readingBundle(evidence: EvidencePack, sources: SourceRecords, guest: Cast["data"]["guests"][number]) {
  const sharedClaims = new Set(guest.evidencePerspective?.sharedClaimIds ?? evidence.data.centralClaimIds ?? []);
  const words = new Set([...guest.expertise, ...guest.trustedMethods].join(" ").toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const extracts = (evidence.data.specialistExtracts ?? []).filter(extract =>
    extract.claimIds.some(id => sharedClaims.has(id)) || [...words].some(word => extract.lens.toLowerCase().includes(word)));
  const claimIds = new Set([...sharedClaims, ...extracts.flatMap(extract => extract.claimIds)]);
  const storyIds = new Set(extracts.flatMap(extract => extract.storyIds));
  const interpretationIds = new Set(extracts.flatMap(extract => extract.interpretationIds));
  const refs = [
    ...evidence.data.claims.filter(claim => claimIds.has(claim.id)).flatMap(claim => claim.passages),
    ...evidence.data.stories.filter(story => storyIds.has(story.id)).flatMap(story => story.passages),
    ...evidence.data.interpretations.filter(item => interpretationIds.has(item.id)).flatMap(item => item.passages),
  ];
  return {
    evidencePack: artifactRef(evidence), extracts,
    passages: sources.data.sources.flatMap(source => source.passages.filter(passage => refs.some(ref => ref.sourceId === source.id && ref.passageId === passage.id))
      .map(passage => ({ sourceId: source.id, title: source.title, url: source.url, publicationStatus: source.publicationStatus, notices: source.notices, ...passage }))),
  };
}

function commonInput(job: EpisodeV2Job, data: Awaited<ReturnType<typeof inputs>>) {
  return {
    episodeBrief: { reference: artifactRef(data.brief), ...data.brief.data },
    selectedDuration: { lengthMinutes: job.lengthMinutes, targetDurationSeconds: job.config.targetDurationSeconds, introductionTargetSeconds: job.config.introductionTargetSeconds,
      ...(isCoherentCast(data.cast) ? { spokenWordTarget: job.config.spokenWordTarget } : {}) },
    frameworkGuidance: data.context.frameworkGuidance, originalProgrammeBrief: data.context.originalProgrammeBrief,
    commonBriefing: data.evidence.data.commonBriefing,
    completeEvidencePack: { reference: artifactRef(data.evidence), ...data.evidence.data },
  };
}

/** The complete cast is hashed as an input, but only this guest's profile crosses the provider boundary. */
export async function createGuestPreparationPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  if (!GUEST_SPEAKERS.includes(job.substep as GuestSpeaker)) throw new StageBlockedError("Choose a saved guest preparation substep before continuing.");
  const speaker = job.substep as GuestSpeaker, key = guestPreparationKey(speaker), id = guestPreparationId(speaker);
  const data = await inputs(job, read), ownProfile = guestForModel(data.cast, speaker);
  const personalized = !!data.cast.data.personality;
  const coherent = isCoherentCast(data.cast);
  if ((job.state.artifacts[id] || job.state.artifactBlobs?.[id]) && job.state.execution?.steps[key]?.phase !== "completed") {
    throw new StageBlockedError("This guest's saved preparation has no completed attempt. Reconcile it before preparing again.");
  }
  const index = GUEST_SPEAKERS.indexOf(speaker);
  return {
    key, step: { stage: "preparation", substep: speaker },
    inputs: [artifactRef(data.brief), artifactRef(data.evidence), artifactRef(data.cast), artifactRef(data.sources)],
    prompt: personalized ? { ...GUEST_PREPARATION_PROMPT, version: castPromptVersion(data.cast) } : GUEST_PREPARATION_PROMPT, editorialVersion: data.context.editorialVersion,
    request: {
      kind: "structured", role: "guest_preparation", instructions: GUEST_PREPARATION_INSTRUCTIONS + (personalized ? `\n\n${PERSONALITY_PRIORITY}\nRead your own saved personalityGuidance as preparation context. Develop your substantive position from the evidence and expertise, never random traits. Produce the required editorial note, not spoken dialogue.` : "") + (coherent ? `\n\n${POSITION_INSTRUCTIONS}` : ""),
      input: JSON.stringify({ ...commonInput(job, data), ownProfile, relevantReadingBundle: readingBundle(data.evidence, data.sources, ownProfile) }),
      schemaName: coherent ? "still_curious_guest_preparation_v17" : "still_curious_guest_preparation_v1", jsonSchema: coherent ? POSITIONED_GUEST_PREPARATION_JSON_SCHEMA : GUEST_PREPARATION_JSON_SCHEMA,
      parse: value => validateGuestEvidence(value, data.evidence, coherent),
    },
    finish(result, savedJob) {
      const note = validateGuestEvidence(result.value, data.evidence, coherent);
      const artifact = guestPreparationSchema.parse({
        ...artifactEnvelope(result, savedJob, "guest_preparation", 1, id),
        data: { speaker, cast: artifactRef(data.cast), evidencePack: artifactRef(data.evidence), ...note },
      });
      return {
        artifacts: [artifact], next: { stage: "preparation", substep: GUEST_SPEAKERS[index + 1] ?? "host" },
        progress: { message: `${ownProfile.name}'s independent preparation saved`, preparedGuests: index + 1 },
      };
    },
  };
}

export async function createHostPreparationPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  const data = await inputs(job, read), preparations: GuestPreparation[] = [];
  const coherent = isCoherentCast(data.cast);
  for (const speaker of GUEST_SPEAKERS) {
    const ref = { id: guestPreparationId(speaker), kind: "guest_preparation" as const, version: 1 };
    let note;
    try { note = await read(ref); }
    catch { throw new StageBlockedError("A guest's saved preparation is missing or cannot be verified. Complete the independent guest notes before preparing the host."); }
    if (note.kind !== "guest_preparation" || note.data.speaker !== speaker
      || !sameRef(note.data.cast, artifactRef(data.cast)) || !sameRef(note.data.evidencePack, artifactRef(data.evidence))
      || !note.provenance.inputVersions.some(input => sameRef(input, artifactRef(data.cast)))
      || !note.provenance.inputVersions.some(input => sameRef(input, artifactRef(data.evidence)))
      || !note.provenance.inputVersions.some(input => sameRef(input, artifactRef(data.brief)))
      || !note.provenance.inputVersions.some(input => sameRef(input, artifactRef(data.sources)))
      || note.provenance.editorialVersion !== data.context.editorialVersion
      || !compatiblePreparationPrompt(note.provenance.prompt, GUEST_PREPARATION_PROMPT)) {
      throw new StageBlockedError("A guest's saved preparation uses different cast, evidence or editorial inputs. Review it before preparing the host.");
    }
    const { speaker: _speaker, cast: _cast, evidencePack: _evidence, ...content } = note.data;
    validateGuestEvidence(content, data.evidence, coherent); preparations.push(note);
  }
  if ((job.state.artifacts[HOST_PLAN_ID] || job.state.artifactBlobs?.[HOST_PLAN_ID]) && job.state.execution?.steps[HOST_PREPARATION_STEP_KEY]?.phase !== "completed") {
    throw new StageBlockedError("The saved host plan has no completed attempt. Reconcile it before preparing again.");
  }
  return {
    key: HOST_PREPARATION_STEP_KEY, step: { stage: "preparation", substep: "host" },
    inputs: [artifactRef(data.brief), artifactRef(data.evidence), artifactRef(data.cast), ...preparations.map(artifactRef)],
    prompt: data.cast.data.personality ? { ...HOST_PREPARATION_PROMPT, version: castPromptVersion(data.cast) } : HOST_PREPARATION_PROMPT, editorialVersion: data.context.editorialVersion,
    request: {
      kind: "structured", role: "host_preparation", instructions: HOST_PREPARATION_INSTRUCTIONS + (data.cast.data.personality ? `\n\n${PERSONALITY_PRIORITY}\nUse cast.hostCastBrief to plan invitations that suit the saved cast. Keep the host's established manner, let real disagreements develop, preserve accurate expressive language, and bound expansive answers without prescribing guest conclusions.` : "") + (coherent ? `\n\n${DISCUSSION_PLAN_INSTRUCTIONS}` : ""),
      input: JSON.stringify({ ...commonInput(job, data), cast: castForModel(data.cast), guestPreparationSummaries: preparations.map(note => ({ reference: artifactRef(note), ...note.data })) }),
      schemaName: coherent ? "still_curious_host_preparation_v17" : "still_curious_host_preparation_v1", jsonSchema: coherent ? DISCUSSION_HOST_PREPARATION_JSON_SCHEMA : HOST_PREPARATION_JSON_SCHEMA, parse: value => validateHostPreparation(value, data.evidence, coherent),
    },
    finish(result, savedJob) {
      const output = validateHostPreparation(result.value, data.evidence, coherent);
      const artifact = hostPlanSchema.parse({
        ...artifactEnvelope(result, savedJob, "host_plan", 1, HOST_PLAN_ID),
        data: {
          episodeBrief: artifactRef(data.brief), evidencePack: artifactRef(data.evidence), cast: artifactRef(data.cast),
          guestPreparations: Object.fromEntries(preparations.map(note => [note.data.speaker, artifactRef(note)])), ...output,
        },
      });
      return { artifacts: [artifact], next: { stage: "conversation", substep: "host" }, progress: { message: "Three independent guest notes and a flexible host plan saved", preparedGuests: 3 } };
    },
  };
}
