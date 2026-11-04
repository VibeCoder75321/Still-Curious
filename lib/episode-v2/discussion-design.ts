import { z } from "zod";

// Opt in when the job is created. Existing attempts retain their original request hashes.
export const DISCUSSION_VERSION = "1.7.0";
export const COHERENT_GENERATOR_VERSION = "1.7.0-coherent.1";
const text = z.string().min(1).max(2000).refine(s => !!s.trim(), "Text must not be blank");
const ids = z.array(text).min(1).max(8);
const speaker = z.enum(["expert1", "expert2", "expert3"]);
export const characterSchema = z.object({
  foundation: text, manner: text, tension: text, responseExamples: z.array(text).length(2),
}).strict();
export const positionSchema = z.object({
  priority: text, judgment: text, tradeoff: text, strongestAlternative: text, concession: text, claimIds: ids,
}).strict();
export type Position = z.infer<typeof positionSchema>;
export const discussionPointSchema = z.object({
  claimIds: ids, guests: z.array(speaker).min(2).max(3),
  differentPriorities: text, invitation: text,
}).strict();
export const interactionReviewSchema = z.object({
  assessment: z.enum(["substantive", "limited", "parallel"]),
  exchanges: z.array(z.object({
    sourceTurnId: text, responseTurnId: text,
    sourceQuote: z.string().min(8).max(500), responseQuote: z.string().min(8).max(500),
    kind: z.enum(["challenge", "revision", "clarification", "development"]), development: text,
  }).strict()).max(6),
  missedOpportunity: text.nullable(),
}).strict().superRefine((value, ctx) => {
  if ((value.assessment === "parallel") !== (value.exchanges.length === 0)) {
    ctx.addIssue({ code: "custom", path: ["exchanges"], message: "Name an actual exchange for substantive or limited interaction; parallel speech has none" });
  }
});
export type InteractionReview = z.infer<typeof interactionReviewSchema>;
export const foundationCoverageSchema = z.array(z.object({
  foundationIndex: z.number().int().nonnegative(), claimIds: z.array(text).max(8), gap: text.nullable(),
}).strict());

const s = { type: "string", minLength: 1, maxLength: 2000 };
export const strictObject = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const references = { type: "array", items: s, minItems: 1, maxItems: 8 };
export const FOUNDATION_COVERAGE_JSON_SCHEMA = { type: "array", items: strictObject({
  foundationIndex: { type: "integer", minimum: 0 }, claimIds: { type: "array", items: s, maxItems: 8 }, gap: { anyOf: [s, { type: "null" }] },
}) };
export const POSITION_JSON_SCHEMA = strictObject({ priority: s, judgment: s, tradeoff: s, strongestAlternative: s, concession: s, claimIds: references });
export const DISCUSSION_POINT_JSON_SCHEMA = strictObject({
  claimIds: references, guests: { type: "array", items: { type: "string", enum: speaker.options }, minItems: 2, maxItems: 3 }, differentPriorities: s, invitation: s,
});
export const INTERACTION_REVIEW_JSON_SCHEMA = strictObject({
  assessment: { type: "string", enum: ["substantive", "limited", "parallel"] },
  exchanges: { type: "array", maxItems: 6, items: strictObject({
    sourceTurnId: s, responseTurnId: s, sourceQuote: { type: "string", minLength: 8, maxLength: 500 }, responseQuote: { type: "string", minLength: 8, maxLength: 500 },
    kind: { type: "string", enum: ["challenge", "revision", "clarification", "development"] }, development: s,
  }) }, missedOpportunity: { anyOf: [s, { type: "null" }] },
});

