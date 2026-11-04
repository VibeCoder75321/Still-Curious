import {
  createModelPolicy, createPriceSnapshot, modelPolicySchema, MODEL_CATALOG, PRICE_VERSION, ratesFor, ROLE_BUCKET, SEARCH_CALL_USD,
  type ModelPolicy, type Role, type RoleSettings,
} from "./model-policy.ts";
import {
  emptyReportedUsage, reserveUsage, settleUsage,
  type ReportedUsage, type SafeProviderError, type UsageLedger, type UsageRecord,
} from "./usage.ts";

export type ProviderRequest<T> = {
  id: string; role: Role; instructions: string; input: string;
  schemaName: string; jsonSchema: Record<string, unknown>; parse: (value: unknown) => T;
  background?: boolean;
} & ({ kind: "structured" | "research" } | { kind: "source"; sourceUrl: string; allowInaccessible?: boolean });
export type WebAction = {
  type: "search" | "open_page" | "find_in_page" | "unknown"; url: string | null;
  status: "completed" | "failed" | "in_progress" | "searching" | "incomplete" | "unknown";
  ignored?: true;
};
export type ProviderResult<T> = { value: T; usageRecordId: string; actions: WebAction[]; sources: { url: string; title: string | null }[] };
export type PersistUsage = (ledger: UsageLedger, result?: ProviderResult<unknown>) => Promise<void>;

export class ProviderOperationError extends Error {
  recordId: string;
  detail: SafeProviderError;
  constructor(recordId: string, detail: SafeProviderError) {
    super(detail.message); this.name = "ProviderOperationError"; this.recordId = recordId; this.detail = detail;
  }
}

/** A local guard rejected the request before any provider work or reservation. */
export class InputAllowanceError extends Error {
  constructor() {
    super("The saved conversation exceeds this step's configured input allowance. No new model request was sent; the saved work is intact.");
    this.name = "InputAllowanceError";
  }
}

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const measured = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const identifier = (value: unknown, prefix: string): string | null => typeof value === "string" && new RegExp(`^${prefix}_[A-Za-z0-9_-]{1,120}$`).test(value) ? value : null;
function sourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
function sourceIdentity(value: string) {
  const url = new URL(value); url.hash = "";
  for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key);
  return url.href;
}
function actualModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Object.keys(MODEL_CATALOG).some(base => value === base || (value.startsWith(base + "-") && /^\d{4}-\d{2}-\d{2}$/.test(value.slice(base.length + 1)))) ? value : null;
}

export function quoteOperation(request: Pick<ProviderRequest<unknown>, "id" | "role" | "kind">, settings: RoleSettings, startedAt: string): UsageRecord {
  const toolCalls = request.kind === "structured" ? 0 : settings.maxToolCalls;
  // Hosted retrieval expands context internally. Reserve full model context per possible tool round,
  // including the final model pass, rather than guessing the size of retrieved content.
  const inputTokens = toolCalls ? MODEL_CATALOG[settings.model].contextTokens * (toolCalls + 1) : settings.maxInputTokens;
  const rates = ratesFor(settings.model, inputTokens);
  const reservedUsd = inputTokens * Math.max(rates.input, rates.cacheWrite) / 1e6
    + settings.maxOutputTokens * rates.output / 1e6 + toolCalls * SEARCH_CALL_USD;
  return {
    id: request.id, role: request.role, bucket: ROLE_BUCKET[request.role], provider: "openai",
    requestedModel: settings.model, actualModel: null, responseId: null, requestId: null, settings,
    maxima: { inputTokens, outputTokens: settings.maxOutputTokens, toolCalls, searchCalls: toolCalls, sourceReads: toolCalls },
    priceVersion: PRICE_VERSION, pricing: createPriceSnapshot(settings.model), reservedUsd, allowanceUsd: reservedUsd, estimatedUsd: null, billedUsd: null,
    unknownCosts: ["Operation not yet completed"], startedAt, finishedAt: null, latencyMs: null,
    outcome: "reserved", reported: emptyReportedUsage(), error: null, boundExceeded: false,
  };
}

