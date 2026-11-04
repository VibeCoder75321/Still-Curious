import { z } from "zod";

const text = z.string().min(1), hash = z.string().regex(/^[a-f0-9]{64}$/);
const money = z.number().finite().nonnegative(), count = z.number().int().nonnegative();
const speaker = z.enum(["host", "expert1", "expert2", "expert3"]);
export const audioVoicesSchema = z.object({ host: text, expert1: text, expert2: text, expert3: text }).strict()
  .refine(value => new Set(Object.values(value)).size === 4, "Four distinct configured voices are required");
export const audioPriceSchema = z.object({
  version: z.literal(1), model: z.enum(["eleven_v3", "eleven_v4"]), voices: audioVoicesSchema,
  // Operator-verified upper bound, including any voice premium. Never supplied by a browser.
  usdPer1kCharacters: z.number().finite().positive().max(100), checkedAt: count,
}).strict();
const reference = (kind: "final_script" | "review" | "edit_report") => z.object({ id: text, kind: z.literal(kind), version: count.min(1) }).strict();
export const audioObjectSchema = z.object({ key: text, sha256: hash, bytes: count.min(1).max(32_000_000), durationSeconds: z.number().finite().positive() }).strict();
export const audioClipSchema = audioObjectSchema.extend({ chunkId: text }).strict();
export const audioRecordSchema = z.object({
  chunkId: text, phase: z.enum(["submitted", "received", "completed", "uncertain", "rejected"]),
  startedAt: count, receivedAt: count.optional(), requestId: text.optional(), historyItemId: text.optional(),
  maxChargeCharacters: count.min(1), reservedUsd: money,
  chargedCharacters: count.nullable(), reportedCostUsd: money.nullable(), billedUsd: z.null(),
  // character-cost is a provider billing meter; API discounts can make it differ from text length.
  providerCharacterCost: count.nullable().optional(),
  clip: audioClipSchema.optional(), reason: text.optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.phase === "completed") !== !!value.clip) ctx.addIssue({ code: "custom", message: "Only completed audio operations have a saved clip" });
  if (value.clip && value.clip.chunkId !== value.chunkId) ctx.addIssue({ code: "custom", message: "Clip must match its reserved section" });
});
export const audioPlanSchema = z.object({
  version: z.literal(1), finalScript: reference("final_script"), editReport: reference("edit_report"), review: reference("review"),
  scriptHash: hash, planHash: hash, generationId: z.string().uuid(), model: z.enum(["eleven_v3", "eleven_v4"]), voices: audioVoicesSchema,
  pricing: audioPriceSchema, outputFormat: z.literal("mp3_44100_128"), chunkCharacters: count.min(1).max(2000),
  maxCharacters: count.min(1), durationSeconds: z.object({ min: count.min(1), max: count.min(1) }).strict(),
  chunks: z.array(z.object({ id: text, inputs: z.array(z.object({ turnId: text, speaker, text }).strict()).min(1),
    turnIds: z.array(text).min(1), characters: count.min(1), previousText: z.string().max(100), futureText: z.string().max(100) }).strict()).min(1).max(128),
  auditionChunkCount: count.min(2), mode: z.enum(["audition", "full"]), authorizedAt: count, auditionAcceptedAt: count.optional(),
  auditionRequired: z.literal(false).optional(), auditionWaivedAt: count.optional(),
  records: z.array(audioRecordSchema).max(128), audition: audioObjectSchema.optional(), output: audioObjectSchema.optional(),
}).strict();
export const audioStateSchema = z.object({
  version: z.literal(1), allowanceUsd: money, current: audioPlanSchema.optional(), invalidated: z.array(audioPlanSchema).max(8),
}).strict();
export type AudioVoices = z.infer<typeof audioVoicesSchema>;
export type AudioPrice = z.infer<typeof audioPriceSchema>;
export type AudioPlan = z.infer<typeof audioPlanSchema>;
export type AudioRecord = z.infer<typeof audioRecordSchema>;
export type AudioObject = z.infer<typeof audioObjectSchema>;
export type AudioState = z.infer<typeof audioStateSchema>;
export const audioHeldUsd = (state?: AudioState) => state
  ? [...state.invalidated, ...(state.current ? [state.current] : [])].flatMap(plan => plan.records).reduce((sum, record) => sum + record.reservedUsd, 0) : 0;