export const POSITION_INSTRUCTIONS = `Prepare something worth defending before deciding how to say it. In position, name the outcome or explanatory priority you care about, a positive evidence-supported judgment, the trade-off it accepts, the strongest reasonable alternative, and a real concession. Ground the judgment and trade-off in claimIds from your supportingClaims. Interpretations must stay labelled as interpretations; qualifications still apply. A position can favour a mechanism, scale of explanation, or interpretation; it need not be a policy recommendation. Do not reduce every position to "more evidence is needed". If the evidence cannot sustain competing conclusions, defend different useful priorities within the shared conclusion. You do not know the other guests' notes, so do not invent opponents. Use whatWouldChangeMyView for a concrete revision condition. Your personality controls delivery, never the facts, expertise, position or willingness to update.`;
export const DISCUSSION_PLAN_INSTRUCTIONS = `Build discussionPoints from the actual independent positions in the supplied notes. For each, identify a shared supported claim, at least two guests, their different priorities or genuine agreement with distinct implications, and one short invitation that could let them develop the point together. Do not script answers or assign "pro" and "con" roles. A planned contrast is only an opportunity: the live host must wait until the relevant point is actually spoken before inviting a reply.
Preserve the original listener promise and essentialFoundations. Include a "Foundation:" priority for each necessary concept, linked to supported claim IDs and the question it enables. Explain the basic operating logic before specialist limitations. Do not replace a requested explanation with a discussion of how poorly its evidence generalises. If a foundation is absent from the frozen pack, identify the gap explicitly rather than planning an invented explanation. Plan depth against selectedDuration.spokenWordTarget; do not fill time by repeating caveats.`;
export const RESPONSIVE_HOST_INSTRUCTIONS = `Use the saved positions and discussionPoints to find a live exchange. After a guest's substantive claim, consider which other guest has a relevant priority, counterexample, implication or qualification. Invite that guest to respond to the exact accepted point; use a silent yield where no extra setup is needed. Let the first guest answer a material challenge or revise, and then follow the consequence. Do not impose a challenge or a question on every turn. Agreement can develop an idea; simple restatement does not.
Before opening another topic or closing, check the original listenerPromise and essentialFoundations against the actual accepted words. A specialist debate cannot substitute for the basic explanation the listener requested. Use selectedDuration.spokenWordTarget and spokenWordsSoFar to judge whether the requested depth has been delivered. If far below the target and allowance remains, develop an unexplained foundation, worked example, consequence or genuine exchange using the saved evidence. Never pad, repeat an already-understood caveat or invent material to reach a count. Always obey closeNow. Do not present an allowance-forced short episode as a full delivery of the promise.`;
export const RESPONSIVE_GUEST_INSTRUCTIONS = `Keep your saved position in mind without reciting its fields. Answer the live invitation and, when relevant, take up the exact point another guest actually made: test its implication, sharpen it with an example, concede part, or revise your judgment. A response must add something to those words rather than restart your prepared explanation. Direct address is welcome when useful, not mandatory on every turn. Mark addressedGuest when you actually address another guest's position so they can reply. Do not repeat a limitation already established unless it changes the current inference. Your two response examples illustrate rhythm and attitude only; never repeat them as catchphrases or treat them as evidence.`;
export const INTERACTION_REVIEW_INSTRUCTIONS = `Complete interactionReview from the edited speech, not the cast design, host plan, turn counts or routing metadata. For each real guest-to-guest exchange, name the earlier sourceTurnId and later responseTurnId, copy a short exact sourceQuote and responseQuote, and explain what changed through a challenge, revision, clarification or development. Quotes must be literal substrings of the named turns. A host question followed by an independent answer is not by itself guest-to-guest interaction. Use parallel and an empty exchanges array when there is none; never invent an example to pass review. Identify a concrete missed opportunity when relevant. An interaction may agree with and extend a previous idea; conflict is not required.
Compare acceptedOriginalTurns with editedEpisode for voice preservation: check rhythm, imagery, directness, warmth and humour against each saved character. Use the Voices note to identify meaningful preservation or flattening with turn IDs. Correct only misleading or obstructive language. If parallel mini-lectures or repeated caveats materially replace the requested understanding, raise a bounded editorial issue. Modest weakness can stay in notes. Do not manufacture new speech or disagreement in editing.`;

export function validateInteractionReview(value: z.infer<typeof interactionReviewSchema>, turns: { id: string; speaker: string; text: string }[]) {
  const seen = new Set<string>();
  for (const exchange of value.exchanges) {
    const from = turns.findIndex(t => t.id === exchange.sourceTurnId), to = turns.findIndex(t => t.id === exchange.responseTurnId);
    const key = `${exchange.sourceTurnId}:${exchange.responseTurnId}`;
    if (from < 0 || to <= from || turns[from].speaker === "host" || turns[to].speaker === "host"
      || turns[from].speaker === turns[to].speaker || !turns[from].text.includes(exchange.sourceQuote)
      || !turns[to].text.includes(exchange.responseQuote) || seen.has(key)) {
      throw new Error("Interaction evidence must quote distinct guests' actual edited speech in chronological order");
    }
    seen.add(key);
  }
  return value;
}

export const RESEARCH_FOUNDATIONS_INSTRUCTIONS = `Prioritise the listener's essentialFoundations before specialist cases or novelty. For a request to understand a process, find authoritative material explaining its purpose and basic operating cycle as well as useful limitations. Preserve saved passages that actually support that explanation. Track any missing foundation explicitly in gaps across the saved research; do not treat unrelated specialist studies as coverage. Resolve these gaps within the existing research allowance before expanding optional branches.`;
export const EVIDENCE_FOUNDATIONS_INSTRUCTIONS = `Return foundationCoverage with exactly one entry for each episodeBrief.data.essentialFoundations item, identified by its zero-based foundationIndex. Link claimIds that actually explain that foundation, not merely mention its topic. Use gap=null only when those supported claims and saved passages are sufficient; otherwise describe the precise missing explanation. Claims marked outside_material_read, contradicted or lacking passages cannot supply coverage. Never invent a missing basic mechanism from memory. Narrowing may remove optional branches, but must preserve the listener promise and these essential foundations. Return insufficient when an essential foundation remains missing, even if three specialist perspectives could discuss the available studies.`;
