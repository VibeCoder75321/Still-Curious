import { assertFinalScriptApproved, type EpisodeV2Job } from "./contracts.ts";
import { artifactRefsOfKind } from "./post-production.ts";
import { latestArtifactRef, requireLatestArtifact, type ArtifactReader } from "./stage-helpers.ts";

/** Downloaded editorial material is separate from polling views and excludes private preparation/accounting. */
export async function transcriptExport(job: EpisodeV2Job, read: ArtifactReader) {
  const transcript = await requireLatestArtifact(job, read, "transcript");
  const cast = await read(transcript.data.cast);
  if (cast.kind !== "cast") throw new Error("The transcript cast is unavailable");
  const editRef = latestArtifactRef(job, "edit_report"), currentEdit = editRef ? await read(editRef) : null;
  const reviewRef = latestArtifactRef(job, "review"), currentReview = reviewRef ? await read(reviewRef) : null;
  let finalScript = null;
  if (job.state.finalScript) {
    const script = await read(job.state.finalScript);
    if (script.kind !== "final_script") throw new Error("The saved final script is unavailable");
    const review = await read(script.data.review), edit = await read(script.data.editReport);
    if (review.kind !== "review" || edit.kind !== "edit_report") throw new Error("The exact approved edit and review are unavailable");
    assertFinalScriptApproved(script, review, edit);
    finalScript = { version: script.version, turns: script.data.turns,
      editVersion: edit.version, reviewVersion: review.version, reviewOutcome: review.data.outcome };
  }
  return {
    episodeId: job.id, title: job.title ?? job.topic, pipelineVersion: 2, textReady: finalScript !== null,
    speakers: [cast.data.host, ...cast.data.guests].map(profile => ({ id: profile.speaker, name: profile.name })),
    acceptedTranscript: { version: transcript.version, turns: transcript.data.turns },
    ...(currentEdit?.kind === "edit_report" ? { editedTranscript: { version: currentEdit.version, turns: currentEdit.data.editedTurns } } : {}),
    ...(currentReview?.kind === "review" ? { review: { version: currentReview.version, outcome: currentReview.data.outcome,
      summary: currentReview.data.summary, notes: currentReview.data.notes, issues: currentReview.data.issues } } : {}),
    finalScript,
  };
}

export async function researchExport(job: EpisodeV2Job, read: ArtifactReader) {
  const packRef = latestArtifactRef(job, "evidence_pack"), pack = packRef ? await read(packRef) : null;
  const sourcesRef = pack?.kind === "evidence_pack" ? pack.data.sourceRecords : latestArtifactRef(job, "source_records");
  if (!sourcesRef) throw new Error("Research has not been saved yet");
  const sources = await read(sourcesRef);
  if (sources.kind !== "source_records") throw new Error("The saved source records are unavailable");
  const supplements = await Promise.all(artifactRefsOfKind(job, "review_evidence").map(read));
  return { episodeId: job.id, title: job.title ?? job.topic, pipelineVersion: 2, originalRequest: job.topic,
    sourceVersion: sources.version, sources: sources.data.sources,
    ...(sources.data.research ? { coverage: sources.data.research } : {}),
    ...(pack?.kind === "evidence_pack" ? { evidenceVersion: pack.version, evidencePack: pack.data } : {}),
    postConversationEvidence: supplements.flatMap(value => value.kind === "review_evidence"
      ? [{ issueId: value.data.issueId, question: value.data.question, source: value.data.source }] : []),
  };
}
