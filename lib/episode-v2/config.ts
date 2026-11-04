import { z } from "zod";

const count = z.number().int().positive();
const range = z.object({ min: count, max: count }).strict()
  .refine(value => value.min <= value.max, "Range minimum exceeds maximum");

export const resourceLimitsSchema = z.object({
  maxProviderOperations: count,
  maxSearchCalls: count,
  maxSourceReads: count,
  maxConversationTurns: count,
  maxContributionRequestRounds: z.number().int().nonnegative(),
  maxEditPasses: count,
  maxReviewPasses: count,
  maxLocalRepairPasses: z.number().int().nonnegative(),
  maxSectionRevisionPasses: z.number().int().nonnegative(),
  maxPostConversationSourceReads: z.number().int().nonnegative().optional(),
  // Null means no live-spending authorization is represented by this config.
  spendCeilingUsd: z.number().finite().positive().nullable(),
}).strict();

const configFields = {
  schemaVersion: z.literal(2),
  pipelineVersion: z.literal(2),
  // Editorial guidance for the episode as a whole, not per-turn validation.
  introductionTargetSeconds: range,
  spokenWordTarget: range,
  audioDurationSeconds: range,
  audio: z.object({
    maxCharacters: count,
    chunkMaxCharacters: count.max(2000),
  }).strict(),
  limits: resourceLimitsSchema,
};

function validateConfig(value: {
  targetDurationSeconds: number; audioDurationSeconds: { min: number; max: number };
  introductionTargetSeconds: { max: number }; audio: { chunkMaxCharacters: number; maxCharacters: number };
}, ctx: z.RefinementCtx) {
  if (value.audioDurationSeconds.min > value.targetDurationSeconds || value.audioDurationSeconds.max < value.targetDurationSeconds) {
    ctx.addIssue({ code: "custom", path: ["audioDurationSeconds"], message: "Audio range must contain the selected target" });
  }
  if (value.introductionTargetSeconds.max >= value.targetDurationSeconds) {
    ctx.addIssue({ code: "custom", path: ["introductionTargetSeconds"], message: "Introduction must leave time for discussion" });
  }
  if (value.audio.chunkMaxCharacters > value.audio.maxCharacters) {
    ctx.addIssue({ code: "custom", path: ["audio", "chunkMaxCharacters"], message: "A chunk cannot exceed the episode character allowance" });
  }
}

export const fiveMinuteConfigSchema = z.object({
  ...configFields, profileVersion: z.literal("five-minute-pilot-v1"),
  lengthMinutes: z.literal(5), targetDurationSeconds: z.literal(300),
}).strict().superRefine(validateConfig);
export const fifteenMinuteConfigSchema = z.object({
  ...configFields, profileVersion: z.literal("fifteen-minute-pilot-v1"),
  lengthMinutes: z.literal(15), targetDurationSeconds: z.literal(900),
}).strict().superRefine(validateConfig);
export const episodeConfigSchema = z.union([fiveMinuteConfigSchema, fifteenMinuteConfigSchema]);
export const episodeLengthSchema = z.union([z.literal(5), z.literal(15)]);
export const durationProfileSchema = z.enum(["five-minute-pilot-v1", "fifteen-minute-pilot-v1"]);
export type EpisodeLength = z.infer<typeof episodeLengthSchema>;
export type EpisodeConfig = z.infer<typeof episodeConfigSchema>;

export type ResourceLimits = z.infer<typeof resourceLimitsSchema>;
export type FiveMinuteConfig = z.infer<typeof fiveMinuteConfigSchema>;

/** Candidate pilot safeguards, not measured costs or a model policy. */
export function createFiveMinuteConfig(limits: Partial<ResourceLimits> = {}): FiveMinuteConfig {
  return fiveMinuteConfigSchema.parse({
    schemaVersion: 2,
    pipelineVersion: 2,
    profileVersion: "five-minute-pilot-v1",
    lengthMinutes: 5,
    targetDurationSeconds: 300,
    introductionTargetSeconds: { min: 20, max: 30 },
    spokenWordTarget: { min: 550, max: 700 },
    audioDurationSeconds: { min: 240, max: 390 },
    audio: { maxCharacters: 5000, chunkMaxCharacters: 1800 },
    limits: {
      maxProviderOperations: 64,
      maxSearchCalls: 4,
      maxSourceReads: 8,
      maxConversationTurns: 32,
      maxContributionRequestRounds: 3,
      maxEditPasses: 1,
      maxReviewPasses: 2,
      maxLocalRepairPasses: 1,
      maxSectionRevisionPasses: 1,
      maxPostConversationSourceReads: 1,
      spendCeilingUsd: null,
      ...limits,
    },
  });
}

/** Longer discussion with the same evidence, review and spending safeguards. */
export function createFifteenMinuteConfig(limits: Partial<ResourceLimits> = {}): EpisodeConfig {
  const base = createFiveMinuteConfig();
  return fifteenMinuteConfigSchema.parse({
    ...base, profileVersion: "fifteen-minute-pilot-v1", lengthMinutes: 15, targetDurationSeconds: 900,
    introductionTargetSeconds: { min: 45, max: 60 },
    spokenWordTarget: { min: 1650, max: 2100 },
    audioDurationSeconds: { min: 720, max: 1170 },
    audio: { ...base.audio, maxCharacters: 15000 },
    limits: { ...base.limits, maxProviderOperations: 128, maxConversationTurns: 64, maxContributionRequestRounds: 9, ...limits },
  });
}

export function createEpisodeConfig(lengthMinutes: EpisodeLength = 5, limits: Partial<ResourceLimits> = {}): EpisodeConfig {
  return episodeLengthSchema.parse(lengthMinutes) === 15 ? createFifteenMinuteConfig(limits) : createFiveMinuteConfig(limits);
}
