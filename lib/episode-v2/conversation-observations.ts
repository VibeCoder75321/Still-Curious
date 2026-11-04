import type { SpokenTurn } from "./contracts.ts";

const GUESTS = ["expert1", "expert2", "expert3"] as const;
const words = (text: string) => text.trim() ? text.trim().split(/\s+/u).length : 0;

/** Descriptive counts from exact speech, never a proxy for substance or a floor assignment. */
export function conversationObservations(turns: readonly SpokenTurn[]) {
  const guestTurns = turns.filter(turn => turn.speaker !== "host");
  const guests = GUESTS.map(speaker => {
    const own = guestTurns.filter(turn => turn.speaker === speaker);
    const lastIndex = guestTurns.findLastIndex(turn => turn.speaker === speaker);
    return { speaker, turns: own.length, words: own.reduce((sum, turn) => sum + words(turn.text), 0),
      lastTurnId: own.at(-1)?.id ?? null,
      otherGuestTurnsSinceLast: guestTurns.length - lastIndex - 1 };
  });
  return {
    totalTurns: turns.length, totalWords: turns.reduce((sum, turn) => sum + words(turn.text), 0),
    hostWords: turns.filter(turn => turn.speaker === "host").reduce((sum, turn) => sum + words(turn.text), 0),
    guests, guestsNotYetHeard: guests.filter(guest => guest.turns === 0).map(guest => guest.speaker),
    // Adjacency alone cannot establish that one guest engaged with another's idea.
    adjacentDifferentGuestTurns: turns.filter((turn, index) => index > 0 && turn.speaker !== "host"
      && turns[index - 1].speaker !== "host" && turn.speaker !== turns[index - 1].speaker).length,
  };
}
