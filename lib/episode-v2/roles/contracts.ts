import { z } from "zod";
import { guestSpeakerSchema, speakerSchema, type ArtifactRef, type Speaker } from "../contracts.ts";
import type { ProviderRequest } from "../providers.ts";

const text = z.string().min(1).refine(value => value.trim().length > 0, "Text must not be blank");
const note = z.string().min(1).max(2000).refine(value => value.trim().length > 0, "Text must not be blank");
export const hostActionSchema = z.object({
  text: text.nullable(), action: z.enum(["ask", "yield", "continue", "close", "request_contributions"]), nextSpeaker: speakerSchema.nullable(),
  purpose: note, pointToAddress: note.nullable(), currentTopic: note,
  unresolvedQuestions: z.array(note).max(12), detourReturnPoint: note.nullable(),
  requestDecisions: z.array(z.object({ requestId: note, decision: z.enum(["accept", "park", "decline"]) }).strict()).max(12).optional(),
  requestFeedback: z.array(z.object({ requestId: note, useful: z.boolean(), reason: note }).strict()).max(12).optional(),
  clarificationNeeded: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  const guest = value.nextSpeaker !== null && value.nextSpeaker !== "host";
  if ((value.action === "ask" || value.action === "yield") && !guest) ctx.addIssue({ code: "custom", path: ["nextSpeaker"], message: "Ask and yield must select a guest" });
  if (value.action === "ask" && value.text === null) ctx.addIssue({ code: "custom", path: ["text"], message: "An ask needs the host's spoken question" });
  if (value.action === "continue" && (value.text === null || value.nextSpeaker !== "host")) ctx.addIssue({ code: "custom", path: ["action"], message: "Continue needs host speech and retains the host's floor" });
  if (value.action === "close" && value.nextSpeaker !== null) ctx.addIssue({ code: "custom", path: ["nextSpeaker"], message: "Close does not invite another speaker" });
  if (value.action === "request_contributions" && (value.text !== null || value.nextSpeaker !== null)) ctx.addIssue({ code: "custom", path: ["action"], message: "Collect requests silently before choosing the next speaker" });
});
export type HostAction = z.infer<typeof hostActionSchema>;

// No per-turn word target or minimum: a short qualification and a sustained explanation are both valid.
export const guestContributionSchema = z.object({ text, stanceUpdate: note.nullable(),
  addressedGuest: z.object({ speaker: guestSpeakerSchema, reason: note }).strict().nullable().optional(),
}).strict();
export type GuestContribution = z.infer<typeof guestContributionSchema>;
export const contributionRequestSchema = z.object({
  decision: z.enum(["pass", "contribute"]),
  point: z.string().min(1).max(360).refine(value => value.trim().length > 0, "Point must not be blank").nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.decision === "pass") !== (value.point === null)) ctx.addIssue({ code: "custom", path: ["point"], message: "Pass has no point; contribute needs one brief point" });
});
export type ContributionRequest = z.infer<typeof contributionRequestSchema>;

const string = { type: "string", minLength: 1 };
const noteString = { ...string, maxLength: 2000 };
const nullable = (schema: unknown) => ({ anyOf: [schema, { type: "null" }] });
const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
export const HOST_ACTION_JSON_SCHEMA = object({
  text: nullable(string), action: { type: "string", enum: ["ask", "yield", "continue", "close", "request_contributions"] },
  nextSpeaker: nullable({ type: "string", enum: speakerSchema.options }), purpose: noteString,
  pointToAddress: nullable(noteString), currentTopic: noteString,
  unresolvedQuestions: { type: "array", items: noteString, maxItems: 12 }, detourReturnPoint: nullable(noteString),
  requestDecisions: { type: "array", maxItems: 12, items: object({ requestId: noteString, decision: { type: "string", enum: ["accept", "park", "decline"] } }) },
  requestFeedback: { type: "array", maxItems: 12, items: object({ requestId: noteString, useful: { type: "boolean" }, reason: noteString }) },
  clarificationNeeded: { type: "boolean" },
});
export const GUEST_CONTRIBUTION_JSON_SCHEMA = object({ text: string, stanceUpdate: nullable(noteString),
  addressedGuest: nullable(object({ speaker: { type: "string", enum: guestSpeakerSchema.options }, reason: noteString })) });
export const CONTRIBUTION_REQUEST_JSON_SCHEMA = object({
  decision: { type: "string", enum: ["pass", "contribute"] }, point: nullable({ ...string, maxLength: 360 }),
});

/** Task 11 supplies durable step identity, acceptance and floor routing. A role cannot save a transcript. */
export type RolePlan<T> = {
  speaker: Speaker; inputs: ArtifactRef[]; prompt: { id: string; version: string }; editorialVersion: string;
  request: Omit<Extract<ProviderRequest<T>, { kind: "structured" | "research" }>, "id"> & { kind: "structured" };
};
