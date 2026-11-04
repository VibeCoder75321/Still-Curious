import { z } from "zod";
import { TRAITS, FACTUAL_CONTRACT, TURN_CONTRACT } from "./personality-text.ts";
import { characterSchema, COHERENT_GENERATOR_VERSION } from "./discussion-design.ts";

// Same constraints and prompt wording as the supplied Python v1.6 package.
// The explicitly versioned JS sampler has its own replay sequence (not Python random).
export const PERSONALITY_VERSION = "1.6.0-ts.1";
export const PERSONALITY_PROMPT_VERSION = "1.6.0";
export const TRAIT_KEYS = Object.keys(TRAITS) as (keyof typeof TRAITS)[];
export type Trait = keyof typeof TRAITS;
export type Personality = Record<Trait, number>;
const score = z.number().int().min(1).max(5);
export const personalitySchema = z.object(Object.fromEntries(TRAIT_KEYS.map(key => [key, score])) as Record<Trait, typeof score>).strict();
const text = z.string().min(1).refine(value => !!value.trim(), "Text must not be blank");
const identitySchema = z.object({ id: z.enum(["expert1", "expert2", "expert3"]), name: text, expertise: text }).strict();
export type PersonalityIdentity = z.infer<typeof identitySchema>;
export const personalityDistance = (a: Personality, b: Personality) => TRAIT_KEYS.reduce((sum, key) => sum + Math.abs(a[key] - b[key]), 0);
export function validEnsemble(profiles: Personality[]) {
  return profiles.length === 3 && profiles.every(p => personalitySchema.safeParse(p).success)
    && profiles.every((p, i) => profiles.slice(i + 1).every(q => personalityDistance(p, q) >= 16))
    && (["language_richness", "argumentativeness"] as const).every(key => profiles.some(p => p[key] >= 4) && profiles.some(p => p[key] <= 2))
    && profiles.some(p => p.assertiveness >= 4) && profiles.filter(p => p.verbosity >= 4).length <= 1;
}
export const personalityManifestSchema = z.object({
  generator_version: text, episode_id: text, topic: text, seed: text, accepted_on_draw: z.number().int().min(1).max(20000),
  sampling: text, cast: z.array(identitySchema.extend({ personality: personalitySchema, guidance: text, prompt: text, character: characterSchema.optional() }).strict()).length(3),
  host_cast_brief: text,
}).strict().superRefine((value, ctx) => {
  if (new Set(value.cast.map(g => g.id)).size !== 3 || !validEnsemble(value.cast.map(g => g.personality))) {
    ctx.addIssue({ code: "custom", path: ["cast"], message: "Personality cast must contain three distinct guests satisfying the ensemble constraints" });
  }
  if (value.generator_version === COHERENT_GENERATOR_VERSION && value.cast.some(g => !g.character)) {
    ctx.addIssue({ code: "custom", path: ["cast"], message: "Coherent casts require their saved character foundations" });
  }
});
export type PersonalityManifest = z.infer<typeof personalityManifestSchema>;

