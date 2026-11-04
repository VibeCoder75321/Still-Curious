import { sourceRecordsSchema, type EpisodeV2Job, type ResearchCommission, type SourceRecord, type SourceRecords, type Step } from "./contracts.ts";
import { createModelPolicy } from "./model-policy.ts";
import { quoteOperation, type ProviderResult } from "./providers.ts";
import { allowanceUsed, reserveUsage } from "./usage.ts";
import { artifactEnvelope, artifactRef, StageBlockedError } from "./stage-helpers.ts";
import type { DiscoveryOutput, SourceReadingOutput } from "./prompts/research.ts";

export function canonicalSourceUrl(value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error("Invalid source destination");
  url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
export const maximumSourceRecords = (job: EpisodeV2Job) => Math.min(32, job.config.limits.maxSourceReads * 2);

/** Reconstruct the pre-submission allowance so a pending plan hashes identically on resume. */
export function beforeResearchAttempt(job: EpisodeV2Job, key: string): EpisodeV2Job {
  const copy = structuredClone(job), attempt = copy.state.execution?.steps[key];
  if (attempt && ["submitted", "pending", "uncertain"].includes(attempt.phase) && copy.state.usageLedger) {
    copy.state.usageLedger.records = copy.state.usageLedger.records.filter(record => record.id !== attempt.usageRecordId);
  }
  return copy;
}
export function researchAllowance(job: EpisodeV2Job) {
  const ledger = job.state.usageLedger;
  if (!ledger) throw new StageBlockedError("Configure a research allowance before discovery.", "budget");
  const used = (field: "searchCalls" | "sourceReads") => ledger.records.reduce((sum, record) => sum
    + (record.outcome === "rejected" ? 0 : record.reported[field] ?? record.maxima[field]), 0);
  return {
    remainingOperations: Math.max(0, ledger.maxOperations - ledger.records.length),
    remainingSearchCalls: Math.max(0, ledger.maxSearchCalls - used("searchCalls")),
    remainingSourceReads: Math.max(0, ledger.maxSourceReads - used("sourceReads")),
    remainingResearchUsd: Math.max(0, ledger.allocations.research - allowanceUsed(ledger, "research")),
    maxToolCallsThisOperation: (job.state.modelPolicy ?? createModelPolicy()).roles[job.substep === "read" ? "source" : "research"]!.maxToolCalls,
  };
}

/** Mirror the actual conservative reservation on a clone; this never reserves or submits work. */
export function canResearch(job: EpisodeV2Job, kind: "research" | "source"): boolean {
  const ledger = job.state.usageLedger;
  if (!ledger) return false;
  try {
    const policy = job.state.modelPolicy ?? createModelPolicy(), role = kind === "research" ? "research" : "source";
    reserveUsage(structuredClone(ledger), quoteOperation({ id: "research-allowance-probe", role, kind }, policy.roles[role]!, new Date(0).toISOString()));
    return true;
  } catch { return false; }
}
export function assertResearchAllowance(job: EpisodeV2Job, kind: "research" | "source"): void {
  if (!canResearch(job, kind)) throw new StageBlockedError("The configured research allowance is exhausted. Review the saved coverage before authorizing more research.", "budget");
}
export function researchMetadata(previous: SourceRecords | undefined, commission: ResearchCommission) {
  if (previous?.data.research && (previous.data.research.commission.id !== commission.id || previous.data.research.commission.version !== commission.version)) {
    throw new StageBlockedError("Research belongs to a different commission version; review it before continuing.");
  }
  return structuredClone(previous?.data.research ?? {
    commission: artifactRef(commission), discoveryRounds: 0,
    readSourceIds: previous?.data.sources.filter(source => !["discovered", "snippet"].includes(source.readingCoverage)).map(source => source.id) ?? [],
    pendingSourceIds: previous?.data.sources.filter(source => ["discovered", "snippet"].includes(source.readingCoverage)).map(source => source.id) ?? [],
    coverageRationale: "Discovery is needed for the saved research commission.", gaps: commission.data.questions, stopReason: "continue" as const,
  });
}
type Metadata = ReturnType<typeof researchMetadata>;
export function researchNext(job: EpisodeV2Job, research: Metadata): Step {
  if (research.pendingSourceIds.length && canResearch(job, "source")) { research.stopReason = "continue"; return { stage: "research", substep: "read" }; }
  if (research.pendingSourceIds.length) { research.stopReason = "allowance"; return { stage: "research", substep: "synthesize" }; }
  if (research.gaps.length && research.stopReason !== "no_candidates"
    && research.readSourceIds.length + research.pendingSourceIds.length < maximumSourceRecords(job)
    && canResearch(job, "research") && canResearch(job, "source")) {
    research.stopReason = "continue"; return { stage: "research", substep: "discover" };
  }
  if (research.stopReason !== "no_candidates") research.stopReason = research.gaps.length ? "allowance" : "coverage";
  return { stage: "research", substep: "synthesize" };
}
function relationships(input: DiscoveryOutput["candidates"][number]["relationships"], sources: SourceRecord[], selfId: string) {
  return input.flatMap(item => {
    const match = sources.find(source => canonicalSourceUrl(source.url) === canonicalSourceUrl(item.url));
    return match && match.id !== selfId ? [{ sourceId: match.id, relation: item.relation, note: item.note }] : [];
  });
}
function mergeNotices(previous: SourceRecord["notices"], added: SourceRecord["notices"]): SourceRecord["notices"] {
  return [...previous, ...added].filter((item, index, all) => all.findIndex(other => other.type === item.type && canonicalSourceUrl(other.url) === canonicalSourceUrl(item.url)) === index);
}
function preservePublicationStatus(previous: SourceRecord["publicationStatus"], added: SourceRecord["publicationStatus"]): SourceRecord["publicationStatus"] {
  const caution = { unknown: 0, published: 1, corrected: 2, expression_of_concern: 3, retracted: 4 };
  return caution[previous] >= caution[added] ? previous : added;
}
function reviseEvidenceFamily(sources: SourceRecord[], previous: string, revised: string): void {
  // A resolved study identity applies to its saved reports as well, so a metadata update
  // cannot accidentally turn the same observation into independent confirmation.
  if (previous !== revised) for (const source of sources) if (source.evidenceFamilyId === previous) source.evidenceFamilyId = revised;
}
function applyPublicationRelationships(sources: SourceRecord[], source: SourceRecord): void {
  for (const link of source.relationships ?? []) {
    const target = sources.find(candidate => candidate.id === link.sourceId);
    if (!target || !["corrects", "retracts", "supersedes"].includes(link.relation)) continue;
    target.notices = mergeNotices(target.notices, [{ type: link.relation, url: source.url, note: link.note }]);
    if (link.relation === "corrects") target.publicationStatus = preservePublicationStatus(target.publicationStatus, "corrected");
    if (link.relation === "retracts") target.publicationStatus = "retracted";
  }
}
export function saveDiscovery(result: ProviderResult<unknown>, job: EpisodeV2Job, commission: ResearchCommission, previous: SourceRecords | undefined, output: DiscoveryOutput) {
  const metadata = researchMetadata(previous, commission), sources = structuredClone(previous?.data.sources ?? []);
  const maximum = maximumSourceRecords(job), available = maximum - sources.length;
  if (output.candidates.length > maximum) throw new Error("Discovery exceeded the configured candidate allowance");
  const observed = new Set(result.sources.map(source => canonicalSourceUrl(source.url)));
  for (const action of result.actions) if (action.url && action.status === "completed") observed.add(canonicalSourceUrl(action.url));
  const envelope = artifactEnvelope(result, job, "source_records", (previous?.version ?? 0) + 1);
  let added = 0;
  for (const candidate of output.candidates) {
    const url = canonicalSourceUrl(candidate.url);
    if (!observed.has(url)) throw new Error("Discovery included a URL absent from the observed search sources");
    const existing = sources.find(source => canonicalSourceUrl(source.url) === url);
    if (existing) {
      existing.notices = mergeNotices(existing.notices, candidate.notices);
      existing.publicationStatus = preservePublicationStatus(existing.publicationStatus, candidate.publicationStatus);
      reviseEvidenceFamily(sources, existing.evidenceFamilyId, candidate.evidenceFamilyId);
      existing.qualifications = [...new Set([...(existing.qualifications ?? []), ...candidate.qualifications])];
      continue;
    }
    if (added >= available) continue;
    const id = `source-${sources.length + 1}`; added++;
    sources.push({
      id, title: candidate.title, url, ...(candidate.doi ? { doi: candidate.doi } : {}), authors: candidate.authors,
      ...(candidate.publishedOn ? { publishedOn: candidate.publishedOn } : {}), accessedAt: envelope.createdAt,
      sourceType: candidate.sourceType, evidenceFamilyId: candidate.evidenceFamilyId, publicationStatus: candidate.publicationStatus,
      notices: candidate.notices, qualifications: candidate.qualifications, relationships: [],
      readingCoverage: candidate.snippet ? "snippet" : "discovered", accessNote: candidate.accessNote,
      passages: candidate.snippet ? [{ id: `${id}-snippet`, ...candidate.snippet, coverage: "snippet" }] : [],
    });
    metadata.pendingSourceIds.push(id);
  }
  for (const candidate of output.candidates) {
    const source = sources.find(source => canonicalSourceUrl(source.url) === canonicalSourceUrl(candidate.url));
    if (!source) continue;
    source.relationships = [...(source.relationships ?? []), ...relationships(candidate.relationships, sources, source.id)]
      .filter((link, index, all) => all.findIndex(other => other.sourceId === link.sourceId && other.relation === link.relation) === index);
    applyPublicationRelationships(sources, source);
  }
  metadata.discoveryRounds++; metadata.coverageRationale = output.coverageRationale; metadata.gaps = output.gaps;
  if (!added && !metadata.pendingSourceIds.length) metadata.stopReason = "no_candidates";
  const next = researchNext(job, metadata);
  return { artifact: sourceRecordsSchema.parse({ ...envelope, data: { sources, research: metadata } }), next };
}
export function saveSourceReading(result: ProviderResult<unknown>, job: EpisodeV2Job, commission: ResearchCommission, previous: SourceRecords, selected: SourceRecord, output: SourceReadingOutput) {
  const url = canonicalSourceUrl(selected.url);
  if (canonicalSourceUrl(output.url) !== url) throw new Error("Reading changed the selected source identity");
  const exactActions = result.actions.filter(action => action.type === "open_page" && action.url && canonicalSourceUrl(action.url) === url);
  const opened = exactActions.some(action => action.status === "completed"), failed = exactActions.some(action => action.status === "failed");
  if (!opened && (!failed || output.readingCoverage !== "inaccessible" || output.passages.length)) throw new Error("Unopened source material cannot be saved as read");
  const envelope = artifactEnvelope(result, job, "source_records", previous.version + 1);
  const sources = structuredClone(previous.data.sources), index = sources.findIndex(source => source.id === selected.id);
  if (index < 0) throw new Error("The selected source is missing from its saved research snapshot");
  const passages = output.passages.map((passage, i) => ({ id: `${selected.id}-read-${previous.version + 1}-${i + 1}`, ...passage }));
  const source: SourceRecord = {
    ...selected, title: output.title, authors: output.authors, sourceType: output.sourceType, accessedAt: envelope.createdAt,
    ...(output.doi ? { doi: output.doi } : {}), ...(output.publishedOn ? { publishedOn: output.publishedOn } : {}),
    evidenceFamilyId: output.evidenceFamilyId, publicationStatus: preservePublicationStatus(selected.publicationStatus, output.publicationStatus),
    notices: mergeNotices(selected.notices, output.notices), qualifications: [...new Set([...(selected.qualifications ?? []), ...output.qualifications])],
    relationships: [...(selected.relationships ?? []), ...relationships(output.relationships, sources, selected.id)]
      .filter((link, i, all) => all.findIndex(other => other.sourceId === link.sourceId && other.relation === link.relation) === i),
    readingCoverage: output.readingCoverage, accessNote: output.accessNote,
    passages: output.readingCoverage === "inaccessible" ? selected.passages.filter(passage => passage.coverage === "snippet") : passages,
  };
  sources[index] = source;
  reviseEvidenceFamily(sources, selected.evidenceFamilyId, output.evidenceFamilyId);
  // Reading the original paper must not erase a correction or retraction already discovered.
  for (const saved of sources) applyPublicationRelationships(sources, saved);
  const metadata = researchMetadata(previous, commission);
  metadata.readSourceIds = [...new Set([...metadata.readSourceIds, selected.id])];
  metadata.pendingSourceIds = metadata.pendingSourceIds.filter(id => id !== selected.id);
  metadata.coverageRationale = output.coverageRationale; metadata.gaps = output.gaps;
  const next = researchNext(job, metadata);
  return { artifact: sourceRecordsSchema.parse({ ...envelope, data: { sources, research: metadata } }), next };
}