function failure(code: string, category: SafeProviderError["category"], message: string, ambiguous = false, status?: number): SafeProviderError {
  return { code, category, message, ambiguous, ...(status !== undefined ? { status } : {}) };
}
function httpFailure(status: number, data: unknown): SafeProviderError {
  const error = object(object(data).error);
  const allowed = new Set(["credit_balance_exhausted", "insufficient_quota", "project_spend_limit_exceeded", "organization_spend_limit_exceeded", "organization_usage_limit_exceeded", "usage_limit_exceeded", "rate_limit_exceeded", "slow_down", "invalid_api_key", "model_not_found"]);
  const code = typeof error.code === "string" && allowed.has(error.code) ? error.code
    : error.type === "insufficient_quota" ? "insufficient_quota" : "http_error";
  if (status >= 500 || status === 408) return failure(code, "provider", "OpenAI could not complete this operation. It was not retried.", true, status);
  if (["credit_balance_exhausted", "insufficient_quota", "project_spend_limit_exceeded", "organization_spend_limit_exceeded", "organization_usage_limit_exceeded", "usage_limit_exceeded"].includes(code)) {
    return failure(code, "billing", "OpenAI credits or spending limits need attention. This operation was not retried.", false, status);
  }
  if (status === 429) return failure(code, "rate_limit", "OpenAI is temporarily limiting requests. This operation was not retried.", false, status);
  if (status === 401) return failure(code, "authentication", "OpenAI authentication needs attention.", false, status);
  if ([400, 403, 404, 422].includes(status)) return failure(code, "configuration", "OpenAI rejected the configured request or model.", false, status);
  return failure(code, "provider", "OpenAI could not complete this operation. It was not retried.", status >= 500 || status === 408, status);
}

function responseUsage(data: Record<string, unknown>, actions: WebAction[], maxTools: number): ReportedUsage {
  actions = actions.filter(action => !action.ignored);
  const u = object(data.usage), inputDetails = object(u.input_tokens_details), outputDetails = object(u.output_tokens_details);
  const knownActions = actions.every(a => a.type !== "unknown");
  const toolUsageKnown = maxTools === 0 || Array.isArray(data.output);
  return {
    inputTokens: measured(u.input_tokens), outputTokens: measured(u.output_tokens), totalTokens: measured(u.total_tokens),
    cachedInputTokens: measured(inputDetails.cached_tokens), cacheWriteInputTokens: measured(inputDetails.cache_write_tokens),
    reasoningTokens: measured(outputDetails.reasoning_tokens),
    webSearchCalls: toolUsageKnown ? actions.length : null,
    searchCalls: toolUsageKnown && knownActions ? actions.filter(a => a.type === "search").length : null,
    sourceReads: toolUsageKnown && knownActions ? actions.filter(a => a.type === "open_page").length : null,
  };
}