/** Hash the persisted random seed into a Mulberry32 stream. No Math.random or runtime Python. */
function sampler(seed: string) {
  let state = 2166136261;
  for (const character of `${PERSONALITY_VERSION}:${seed}`) state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return (value ^ (value >>> 14)) >>> 0;
  };
}
export function samplePersonalities(seed: string) {
  const next = sampler(seed);
  // Rejection of the tiny modulo tail keeps integer draws uniform.
  const draw = (n: number) => {
    const limit = Math.floor(0x100000000 / n) * n;
    let value; do { value = next(); } while (value >= limit);
    return value % n;
  };
  for (let attempt = 1; attempt <= 20000; attempt++) {
    const profiles = Array.from({ length: 3 }, () => Object.fromEntries(TRAIT_KEYS.map(key => [key, 1 + draw(5)])) as Personality);
    if (!validEnsemble(profiles)) continue;
    for (let i = profiles.length - 1; i > 0; i--) {
      const j = draw(i + 1); [profiles[i], profiles[j]] = [profiles[j], profiles[i]];
    }
    return { profiles, attempt };
  }
  throw new Error("Could not draw a valid cast; check ensemble constraints.");
}
const label = (key: Trait) => key.replaceAll("_", " ");
export function personalityGuidance(traits: Personality) {
  return TRAIT_KEYS.map(key => `${label(key).toUpperCase()} — ${traits[key]}/5\n${TRAITS[key][traits[key] - 1]}`).join("\n\n");
}
export function compileGuest(guest: PersonalityIdentity, traits: Personality, topic: string) {
  const ranked = [...TRAIT_KEYS].sort((a, b) => Math.abs(traits[b] - 3) - Math.abs(traits[a] - 3));
  const signatures = ranked.slice(0, 3).map(key => `${label(key)} ${traits[key]}/5`).join(", ");
  return `You are ${guest.name}, the fictional specialist in ${guest.expertise}.
Episode subject: ${topic}

This is your individual episode prompt. Keep this personality throughout the conversation. The numerical settings are private production guidance and must never be spoken. Your strongest distinguishing settings are ${signatures}. Let them be audible without turning them into a catchphrase or a caricature.

${personalityGuidance(traits)}

EVIDENCE AND INTELLECTUAL INTEGRITY
${FACTUAL_CONTRACT}

YOUR NEXT TURN
${TURN_CONTRACT}

Follow your personal language and cadence settings. Do not flatten yourself into a uniformly restrained explainer. Rich language can be concise; an argumentative speaker can be warm; a strongly held judgment can still be conditional.
`;
}
export function compileHost(guests: PersonalityIdentity[], profiles: Personality[]) {
  return ["HOST CAST BRIEF — apply alongside the host's factual and routing instructions.",
    "The cast was drawn before this episode. Each guest has a distinct prompt. Maintain continuity; do not reroll personalities or require uniform tone.",
    ...guests.flatMap((guest, i) => [`\n${guest.name} (${guest.id}): ${guest.expertise}.`, TRAIT_KEYS.map(key => `${label(key)}=${profiles[i][key]}/5`).join("; ") + "."]),
    `
Use the contrast when choosing invitations, without making anyone perform a trait on command. A vivid speaker can make a mechanism imaginable; a blunt speaker can make a judgment explicit; a combative speaker can test a real inference; a warm speaker can develop a useful connection. Match the invitation to expertise and the actual conversation first.

Let a substantive disagreement develop. Ask for the exact claim at issue, the evidence, and what would settle or narrow it. Do not hurry to say everyone agrees. Stop personal friction, repetition, or a disagreement unsupported by the research.

Keep lavish language when it clarifies or gives the subject a memorable shape. Ask for a plain explanation when an image hides the mechanism. Give the more expansive guest bounded questions and protect airtime for the others. Invite a reserved guest on a point where their expertise matters.

Never announce the personality scores, reveal private preparation, or claim a guest said something that exists only in their preparation. Preserve the host's existing action names, routing fields, disclosure requirements, and remaining-time limits. Default to the established host personality; the guest cast supplies the episode-to-episode variation.
`].join("\n");
}
export function buildPersonalityManifest(episodeId: string, topic: string, guests: PersonalityIdentity[], seed: string, runtimeContract: string): PersonalityManifest {
  const identities = z.array(identitySchema).length(3).parse(guests);
  if (new Set(identities.map(g => g.id)).size !== 3) throw new Error("Exactly three unique guest IDs are required.");
  const { profiles, attempt } = samplePersonalities(seed);
  return personalityManifestSchema.parse({ generator_version: PERSONALITY_VERSION, episode_id: episodeId, topic, seed,
    accepted_on_draw: attempt, sampling: "Uniform integer draws from 1–5, with documented ensemble rejection rules; Mulberry32 JS replay.",
    cast: identities.map((guest, i) => ({ ...guest, personality: profiles[i], guidance: personalityGuidance(profiles[i]), prompt: `${compileGuest(guest, profiles[i], topic)}\n\n${runtimeContract}` })),
    host_cast_brief: compileHost(identities, profiles) });
}

export const PERSONALITY_PRIORITY = "The saved episode personality settings supersede older blanket style guidance about restrained, plain, calm or equally courteous guests. Retain expertise, private preparation, evidence-calibrated confidence, listener clarity and all factual safeguards. Personality never establishes facts or requires a disagreement.";
export const PERSONALITY_REVIEW = `${PERSONALITY_PRIORITY} Preserve supported opinion, substantive disagreement, accurate expressive language, humour and each guest's cadence. Do not smooth the cast into the same polite explanatory voice. Judge whether those choices help the listener. Correct misleading imagery or unsupported claims locally while preserving the speaker's personality. Never invent friction or enforce a performance of every trait.`;
