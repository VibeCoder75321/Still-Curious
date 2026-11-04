import { z } from "zod";
import { bucketSchema, modelIdSchema, roleSchema, roleSettingsSchema, priceSnapshotSchema, createPriceSnapshot, ROLE_BUCKET, type BudgetBucket, type ModelId, type PriceSnapshot } from "./model-policy.ts";

const money = z.number().finite().nonnegative();
const count = z.number().int().nonnegative();
const nullableCount = count.nullable();
export const reportedUsageSchema = z.object({
  inputTokens: nullableCount, outputTokens: nullableCount, totalTokens: nullableCount,
  reasoningTokens: nullableCount, cachedInputTokens: nullableCount, cacheWriteInputTokens: nullableCount,
  webSearchCalls: nullableCount, searchCalls: nullableCount, sourceReads: nullableCount,
}).strict();
export type ReportedUsage = z.infer<typeof reportedUsageSchema>;
export const emptyReportedUsage = (): ReportedUsage => ({
  inputTokens: null, outputTokens: null, totalTokens: null, reasoningTokens: null,
  cachedInputTokens: null, cacheWriteInputTokens: null, webSearchCalls: null, searchCalls: null, sourceReads: null,
});
export const safeProviderErrorSchema = z.object({
  code: z.string(), category: z.enum(["billing", "rate_limit", "authentication", "configuration", "provider", "transport", "output", "persistence"]),
  message: z.string(), ambiguous: z.boolean(), status: count.optional(),
}).strict();
export type SafeProviderError = z.infer<typeof safeProviderErrorSchema>;

export const usageRecordSchema = z.object({
  id: z.string().min(1), role: roleSchema, bucket: bucketSchema, provider: z.literal("openai"),
  requestedModel: modelIdSchema, actualModel: z.string().nullable(), responseId: z.string().nullable(), requestId: z.string().nullable(),
  settings: roleSettingsSchema,
  maxima: z.object({ inputTokens: count, outputTokens: count, toolCalls: count, searchCalls: count, sourceReads: count }).strict(),
  priceVersion: z.string().min(1), pricing: priceSnapshotSchema, reservedUsd: money, allowanceUsd: money,
  estimatedUsd: money.nullable(), billedUsd: z.null(), unknownCosts: z.array(z.string()),
  startedAt: z.string().datetime(), finishedAt: z.string().datetime().nullable(), latencyMs: count.nullable(),
  outcome: z.enum(["reserved", "completed", "rejected", "incomplete", "invalid_output", "uncertain", "pending"]),
  ignoredWebAttempts: count.optional(),
  abandonment: z.object({ at: z.string().datetime(), sourceId: z.string().min(1),
    reason: z.string().trim().min(1).max(2000), authorization: z.string().trim().min(1).max(2000) }).strict().optional(),
  reported: reportedUsageSchema, error: safeProviderErrorSchema.nullable(), boundExceeded: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.bucket !== ROLE_BUCKET[value.role]) ctx.addIssue({ code: "custom", path: ["bucket"], message: "Role is assigned to a different allowance bucket" });
  if (value.settings.model !== value.requestedModel) ctx.addIssue({ code: "custom", path: ["requestedModel"], message: "Requested model must match the saved settings" });
  if (value.priceVersion !== value.pricing.version) ctx.addIssue({ code: "custom", path: ["priceVersion"], message: "Price version must match its saved snapshot" });
  if (value.abandonment && (value.role !== "source" || value.outcome !== "uncertain" || value.responseId !== null
    || value.boundExceeded || value.allowanceUsd !== value.reservedUsd || value.estimatedUsd !== null)) {
    ctx.addIssue({ code: "custom", path: ["abandonment"], message: "Only an explicitly abandoned unknown source result may retain its full reservation and permit other work" });
  }
});
export type UsageRecord = z.infer<typeof usageRecordSchema>;
const allocationsSchema = z.object({ research: money, text: money, review: money, audio: money }).strict();
export const usageLedgerSchema = z.object({
  version: z.literal(1), spendCeilingUsd: money.nullable(), allocations: allocationsSchema,
  maxOperations: count, maxSearchCalls: count, maxSourceReads: count, records: z.array(usageRecordSchema),
}).strict().superRefine((value, ctx) => {
  if (Object.values(value.allocations).reduce((a, b) => a + b, 0) > (value.spendCeilingUsd ?? 0) + 1e-9) {
    ctx.addIssue({ code: "custom", path: ["allocations"], message: "Bucket allowances exceed authorized spending" });
  }
  if (new Set(value.records.map(r => r.id)).size !== value.records.length) {
    ctx.addIssue({ code: "custom", path: ["records"], message: "Attempt IDs must be unique" });
  }
});
export type UsageLedger = z.infer<typeof usageLedgerSchema>;

export function createUsageLedger(input: Omit<UsageLedger, "version" | "records">): UsageLedger {
  return usageLedgerSchema.parse({ version: 1, ...input, records: [] });
}

export function allowanceUsed(ledger: UsageLedger, bucket?: BudgetBucket): number {
  return ledger.records.filter(r => !bucket || r.bucket === bucket).reduce((sum, r) => sum + r.allowanceUsd, 0);
}

