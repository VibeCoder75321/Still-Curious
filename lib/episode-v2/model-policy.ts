import { z } from "zod";

export const PROVIDER_DOCS_VERIFIED_AT = "2026-10-15";
export const PROVIDER_DOCS = {
  sol: "https://developers.openai.com/api/docs/models/gpt-6.1-sol",
  luna: "https://developers.openai.com/api/docs/models/gpt-6-luna",
  responses: "https://developers.openai.com/api/reference/typescript/resources/responses/methods/create",
  search: "https://developers.openai.com/api/docs/guides/tools-web-search",
  pricing: "https://developers.openai.com/api/docs/pricing",
} as const;

export const modelIdSchema = z.enum(["gpt-6.1-sol", "gpt-6-luna"]);
export type ModelId = z.infer<typeof modelIdSchema>;
export const effortSchema = z.enum(["none", "low", "medium", "high", "xhigh", "max"]);
export const roleSchema = z.enum([
  "producer", "research", "source", "synthesis", "casting", "guest_preparation", "host_preparation",
  "host", "guest", "contribution_request", "editing", "review", "local_repair",
]);
export type Role = z.infer<typeof roleSchema>;
export const bucketSchema = z.enum(["research", "text", "review", "audio"]);
export type BudgetBucket = z.infer<typeof bucketSchema>;
export const ROLE_BUCKET: Record<Role, BudgetBucket> = {
  producer: "text", research: "research", source: "research", synthesis: "research", casting: "text",
  guest_preparation: "text", host_preparation: "text", host: "text", guest: "text", contribution_request: "text",
  editing: "text", review: "review", local_repair: "review",
};

// Dated Standard/global assumptions. Cache writes are a subset of input, not extra output.
export const MODEL_CATALOG = {
  "gpt-6.1-sol": { contextTokens: 1_050_000, maxOutputTokens: 128_000, input: 2, cached: .10, cacheWrite: 2.50, output: 10 },
  "gpt-6-luna": { contextTokens: 1_050_000, maxOutputTokens: 128_000, input: .10, cached: .01, cacheWrite: .125, output: .50 },
} as const;
export const PRICE_VERSION = "openai-standard-global-2026-10-15";
export const SEARCH_CALL_USD = .01;
export const LONG_CONTEXT_THRESHOLD = 272_000;

export function ratesFor(model: ModelId, inputTokens: number) {
  const c = MODEL_CATALOG[model];
  const long = inputTokens > LONG_CONTEXT_THRESHOLD;
  return { input: c.input * (long ? 2 : 1), cached: c.cached * (long ? 2 : 1), cacheWrite: c.cacheWrite * (long ? 2 : 1), output: c.output * (long ? 1.5 : 1) };
}

const price = z.number().finite().nonnegative();
const tokenRatesSchema = z.object({ input: price, cached: price, cacheWrite: price, output: price }).strict();
export const priceSnapshotSchema = z.object({
  version: z.string().min(1), verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), sourceUrl: z.string().url(),
  shortContext: tokenRatesSchema, longContext: tokenRatesSchema,
  longContextThreshold: z.number().int().positive(), searchCallUsd: price,
}).strict();
export type PriceSnapshot = z.infer<typeof priceSnapshotSchema>;
export function createPriceSnapshot(model: ModelId): PriceSnapshot {
  return {
    version: PRICE_VERSION, verifiedAt: PROVIDER_DOCS_VERIFIED_AT, sourceUrl: PROVIDER_DOCS.pricing,
    shortContext: ratesFor(model, 0), longContext: ratesFor(model, LONG_CONTEXT_THRESHOLD + 1),
    longContextThreshold: LONG_CONTEXT_THRESHOLD, searchCallUsd: SEARCH_CALL_USD,
  };
}

export const roleSettingsSchema = z.object({
  model: modelIdSchema,
  reasoningEffort: effortSchema,
  maxInputTokens: z.number().int().positive().max(128_000),
  maxOutputTokens: z.number().int().min(16).max(128_000),
  maxToolCalls: z.number().int().min(0).max(4),
  timeoutMs: z.number().int().positive().max(90_000),
}).strict().superRefine((value, ctx) => {
  if (value.model === "gpt-6.1-sol" && value.reasoningEffort === "none") {
    ctx.addIssue({ code: "custom", path: ["reasoningEffort"], message: "Sol does not support none reasoning" });
  }
});
export type RoleSettings = z.infer<typeof roleSettingsSchema>;
export const modelPolicySchema = z.object({
  version: z.literal(1), verifiedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  roles: z.record(roleSchema, roleSettingsSchema),
}).strict().superRefine((value, ctx) => {
  for (const role of roleSchema.options) {
    const setting = value.roles[role];
    if (!setting) ctx.addIssue({ code: "custom", path: ["roles", role], message: "Missing role policy" });
    else if (setting.maxToolCalls > 0 && role !== "research" && role !== "source") {
      ctx.addIssue({ code: "custom", path: ["roles", role], message: "Only research and source access may use web tools" });
    }
  }
});
export type ModelPolicy = z.infer<typeof modelPolicySchema>;

export function createModelPolicy(overrides: Partial<Record<Role, Partial<RoleSettings>>> = {}): ModelPolicy {
  for (const key of Object.keys(overrides)) roleSchema.parse(key);
  const roles: Partial<Record<Role, RoleSettings>> = {};
  for (const role of roleSchema.options) {
    const inexpensive = ["research", "source", "contribution_request"].includes(role);
    const deep = ["producer", "synthesis", "review"].includes(role);
    // Guest preparation and speech use Extra High without expanding their output allowance.
    const extraHigh = deep || role === "guest_preparation" || role === "guest";
    roles[role] = {
      model: inexpensive ? "gpt-6-luna" : "gpt-6.1-sol",
      reasoningEffort: extraHigh ? "xhigh" : role === "contribution_request" ? "low" : role === "host" ? "medium" : "high",
      // Full episode context grows as turns are accepted. Keep the conservative
      // byte-based bound large enough for a 15-minute conversation and review.
      maxInputTokens: 128_000,
      maxOutputTokens: deep ? 16_384 : role === "contribution_request" ? 2048 : role === "host" ? 4096 : 8192,
      maxToolCalls: role === "research" || role === "source" ? 1 : 0,
      timeoutMs: 90_000,
      ...overrides[role],
    };
  }
  return modelPolicySchema.parse({ version: 1, verifiedAt: PROVIDER_DOCS_VERIFIED_AT, roles });
}
