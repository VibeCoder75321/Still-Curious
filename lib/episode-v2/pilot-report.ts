import type { EpisodeV2Job } from "./contracts.ts";
import type { ReportedUsage } from "./usage.ts";
import { episodeV2JobSchema } from "./contracts.ts";

/** Explicit operator reconciliation retrieves the existing result; it never clears its bound or identity. */
export function prepareKnownResponseReconciliation(job: EpisodeV2Job, key: string) {
  const next = structuredClone(job), attempt = next.state.execution?.steps[key];
  const record = next.state.usageLedger?.records.find(value => value.id === attempt?.usageRecordId);
  if (job.status !== "paused" || job.pause?.code !== "needs_input" || attempt?.phase !== "failed"
    || attempt.step.stage !== job.stage || attempt.step.substep !== job.substep
    || !record?.responseId || record.error?.code !== "reservation_exceeded") {
    throw new Error("Only the current held response with a known ID and a reviewed reservation-count issue can be reconciled.");
  }
  attempt.phase = "uncertain";
  record.outcome = "uncertain";
  next.pause = { code: "ambiguous_provider_result", reason: "Explicit operator reconciliation of the saved response; no replacement submission is authorized." };
  return episodeV2JobSchema.parse(next);
}

/** Partial reports retain their missing observations; estimates are never invoices. */
export function pilotUsageReport(job: EpisodeV2Job) {
  const records = job.state.usageLedger?.records ?? [];
  const fields: (keyof ReportedUsage)[] = ["inputTokens", "outputTokens", "totalTokens", "reasoningTokens", "cachedInputTokens", "cacheWriteInputTokens", "webSearchCalls", "searchCalls", "sourceReads"];
  const observed = Object.fromEntries(fields.map(field => [field, {
    reportedSubtotal: records.reduce((sum, record) => sum + (record.reported[field] ?? 0), 0),
    missingOperations: records.filter(record => record.reported[field] === null).map(record => record.id),
  }]));
  const stages = Object.entries(job.state.execution?.steps ?? {}).map(([key, step]) => {
    const record = records.find(value => value.id === step.usageRecordId);
    return { key, stage: step.step.stage, phase: step.phase, role: record?.role ?? null,
      wallTimeMs: step.updatedAt - step.createdAt, observedOperationLatencyMs: record?.latencyMs ?? null,
      usageRecordId: step.usageRecordId, model: record?.actualModel ?? null, outcome: record?.outcome ?? null };
  });
  return {
    episodeId: job.id, topic: job.topic, status: job.status, stage: `${job.stage}.${job.substep}`,
    textAccepted: job.pause?.code === "text_checkpoint" && !!job.state.finalScript,
    pause: job.pause ?? null, spendingCeilingUsd: job.config.limits.spendCeilingUsd,
    allocations: job.state.usageLedger?.allocations ?? null,
    operations: records.length, stages, observed,
    ignoredWebAttempts: records.reduce((sum, record) => sum + (record.ignoredWebAttempts ?? 0), 0),
    abandonedOperations: records.filter(record => record.abandonment).map(record => ({ operationId: record.id, ...record.abandonment!, retainedAllowanceUsd: record.allowanceUsd })),
    cost: {
      estimatedReportedSubtotalUsd: records.reduce((sum, record) => sum + (record.estimatedUsd ?? 0), 0),
      missingEstimates: records.filter(record => record.estimatedUsd === null).map(record => record.id),
      heldAllowanceUsd: records.reduce((sum, record) => sum + record.allowanceUsd, 0),
      billedUsd: null,
      gaps: records.flatMap(record => record.unknownCosts.map(reason => ({ operationId: record.id, reason }))),
      priceVersions: [...new Set(records.map(record => record.priceVersion))],
    },
    recovery: records.filter(record => ["pending", "uncertain", "reserved"].includes(record.outcome) || record.boundExceeded)
      .map(record => ({ operationId: record.id, outcome: record.outcome, hasResponseId: !!record.responseId, boundExceeded: record.boundExceeded,
        ...(record.abandonment ? { abandoned: true } : {}) })),
    interpretation: "Reported counts are observed provider usage. Missing counts and costs remain unknown; calculated charges are estimates, not a bill. Stage wall times and observed operation latency include polling and may include operator pauses; provider-only processing latency was not independently measured.",
  };
}