function usedCounter(ledger: UsageLedger, field: "searchCalls" | "sourceReads"): number {
  return ledger.records.reduce((sum, r) => sum + (r.outcome === "rejected" ? 0 : r.reported[field] ?? r.maxima[field]), 0);
}

export function reserveUsage(ledger: UsageLedger, record: UsageRecord): UsageRecord {
  usageLedgerSchema.parse(ledger); usageRecordSchema.parse(record);
  if (record.outcome !== "reserved" || record.allowanceUsd !== record.reservedUsd) throw new Error("New operations require a full reservation");
  if (ledger.spendCeilingUsd === null || ledger.spendCeilingUsd <= 0) throw new Error("No live spending allowance is configured");
  if (ledger.records.some(r => r.id === record.id)) throw new Error("Attempt ID has already been reserved; do not repeat it");
  if (ledger.records.some(r => (["reserved", "uncertain", "pending"].includes(r.outcome) && !r.abandonment) || r.boundExceeded)) {
    throw new Error("Reconcile the unfinished or uncertain provider operation before continuing");
  }
  if (ledger.records.length >= ledger.maxOperations) throw new Error("Provider operation allowance exhausted");
  if (usedCounter(ledger, "searchCalls") + record.maxima.searchCalls > ledger.maxSearchCalls
    || usedCounter(ledger, "sourceReads") + record.maxima.sourceReads > ledger.maxSourceReads) throw new Error("Research tool allowance exhausted");
  if (allowanceUsed(ledger) + record.reservedUsd > ledger.spendCeilingUsd + 1e-9
    || allowanceUsed(ledger, record.bucket) + record.reservedUsd > ledger.allocations[record.bucket] + 1e-9) {
    throw new Error("Insufficient allowance for this operation's configured maximum");
  }
  ledger.records.push(record);
  return record;
}

export function usageCost(model: ModelId, usage: ReportedUsage, pricing: PriceSnapshot = createPriceSnapshot(model)) {
  const unknownCosts: string[] = [];
  const { inputTokens: input, outputTokens: output, cachedInputTokens: cached, cacheWriteInputTokens: writes, webSearchCalls: web, searchCalls: searches } = usage;
  if (input === null || output === null || web === null) return { estimatedUsd: null, allowanceUsd: null, unknownCosts: ["Missing token or tool usage"] };
  const rates = input > pricing.longContextThreshold ? pricing.longContext : pricing.shortContext;
  if (cached === null) unknownCosts.push("Cached input usage not reported");
  if (writes === null) unknownCosts.push("Cache write usage not reported");
  if (searches === null) unknownCosts.push("Search actions not reported");
  const validDetails = cached !== null && writes !== null && cached + writes <= input;
  if (cached !== null && writes !== null && !validDetails) unknownCosts.push("Inconsistent input token details");
  const estimatedUsd = validDetails && searches !== null
    ? ((input - cached - writes) * rates.input + cached * rates.cached + writes * rates.cacheWrite + output * rates.output) / 1e6 + searches * pricing.searchCallUsd
    : null;
  // Conservative allowance includes potentially unreported writes and every web action.
  const allowanceUsd = input * Math.max(rates.input, rates.cacheWrite) / 1e6 + output * rates.output / 1e6 + web * pricing.searchCallUsd;
  return { estimatedUsd, allowanceUsd, unknownCosts };
}

export function settleUsage(record: UsageRecord, update: Pick<UsageRecord, "outcome" | "reported" | "error" | "actualModel" | "responseId" | "requestId" | "finishedAt" | "latencyMs">): void {
  Object.assign(record, update);
  if (update.outcome === "rejected") {
    record.allowanceUsd = 0; record.estimatedUsd = 0; record.unknownCosts = [];
    // A known rejection implies no execution; it does not fabricate a provider usage report.
    return;
  }
  const actual = update.actualModel;
  const family = actual && (actual === record.requestedModel
    || (actual.startsWith(record.requestedModel + "-") && /^\d{4}-\d{2}-\d{2}$/.test(actual.slice(record.requestedModel.length + 1)))) ? record.requestedModel : null;
  const cost = family ? usageCost(family, update.reported, record.pricing) : { estimatedUsd: null, allowanceUsd: null, unknownCosts: ["Actual model is unverified"] };
  record.estimatedUsd = cost.estimatedUsd;
  record.unknownCosts = cost.unknownCosts;
  record.allowanceUsd = ["uncertain", "pending"].includes(update.outcome) ? record.reservedUsd : cost.allowanceUsd ?? record.reservedUsd;
  const u = record.reported, m = record.maxima;
  record.boundExceeded = (actual !== null && family === null)
    || (u.inputTokens !== null && u.inputTokens > m.inputTokens)
    || (u.outputTokens !== null && u.outputTokens > m.outputTokens)
    || (u.webSearchCalls !== null && u.webSearchCalls > m.toolCalls)
    || (u.searchCalls !== null && u.searchCalls > m.searchCalls)
    || (u.sourceReads !== null && u.sourceReads > m.sourceReads)
    || (u.reasoningTokens !== null && u.outputTokens !== null && u.reasoningTokens > u.outputTokens)
    || (u.cachedInputTokens !== null && u.cacheWriteInputTokens !== null && u.inputTokens !== null && u.cachedInputTokens + u.cacheWriteInputTokens > u.inputTokens)
    || record.allowanceUsd > record.reservedUsd + 1e-9;
}
