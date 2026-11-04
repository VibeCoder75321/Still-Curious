import { reviewEvidenceSchema, type EpisodeV2Job } from "../contracts.ts";
import { artifactRefsOfKind, loadPostProduction } from "../post-production.ts";
import { SOURCE_READING_INSTRUCTIONS, SOURCE_READING_JSON_SCHEMA, sourceReadingOutputSchema } from "../prompts/research.ts";
import { canonicalSourceUrl } from "../research-storage.ts";
import type { StepPlan } from "../runner.ts";
import { artifactEnvelope, artifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "../stage-helpers.ts";

export const REVIEW_LOOKUP_PROMPT = { id: "post-conversation-source-reader", version: "1.0.0" } as const;
export async function createReviewLookupPlan(job: EpisodeV2Job, read: ArtifactReader): Promise<StepPlan> {
  const context = await loadPostProduction(job, read), review = await requireLatestArtifact(job, read, "review");
  const edit = await requireLatestArtifact(job, read, "edit_report"), request = review.data.lookupRequest;
  if (job.stage !== "review" || job.substep !== "lookup" || !request || review.data.outcome === "acceptable"
    || review.data.editReport.id !== edit.id || review.data.editReport.version !== edit.version
    || review.data.evidencePack.id !== context.evidence.id || review.data.evidencePack.version !== context.evidence.version
    || edit.data.transcript.id !== context.transcript.id || edit.data.transcript.version !== context.transcript.version) throw new StageBlockedError("A bounded source lookup needs its exact consequential review issue.", "material_review_issue");
  const previous = artifactRefsOfKind(job, "review_evidence");
  if (previous.length >= (job.config.limits.maxPostConversationSourceReads ?? 1)) throw new StageBlockedError("The post-conversation source-reading allowance is exhausted.", "material_review_issue");
  const url = canonicalSourceUrl(request.url), version = (previous.at(-1)?.version ?? 0) + 1;
  return {
    key: `review.lookup:${review.version}`, step: { stage: "review", substep: "lookup" },
    inputs: [context.brief, context.cast, context.evidence, context.sources, context.transcript, edit, review].map(artifactRef),
    prompt: REVIEW_LOOKUP_PROMPT, editorialVersion: context.editorialVersion,
    request: { kind: "source", role: "source", sourceUrl: url, allowInaccessible: true,
      instructions: `${SOURCE_READING_INSTRUCTIONS}\nThis single lookup occurs after the conversation for one consequential editorial question. It cannot alter the frozen pack or accepted speech. Read only the exact requested URL; do not broaden the research. Record what this source actually settles or leaves unresolved for the named issue.`,
      input: JSON.stringify({ reviewIssue: review.data.issues.find(issue => issue.id === request.issueId), question: request.question,
        selectedSource: { url }, savedResearch: context.sources.data, purpose: "A bounded post-conversation supplement for repair and review, separate from the original foundation." }),
      schemaName: "still_curious_review_source_v1", jsonSchema: SOURCE_READING_JSON_SCHEMA, parse: value => sourceReadingOutputSchema.parse(value) },
    finish(result, savedJob) {
      const output = sourceReadingOutputSchema.parse(result.value);
      if (canonicalSourceUrl(output.url) !== url) throw new Error("A review lookup cannot substitute a different source URL");
      const exact = result.actions.filter(action => action.type === "open_page" && action.url && canonicalSourceUrl(action.url) === url);
      const opened = exact.some(action => action.status === "completed"), failed = exact.some(action => action.status === "failed");
      if (!opened && (!failed || output.readingCoverage !== "inaccessible" || output.passages.length)) throw new Error("Unopened review material cannot be accepted as read");
      const envelope = artifactEnvelope(result, savedJob, "review_evidence", version), sourceId = `review-source-${version}`;
      const supplement = reviewEvidenceSchema.parse({ ...envelope, data: { review: artifactRef(review), issueId: request.issueId, question: request.question,
        source: { id: sourceId, title: output.title, url, ...(output.doi ? { doi: output.doi } : {}), authors: output.authors,
          ...(output.publishedOn ? { publishedOn: output.publishedOn } : {}), accessedAt: envelope.createdAt, sourceType: output.sourceType,
          evidenceFamilyId: output.evidenceFamilyId, publicationStatus: output.publicationStatus, notices: output.notices,
          qualifications: output.qualifications, readingCoverage: output.readingCoverage, accessNote: output.accessNote,
          passages: output.passages.map((passage, index) => ({ id: `${sourceId}-passage-${index + 1}`, ...passage })) } } });
      return { artifacts: [supplement], next: { stage: "review", substep: review.data.outcome === "acceptable_with_local_edit" ? "local_edit" : "section_revision" },
        progress: { message: opened ? "Bounded post-conversation source evidence saved separately" : "Inaccessible post-conversation source recorded honestly" } };
    },
  };
}
