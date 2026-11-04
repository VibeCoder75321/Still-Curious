import {
  guestPreparationSchema, guestSpeakerSchema, hostPlanSchema, transcriptSchema,
  type ArtifactRef, type EpisodeV2Job, type GuestSpeaker,
} from "../contracts.ts";
import { requireFrozenEvidence } from "../evidence-foundation.ts";
import { conversationObservations } from "../conversation-observations.ts";
import { compatiblePreparationPrompt } from "../prompts/compatibility.ts";
import { CASTING_GUIDANCE_VERSION, CASTING_PROMPT } from "../prompts/casting.ts";
import { GUEST_PREPARATION_PROMPT } from "../prompts/guest-preparation.ts";
import { HOST_PREPARATION_PROMPT } from "../prompts/host-preparation.ts";
import { FRAMEWORK_VERSION } from "../prompts/producer.ts";
import { artifactRef, latestArtifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "../stage-helpers.ts";
import { editorialContext, readingBundle, validateGuestEvidence, validateHostPreparation } from "../stages/preparation.ts";
import { castForModel, guestForModel, isCoherentCast, castPromptVersion } from "../personality-context.ts";

export const ROLE_GUIDANCE_VERSION = "speaking-roles-1";
const sameRef = (a: ArtifactRef | undefined, b: ArtifactRef) => !!a && a.id === b.id && a.kind === b.kind && a.version === b.version;
const hasInputs = (artifact: { provenance: { inputVersions: ArtifactRef[] } }, refs: ArtifactRef[]) => refs.every(ref => artifact.provenance.inputVersions.some(input => sameRef(input, ref)));

async function foundation(job: EpisodeV2Job, read: ArtifactReader) {
  if (job.stage !== "conversation") throw new StageBlockedError("Complete preparation before requesting a speaking role.");
  const evidence = await requireFrozenEvidence(job, read);
  const brief = await requireLatestArtifact(job, read, "episode_brief");
  const cast = await requireLatestArtifact(job, read, "cast");
  const sources = await requireLatestArtifact(job, read, "source_records");
  const editorial = await editorialContext(job, brief);
  const coreRefs = [artifactRef(brief), artifactRef(evidence), artifactRef(cast)];
  if (!sameRef(cast.data.evidencePack, artifactRef(evidence)) || !hasInputs(cast, coreRefs.slice(0, 2))
    || !compatiblePreparationPrompt(cast.provenance.prompt, CASTING_PROMPT)
    || cast.provenance.editorialVersion !== `framework-${FRAMEWORK_VERSION}/${CASTING_GUIDANCE_VERSION}`) {
    throw new StageBlockedError("The speaking cast does not match the frozen evidence and episode brief.");
  }
  const hostPlan = hostPlanSchema.parse(await requireLatestArtifact(job, read, "host_plan"));
  if (isCoherentCast(cast)) {
    const { episodeBrief: _brief, evidencePack: _evidence, cast: _cast, guestPreparations: _notes, ...content } = hostPlan.data;
    validateHostPreparation(content, evidence, true);
  }
  if (!sameRef(hostPlan.data.episodeBrief, artifactRef(brief)) || !sameRef(hostPlan.data.evidencePack, artifactRef(evidence))
    || !sameRef(hostPlan.data.cast, artifactRef(cast)) || !hasInputs(hostPlan, coreRefs)
    || !compatiblePreparationPrompt(hostPlan.provenance.prompt, HOST_PREPARATION_PROMPT)
    || hostPlan.provenance.editorialVersion !== editorial.editorialVersion) {
    throw new StageBlockedError("The host plan uses different preparation inputs. Review it before recording.");
  }
  const transcriptRef = latestArtifactRef(job, "transcript");
  const transcript = transcriptRef ? transcriptSchema.parse(await read(transcriptRef)) : null;
  if (transcript && (!sameRef(artifactRef(transcript), transcriptRef!)
    || !sameRef(transcript.data.cast, artifactRef(cast)) || !sameRef(transcript.data.evidencePack, artifactRef(evidence)))) {
    throw new StageBlockedError("The accepted transcript uses a different cast or evidence foundation.");
  }
  const refs = [...coreRefs, artifactRef(sources), artifactRef(hostPlan), ...(transcript ? [artifactRef(transcript)] : [])];
  return { evidence, brief, cast, sources, hostPlan, transcript, editorial, refs };
}
type Foundation = Awaited<ReturnType<typeof foundation>>;

async function guestNote(data: Foundation, read: ArtifactReader, speaker: GuestSpeaker) {
  const ref = data.hostPlan.data.guestPreparations[speaker];
  let note;
  try { note = guestPreparationSchema.parse(await read(ref)); }
  catch { throw new StageBlockedError("A required guest preparation note is missing or cannot be verified."); }
  if (!sameRef(artifactRef(note), ref) || note.data.speaker !== speaker || !sameRef(note.data.cast, artifactRef(data.cast)) || !sameRef(note.data.evidencePack, artifactRef(data.evidence))
    || !hasInputs(note, [data.brief, data.evidence, data.cast, data.sources].map(artifactRef))
    || !hasInputs(data.hostPlan, [artifactRef(note)])
    || !compatiblePreparationPrompt(note.provenance.prompt, GUEST_PREPARATION_PROMPT)
    || note.provenance.editorialVersion !== data.editorial.editorialVersion) {
    throw new StageBlockedError("A guest note uses different cast, evidence or editorial inputs. Review it before recording.");
  }
  const { speaker: _speaker, cast: _cast, evidencePack: _evidence, ...content } = note.data;
  try { validateGuestEvidence(content, data.evidence, isCoherentCast(data.cast)); }
  catch { throw new StageBlockedError("A guest note has unsupported preparation references. Review it before recording."); }
  return note;
}

function commonInput(job: EpisodeV2Job, data: Foundation) {
  return {
    episodeBrief: { reference: artifactRef(data.brief), ...data.brief.data },
    commonBriefing: data.evidence.data.commonBriefing,
    completeEvidencePack: { reference: artifactRef(data.evidence), ...data.evidence.data },
    frameworkGuidance: { ...data.editorial.frameworkGuidance, roleGuidanceVersion: ROLE_GUIDANCE_VERSION },
    originalProgrammeBrief: data.editorial.originalProgrammeBrief,
    acceptedTranscript: { reference: data.transcript ? artifactRef(data.transcript) : null, turns: data.transcript?.data.turns ?? [] },
    showState: data.transcript?.data.showState ?? {
      currentTopic: data.evidence.data.coverageDecision.centralQuestion, unresolvedQuestions: data.evidence.data.openQuestions,
      detourReturnPoint: null, nextSpeaker: "host", estimatedSpokenSeconds: 0,
    },
    selectedDuration: { targetDurationSeconds: job.config.targetDurationSeconds, introductionTargetSeconds: job.config.introductionTargetSeconds,
      ...(isCoherentCast(data.cast) ? { spokenWordTarget: job.config.spokenWordTarget, spokenWordsSoFar: conversationObservations(data.transcript?.data.turns ?? []).totalWords } : {}),
      remainingApproximateSeconds: Math.max(0, job.config.targetDurationSeconds - (data.transcript?.data.showState.estimatedSpokenSeconds ?? 0)) },
  };
}

export async function hostRoleContext(job: EpisodeV2Job, read: ArtifactReader) {
  const data = await foundation(job, read);
  const notes = await Promise.all((["expert1", "expert2", "expert3"] as const).map(speaker => guestNote(data, read, speaker)));
  return {
    hostCastBrief: data.cast.data.personality?.host_cast_brief,
    coherent: isCoherentCast(data.cast), promptVersion: castPromptVersion(data.cast),
    inputs: [...data.refs, ...notes.map(artifactRef)], editorialVersion: `${data.editorial.editorialVersion}/${ROLE_GUIDANCE_VERSION}`,
    input: { ...commonInput(job, data), ownProfile: data.cast.data.host, cast: castForModel(data.cast),
      hostPlan: { reference: artifactRef(data.hostPlan), ...data.hostPlan.data },
      guestPreparationSummaries: notes.map(note => ({ reference: artifactRef(note), ...note.data })),
      stanceUpdates: data.transcript?.data.stanceUpdates ?? [], hostDecisions: data.transcript?.data.hostDecisions ?? [],
      participation: conversationObservations(data.transcript?.data.turns ?? []),
      contributionRequests: data.transcript?.data.conversation?.requests ?? [],
      responseOpportunity: data.transcript?.data.conversation?.responseDue ?? null,
      queuedResponses: data.transcript?.data.conversation?.responseQueue ?? [] },
  };
}

export async function guestRoleContext(job: EpisodeV2Job, read: ArtifactReader, speaker: GuestSpeaker) {
  guestSpeakerSchema.parse(speaker);
  const data = await foundation(job, read), note = await guestNote(data, read, speaker);
  if (!data.transcript?.data.turns.length) throw new StageBlockedError("A guest needs the accepted preceding exchange before responding or bidding.");
  const ownProfile = guestForModel(data.cast, speaker);
  return {
    personality: data.cast.data.personality?.cast.find(guest => guest.id === speaker),
    promptVersion: castPromptVersion(data.cast),
    inputs: [...data.refs, artifactRef(note)], editorialVersion: `${data.editorial.editorialVersion}/${ROLE_GUIDANCE_VERSION}`,
    input: { ...commonInput(job, data), ownProfile, ownPreparation: { reference: artifactRef(note), ...note.data },
      relevantReadingBundle: readingBundle(data.evidence, data.sources, ownProfile),
      currentQuestionOrContribution: data.transcript.data.turns.at(-1)!,
      currentInvitation: data.transcript.data.conversation?.invitation ?? data.transcript.data.hostDecisions.at(-1) ?? null,
      ownStanceUpdates: data.transcript.data.stanceUpdates.filter(update => update.speaker === speaker) },
  };
}
