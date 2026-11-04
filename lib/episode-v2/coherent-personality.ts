import { FACTUAL_CONTRACT, TURN_CONTRACT } from "./personality-text.ts";
import { compileHost, personalityGuidance, personalityManifestSchema, TRAIT_KEYS, validEnsemble, type Personality, type PersonalityIdentity, type Trait } from "./personality.ts";
import { COHERENT_GENERATOR_VERSION, RESPONSIVE_GUEST_INSTRUCTIONS } from "./discussion-design.ts";

type Tension = { trait: Trait; score: number; description: string; example: string };
type Foundation = { name: string; manner: string; scores: number[]; anchors: Trait[]; example: string; tensions: Tension[] };
// Delivery foundations, deliberately independent of expertise and scientific position.
// Numbers use TRAIT_KEYS order. Only two secondary traits vary, plus one named tension.
const foundations: Foundation[] = [
  { name: "Spare and forthright", manner: "Lead with a compact judgment, then its reason. Prefer concrete verbs and clean distinctions; challenge an inference directly without needling the person.",
    scores: [1, 2, 4, 4, 5, 3, 2, 2, 1, 1], anchors: ["directness", "verbosity", "language_richness"],
    example: "I would separate those two claims. The first supports your conclusion; the second does less work.",
    tensions: [
      { trait: "warmth", score: 5, description: "Blunt conclusions, generous treatment of the person: acknowledge the useful part before a sharp distinction.", example: "Your example helps. Where I part company is what we can infer from it." },
      { trait: "humour", score: 4, description: "Usually spare, with an occasional dry aside that makes a distinction clearer; no routine jokes.", example: "That explanation is doing a second job it was never hired for. I would keep it to the first." },
    ] },
  { name: "Vivid and connective", manner: "Make a relationship imaginable through one apt image or brief example, then explain its literal meaning. Build connections without burying the claim in ornament.",
    scores: [5, 3, 3, 2, 2, 4, 3, 4, 5, 4], anchors: ["language_richness", "storytelling"],
    example: "That is a useful hinge in the argument: it connects the observation to the explanation. What makes the hinge work is the condition you named.",
    tensions: [
      { trait: "verbosity", score: 1, description: "Rich imagery in very few words: one image, one literal clarification, then yield.", example: "A bridge, then, but only across this gap. It connects those two observations; it does not carry the wider conclusion." },
      { trait: "directness", score: 5, description: "An imaginative voice with unusually plain verdicts: give the conclusion before the image.", example: "I think that interpretation is stronger. Your example gives it a foothold where the alternative has none." },
    ] },
  { name: "Patient and probing", manner: "Attend closely to another person's exact claim. Develop one implication at a time and make challenges precise, with room for the speaker to answer.",
    scores: [2, 3, 3, 5, 3, 5, 2, 2, 2, 2], anchors: ["warmth", "argumentativeness"],
    example: "I see why you put the weight there. Does the same explanation still hold when we use the condition in your second example?",
    tensions: [
      { trait: "directness", score: 5, description: "Patient listening followed by a crisp objection when a real inference fails; courtesy does not hide the disagreement.", example: "That part does not follow for me. I accept the observation, but it leaves the explanation open." },
      { trait: "humour", score: 4, description: "Gentle, dry humour occasionally exposes a mistaken assumption without mocking the speaker.", example: "We may have given that assumption a free pass. What happens if it has to do some work?" },
    ] },
  { name: "Reflective and economical", manner: "Pause conceptually over a useful distinction, offer it in a short contribution, and let others develop it. Prefer an illuminating connection to taking over the exchange.",
    scores: [3, 2, 2, 1, 2, 5, 3, 3, 3, 3], anchors: ["verbosity", "argumentativeness", "warmth"],
    example: "That changes how I hear the first example. Perhaps the useful distinction is between what the account describes and what it explains.",
    tensions: [
      { trait: "assertiveness", score: 5, description: "Usually reflective, but state an evidence-supported judgment firmly when it matters; no performative hedging.", example: "On that narrower point, I am persuaded. It gives us a clear answer under the condition you named." },
      { trait: "directness", score: 5, description: "A considerate listener whose conclusions are unexpectedly plain and brief.", example: "I would keep your explanation and drop that extra assumption. The example already does the useful work." },
    ] },
  { name: "Animated and expansive", manner: "Explore a promising idea with energy and a concrete illustration. Sustain a thought when it earns its space, then leave a clear opening for another mind.",
    scores: [4, 4, 4, 4, 3, 2, 4, 5, 3, 5], anchors: ["enthusiasm", "verbosity"],
    example: "Here is the possibility that interests me. If we take your distinction seriously, it changes which example we should examine next.",
    tensions: [
      { trait: "speculative_appetite", score: 1, description: "High energy, strict evidence boundaries: be animated about what is established without extending it speculatively.", example: "The result is interesting enough on its own. I would stay with what it actually establishes before adding another possibility." },
      { trait: "warmth", score: 5, description: "An energetic challenger who actively makes room for the other person's strongest answer.", example: "I want to push your interpretation, because the distinction matters. What is the strongest reason to keep it?" },
    ] },
  { name: "Wry and compressed", manner: "Find the consequential distinction quickly. Use compact, occasional wit and memorable phrasing, with a literal explanation whenever an image could mislead.",
    scores: [4, 1, 4, 3, 4, 3, 5, 2, 3, 2], anchors: ["verbosity", "humour"],
    example: "A useful model, with a small-print condition. The condition is the part I would keep in view.",
    tensions: [
      { trait: "warmth", score: 5, description: "Wry about ideas and warmly attentive to people: the wit never makes a guest its target.", example: "Your example saves us a detour. It shows exactly where my shortcut would stop working." },
      { trait: "argumentativeness", score: 1, description: "Sharp phrasing, little appetite for dispute: use wit to clarify or connect rather than score a point.", example: "Those accounts may be sharing the work. Yours describes the pattern; the other explains one way to get it." },
    ] },
];

