import {
  assertEvidencePackSources, evidencePackSchema, type EvidencePack, type EpisodeV2Job, type SourceRecords,
} from "./contracts.ts";
import { canonicalJson, sha256 } from "./persistence.ts";
import { artifactRef, requireLatestArtifact, StageBlockedError, type ArtifactReader } from "./stage-helpers.ts";

export function evidenceFamilies(records: SourceRecords): { id: string; sourceIds: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const source of records.data.sources) groups.set(source.evidenceFamilyId, [...(groups.get(source.evidenceFamilyId) ?? []), source.id]);
  return [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([id, sourceIds]) => ({ id, sourceIds: sourceIds.sort() }));
}

/** Validate traceability and coverage boundaries, not the truth of prose by string matching. */
export function assertReadEvidence(pack: EvidencePack, records: SourceRecords): void {
  assertEvidencePackSources(pack, records);
  const sources = new Map(records.data.sources.map(source => [source.id, source]));
  const claims = new Map(pack.data.claims.map(claim => [claim.id, claim]));
  const central = pack.data.centralClaimIds;
  if (!central || new Set(central).size !== central.length || central.some(id => !claims.has(id))) throw new Error("Central finding IDs must identify distinct saved claims");
  if (pack.data.coverageDecision.status !== "insufficient" && !central.length) throw new Error("Proceeding requires a supported central account");
  if (!pack.data.specialistExtracts?.length) throw new Error("The shared pack needs linked specialist extracts");
  if (new Set(pack.data.specialistExtracts.map(extract => extract.id)).size !== pack.data.specialistExtracts.length) throw new Error("Specialist extract IDs must be unique");
  const storyIds = new Set(pack.data.stories.map(story => story.id)), interpretationIds = new Set(pack.data.interpretations.map(item => item.id));
  for (const extract of pack.data.specialistExtracts) {
    if (extract.claimIds.some(id => !claims.has(id)) || extract.storyIds.some(id => !storyIds.has(id)) || extract.interpretationIds.some(id => !interpretationIds.has(id))) throw new Error("A specialist extract references material absent from the complete pack");
    if (pack.data.coverageDecision.status !== "insufficient" && ![...extract.claimIds, ...extract.storyIds, ...extract.interpretationIds].length) throw new Error("A specialist extract must link its supporting material");
  }
  if (canonicalJson(pack.data.evidenceFamilies) !== canonicalJson(evidenceFamilies(records))) throw new Error("Evidence families must retain the saved source relationships");
  const checkPassages = (refs: { sourceId: string; passageId: string }[], qualifications: string[], affirmative: boolean) => {
    if (!refs.length) throw new Error("Read evidence needs saved passages");
    for (const reference of refs) {
      const source = sources.get(reference.sourceId)!, passage = source.passages.find(p => p.id === reference.passageId)!;
      const body = passage.coverage === "body" && ["partial", "full"].includes(source.readingCoverage);
      const abstract = passage.coverage === "abstract" && ["abstract", "partial", "full"].includes(source.readingCoverage);
      if (!body && !abstract) throw new Error("Snippets, discovered and inaccessible sources cannot ground read evidence");
      if ((abstract || ["corrected", "expression_of_concern", "retracted"].includes(source.publicationStatus)) && !qualifications.length) throw new Error("Limited access or publication notices require an explicit qualification");
      if (affirmative && source.publicationStatus === "retracted") throw new Error("Retracted material cannot affirm a finding");
    }
  };
  for (const claim of pack.data.claims) {
    if (!claim.basis) throw new Error("Each finding must distinguish observation, inference and interpretation");
    if (claim.supportStatus === "outside_material_read") {
      if (central.includes(claim.id)) throw new Error("A central finding must trace to material actually read");
      continue;
    }
    checkPassages(claim.passages, claim.qualifications, claim.supportStatus !== "contradicted");
  }
  for (const story of pack.data.stories) {
    if (!story.documentedDetails.length || !story.qualifications.length) throw new Error("Story details and their qualifications must be preserved");
    checkPassages(story.passages, story.qualifications, false);
  }
  for (const interpretation of pack.data.interpretations) {
    // An interpretation may discuss a challenged or historical account. Its standing
    // and strongest objection retain the qualification rather than pretending it is a finding.
    checkPassages(interpretation.passages, [interpretation.currentStanding, interpretation.strongestObjection], false);
  }
}

/** Casting and every preparation step call this; no fresh web access is needed. */
export async function requireFrozenEvidence(job: EpisodeV2Job, read: ArtifactReader): Promise<EvidencePack> {
  const pack = evidencePackSchema.parse(await requireLatestArtifact(job, read, "evidence_pack"));
  const sources = await requireLatestArtifact(job, read, "source_records");
  const commission = await requireLatestArtifact(job, read, "research_commission");
  const brief = await requireLatestArtifact(job, read, "episode_brief");
  if (!pack.data.foundation || pack.data.coverageDecision.status === "insufficient") throw new StageBlockedError("The evidence is not ready: review its coverage decision before casting or preparation.");
  if (canonicalJson(pack.data.sourceRecords) !== canonicalJson(artifactRef(sources))
    || canonicalJson(pack.data.commission) !== canonicalJson(artifactRef(commission))
    || canonicalJson(commission.data.episodeBrief) !== canonicalJson(artifactRef(brief))
    || pack.data.foundation.sourceRecordsSha256 !== await sha256(canonicalJson(sources.data))) {
    throw new StageBlockedError("The research foundation changed. Review and freeze a new evidence pack, then replace affected preparation before continuing.");
  }
  try { assertReadEvidence(pack, sources); }
  catch { throw new StageBlockedError("The frozen evidence pack has unresolved reading or reference gaps. Review its foundation before continuing."); }
  return pack;
}
