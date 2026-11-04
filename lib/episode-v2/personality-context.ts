import type { Cast, GuestSpeaker } from "./contracts.ts";
import { COHERENT_GENERATOR_VERSION, DISCUSSION_VERSION } from "./discussion-design.ts";
import { PERSONALITY_PROMPT_VERSION } from "./personality.ts";

export const isCoherentCast = (cast: Cast) => cast.data.personality?.generator_version === COHERENT_GENERATOR_VERSION;
export const castPromptVersion = (cast: Cast) => isCoherentCast(cast) ? DISCUSSION_VERSION : PERSONALITY_PROMPT_VERSION;

/** Legacy episodes retain their exact context; new casts omit superseded style fields. */
export function guestForModel(cast: Cast, speaker: GuestSpeaker) {
  const guest = cast.data.guests.find(g => g.speaker === speaker)!;
  const snapshot = cast.data.personality?.cast.find(g => g.id === speaker);
  if (!snapshot) return guest;
  const { temperament: _temperament, confidenceStyle: _confidence, humour: _humour, ...expertise } = guest;
  return { ...expertise, personality: snapshot.personality, personalityGuidance: snapshot.guidance,
    ...(snapshot.character ? { character: snapshot.character } : {}) };
}
export function castForModel(cast: Cast) {
  if (!cast.data.personality) return cast.data;
  const { personality: _manifest, ...data } = cast.data;
  return { ...data, guests: data.guests.map(g => guestForModel(cast, g.speaker)), hostCastBrief: cast.data.personality.host_cast_brief };
}