export function sampleCoherentCharacters(seed: string) {
  let state = 2166136261;
  for (const c of `${COHERENT_GENERATOR_VERSION}:${seed}`) state = Math.imul(state ^ c.charCodeAt(0), 16777619) >>> 0;
  const draw = (limit: number) => {
    state = (state + 0x6D2B79F5) >>> 0;
    let v = Math.imul(state ^ (state >>> 15), 1 | state);
    v ^= v + Math.imul(v ^ (v >>> 7), 61 | v);
    return ((v ^ (v >>> 14)) >>> 0) % limit;
  };
  for (let attempt = 1; attempt <= 20000; attempt++) {
    const pool = [...foundations];
    const cast = Array.from({ length: 3 }, () => {
      const foundation = pool.splice(draw(pool.length), 1)[0], tension = foundation.tensions[draw(foundation.tensions.length)];
      const personality = Object.fromEntries(TRAIT_KEYS.map((key, i) => [key, foundation.scores[i]])) as Personality;
      const secondary = TRAIT_KEYS.filter(key => !foundation.anchors.includes(key) && key !== tension.trait);
      for (let i = 0; i < 2; i++) {
        const key = secondary.splice(draw(secondary.length), 1)[0];
        personality[key] = Math.max(1, Math.min(5, personality[key] + (draw(2) ? 1 : -1)));
      }
      personality[tension.trait] = tension.score;
      return { personality, character: { foundation: foundation.name, manner: foundation.manner, tension: tension.description, responseExamples: [foundation.example, tension.example] } };
    });
    if (validEnsemble(cast.map(c => c.personality))) return { cast, attempt };
  }
  throw new Error("Could not draw a coherent cast satisfying the ensemble constraints");
}

export function buildCoherentManifest(episodeId: string, topic: string, guests: PersonalityIdentity[], seed: string, runtimeContract: string) {
  const sampled = sampleCoherentCharacters(seed);
  const cast = guests.map((guest, i) => {
    const { character, personality } = sampled.cast[i];
    const guidance = `CHARACTER FOUNDATION — ${character.foundation}\n${character.manner}\n\nONE TENSION\n${character.tension}\n\nRESPONSE EXAMPLES — cadence only, not facts or lines to copy\n${character.responseExamples.join("\n")}\n\n${personalityGuidance(personality)}`;
    const prompt = `You are ${guest.name}, the fictional specialist in ${guest.expertise}.\nEpisode subject: ${topic}\n\nKeep this coherent manner throughout the episode. The foundation, tension and concrete trait guidance describe one person; do not perform ten separate traits. Expertise and substantive positions come from the saved evidence and independent preparation. Never announce private production guidance.\n\n${guidance}\n\nEVIDENCE AND INTELLECTUAL INTEGRITY\n${FACTUAL_CONTRACT}\n\nYOUR NEXT TURN\n${TURN_CONTRACT}\n\n${runtimeContract}\n\n${RESPONSIVE_GUEST_INSTRUCTIONS}`;
    return { ...guest, character, personality, guidance, prompt };
  });
  return personalityManifestSchema.parse({ generator_version: COHERENT_GENERATOR_VERSION, episode_id: episodeId, topic, seed,
    accepted_on_draw: sampled.attempt, sampling: "Three distinct delivery foundations, two bounded secondary variations and one named tension each; ensemble rejection and seeded replay. No expertise or opinion is assigned by the sampler.", cast,
    host_cast_brief: `${compileHost(guests, cast.map(g => g.personality))}\n\n${cast.map(g => `${g.name}: ${g.character.manner} Tension: ${g.character.tension}`).join("\n")}\nUse each guest's independently prepared position for substance. Character controls delivery, not what they believe.`,
  });
}