export function createProviderAdapter(options: { apiKey: string; policy?: ModelPolicy; fetch?: typeof fetch; now?: () => number }) {
  const policy = modelPolicySchema.parse(options.policy ?? createModelPolicy());
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  async function perform<T>(request: ProviderRequest<T>, ledger: UsageLedger, persist: PersistUsage, retrieving: boolean): Promise<ProviderResult<T>> {
    if (!options.apiKey.trim()) throw new Error("OpenAI is not configured");
    if (!request.id.trim() || !/^[A-Za-z0-9_-]{1,64}$/.test(request.schemaName)) throw new Error("Operation identity or schema name is invalid");
    const saved = retrieving ? ledger.records.find(r => r.id === request.id) : undefined;
    if (retrieving && (!saved || saved.abandonment || !identifier(saved.responseId, "resp") || saved.role !== request.role || saved.outcome === "rejected")) {
      throw new Error("A saved response identity is required for reconciliation");
    }
    const settings = structuredClone(saved?.settings ?? policy.roles[request.role]);
    if (!settings) throw new Error("Unknown provider role");
    if (request.kind !== "structured" && (settings.maxToolCalls < 1 || (request.kind === "research" ? request.role !== "research" : request.role !== "source"))) {
      throw new Error("Web tools are available only for the matching research or source operation");
    }
    if (request.kind === "source" && !sourceUrl(request.sourceUrl)) throw new Error("Source URL is invalid");
    const body: Record<string, unknown> = {
      model: settings.model, reasoning: { effort: settings.reasoningEffort, mode: "standard" }, service_tier: "default",
      instructions: request.instructions,
      input: request.kind === "source" ? `${request.input}\n\nOpen and read this source URL: ${request.sourceUrl}` : request.input,
      max_output_tokens: settings.maxOutputTokens, store: true, truncation: "disabled",
      text: { format: { type: "json_schema", name: request.schemaName, strict: true, schema: request.jsonSchema } },
      ...(request.background ? { background: true } : {}),
    };
    if (request.kind !== "structured") Object.assign(body, {
      tools: [{ type: "web_search", search_context_size: "medium", return_token_budget: "default" }],
      tool_choice: "required", max_tool_calls: settings.maxToolCalls, include: ["web_search_call.action.sources"],
    });
    const serialized = JSON.stringify(body);
    // UTF-8 bytes plus a framing margin conservatively bound this text/JSON request.
    // This is not a tokenizer measurement. Reported usage is checked against the reservation.
    if (new TextEncoder().encode(serialized).length + 1024 > settings.maxInputTokens) throw new InputAllowanceError();
    const start = now();
    const record = saved ?? reserveUsage(ledger, quoteOperation(request, settings, new Date(start).toISOString()));
    if (!retrieving) {
      try { await persist(ledger); }
      catch { throw new ProviderOperationError(record.id, failure("persistence_failed", "persistence", "Usage reservation could not be saved; no provider request was sent.")); }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), retrieving || request.background ? Math.min(settings.timeoutMs, 15_000) : settings.timeoutMs);
    let data: Record<string, unknown> = {}, reported = retrieving ? structuredClone(record.reported) : emptyReportedUsage();
    let requestId: string | null = record.requestId, responseId: string | null = record.responseId, model: string | null = record.actualModel;
    let outcome: UsageRecord["outcome"] = "uncertain", error: SafeProviderError | null = null;
    let parsed: T | undefined;
    const actions: WebAction[] = [], sources: ProviderResult<T>["sources"] = [];
    try {
      const response = await fetchImpl(retrieving
        ? `https://api.openai.com/v1/responses/${encodeURIComponent(record.responseId!)}?include[]=web_search_call.action.sources`
        : "https://api.openai.com/v1/responses", {
        method: retrieving ? "GET" : "POST", headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
        ...(retrieving ? {} : { body: serialized }), signal: controller.signal,
      });
      requestId = identifier(response.headers.get("x-request-id"), "req") ?? requestId;
      if (!response.ok) {
        let detail: unknown = null; try { detail = await response.json(); } catch { /* Never retain raw provider bodies. */ }
        error = retrieving
          ? failure("reconciliation_unavailable", "provider", "The saved provider response could not be retrieved. Its original reservation remains held; it was not resubmitted.", true, response.status)
          : httpFailure(response.status, detail);
        outcome = error.ambiguous ? "uncertain" : "rejected";
      } else {
        data = object(await response.json());
        const receivedId = identifier(data.id, "resp");
        if (retrieving && receivedId !== record.responseId) throw new Error("Response identity changed");
        responseId = receivedId; model = actualModel(data.model);
        const webItems = array(data.output).map(object).filter(item => item.type === "web_search_call");
        const processed = webItems.filter(item => ["completed", "failed"].includes(String(item.status))).length;
        // The API ignores tool attempts beyond max_tool_calls. Only classify an empty,
        // nonterminal placeholder this way after the echoed limit is fully processed.
        // Complete actions, unknown limits and payload-bearing actions remain counted.
        record.ignoredWebAttempts = 0;
        for (const raw of array(data.output)) {
          const item = object(raw);
          if (item.type !== "web_search_call") continue;
          const action = object(item.action);
          const type = ["search", "open_page", "find_in_page"].includes(String(action.type)) ? action.type as WebAction["type"] : "unknown";
          const status = ["completed", "failed", "in_progress", "searching", "incomplete"].includes(String(item.status)) ? item.status as WebAction["status"] : "unknown";
          const ignored = data.status === "completed" && record.maxima.toolCalls > 0
            && data.max_tool_calls === record.maxima.toolCalls && processed === record.maxima.toolCalls
            && ["in_progress", "searching", "incomplete"].includes(status)
            && ["open_page", "find_in_page", "search"].includes(type)
            && Object.keys(action).every(key => key === "type");
          if (ignored) record.ignoredWebAttempts++;
          actions.push({ type, url: sourceUrl(action.url), status, ...(ignored ? { ignored: true as const } : {}) });
          for (const rawSource of array(action.sources)) {
            const s = object(rawSource), url = sourceUrl(s.url);
            if (url && !sources.some(existing => existing.url === url)) sources.push({ url, title: typeof s.title === "string" ? s.title : null });
          }
        }
        reported = responseUsage(data, actions, record.maxima.toolCalls);
        if (!responseId || !model || (data.service_tier !== undefined && data.service_tier !== "default")) {
          outcome = "uncertain"; error = failure("unverified_response", "provider", "The provider response identity, model or processing tier could not be verified.", true);
        } else if (["queued", "in_progress"].includes(String(data.status))) {
          outcome = "pending"; error = failure("pending", "provider", "The provider response is still pending. Reconcile its saved ID before continuing.", true);
        } else if (data.status !== "completed") {
          outcome = "incomplete"; error = failure("incomplete", "output", "OpenAI did not complete this step. Usage was recorded; the operation was not retried.");
        } else if (array(data.output).some(raw => array(object(raw).content).some(c => object(c).type === "refusal"))) {
          outcome = "invalid_output"; error = failure("refusal", "output", "OpenAI declined this step. Usage was recorded.");
        } else if (request.kind === "research" && !actions.some(a => a.type === "search" && a.status === "completed")) {
          outcome = "invalid_output"; error = failure("search_not_observed", "output", "A completed search was not observed; do not treat this as researched evidence.");
        } else if (request.kind === "source" && !actions.some(a => a.type === "open_page"
          && (a.status === "completed" || (request.allowInaccessible === true && a.status === "failed"))
          && a.url && sourceIdentity(a.url) === sourceIdentity(request.sourceUrl))) {
          outcome = "invalid_output"; error = failure("source_not_opened", "output", "The requested source was not opened; do not label it as read.");
        } else {
          try {
            const outputText = typeof data.output_text === "string" ? data.output_text
              : array(data.output).flatMap(raw => array(object(raw).content)).filter(c => object(c).type === "output_text").map(c => object(c).text).filter(t => typeof t === "string").join("\n");
            parsed = request.parse(JSON.parse(outputText)); outcome = "completed";
          } catch { outcome = "invalid_output"; error = failure("invalid_output", "output", "The structured result was invalid. Usage was recorded; no automatic repair was attempted."); }
        }
      }
    } catch {
      error = failure("transport_or_unreadable_response", "transport", "The provider request failed, timed out or returned unreadable data. It was not retried.", true);
      outcome = "uncertain";
    } finally { clearTimeout(timer); }

    const end = now();
    settleUsage(record, { outcome, reported, error, actualModel: model, responseId, requestId, finishedAt: new Date(end).toISOString(), latencyMs: Math.max(0, end - Date.parse(record.startedAt)) });
    if (record.boundExceeded) {
      error = failure("reservation_exceeded", "configuration", "Reported provider work exceeded its configured reservation. Review the allowance before continuing.");
      record.error = error;
    }
    const result = { value: parsed as T, usageRecordId: record.id, actions, sources };
    try { await persist(ledger, error ? undefined : result); }
    catch { throw new ProviderOperationError(record.id, failure("persistence_failed", "persistence", "The provider result could not be saved. Reconcile the attempt before continuing.", true)); }
    if (error) throw new ProviderOperationError(record.id, error);
    return result;
  }
  return {
    execute: <T>(request: ProviderRequest<T>, ledger: UsageLedger, persist: PersistUsage) => perform(request, ledger, persist, false),
    retrieve: <T>(request: ProviderRequest<T>, ledger: UsageLedger, persist: PersistUsage) => perform(request, ledger, persist, true),
  };
}
