export type DialogueSpeaker = "host" | "expert1" | "expert2" | "expert3";

export type DialogueTurn = {
  id: string;
  speaker: DialogueSpeaker;
  text: string;
};

export type DialogueInput = {
  turnId: string;
  speaker: DialogueSpeaker;
  text: string;
};

export type DialogueChunk = {
  id: string;
  inputs: DialogueInput[];
  turnIds: string[];
  characters: number;
  previousText: string;
  futureText: string;
};

const SPEAKERS = new Set<DialogueSpeaker>(["host", "expert1", "expert2", "expert3"]);

/** Split only at whitespace boundaries, preferring sentence ends when possible. */
function splitTurn(turn: DialogueTurn, maxCharacters: number): DialogueInput[] {
  const parts: DialogueInput[] = [];
  let start = 0;
  while (start < turn.text.length) {
    const remaining = turn.text.length - start;
    if (remaining <= maxCharacters) {
      parts.push({ turnId: turn.id, speaker: turn.speaker, text: turn.text.slice(start) });
      break;
    }

    const limit = start + maxCharacters;
    // A whitespace character belongs to the preceding slice. This keeps the
    // source text byte-for-byte ordered across slices without losing spaces.
    const whitespace: number[] = [];
    for (let i = start; i < limit; i++) if (/\s/.test(turn.text[i])) whitespace.push(i);
    const wordBoundary = whitespace.at(-1);
    if (wordBoundary === undefined || wordBoundary < start) {
      throw new Error(`Turn ${turn.id} contains an unbreakable word longer than ${maxCharacters} characters`);
    }

    // Prefer the latest sentence-ending whitespace in the latter half of the
    // available window; otherwise use the latest word boundary.
    const sentenceBoundary = whitespace.filter(i => i >= start + Math.floor(maxCharacters / 2)
      && /[.!?]["')\]]?$/.test(turn.text.slice(start, i).trimEnd())).at(-1);
    const end = (sentenceBoundary ?? wordBoundary) + 1;
    const text = turn.text.slice(start, end);
    if (!text.trim()) throw new Error(`Turn ${turn.id} could not be split safely`);
    parts.push({ turnId: turn.id, speaker: turn.speaker, text });
    start = end;
  }
  return parts;
}

/** Deterministic, speech-preserving chunks for ElevenLabs text-to-dialogue. */
export function buildDialogueChunks(turns: DialogueTurn[], maxCharacters = 1800): DialogueChunk[] {
  if (!Array.isArray(turns) || turns.length === 0) throw new Error("Dialogue requires at least one turn");
  if (!Number.isInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 2000) {
    throw new Error("Dialogue chunk limit must be an integer from 1 to 2000 characters");
  }

  const ids = new Set<string>();
  const flattened: DialogueInput[] = [];
  for (const turn of turns) {
    if (!turn || typeof turn.id !== "string" || !turn.id.trim() || ids.has(turn.id)) {
      throw new Error("Dialogue turn IDs must be unique, non-empty strings");
    }
    if (!SPEAKERS.has(turn.speaker)) throw new Error(`Turn ${turn.id} has an unsupported speaker`);
    if (typeof turn.text !== "string" || !turn.text.trim()) throw new Error(`Turn ${turn.id} needs non-empty text`);
    ids.add(turn.id);
    flattened.push(...splitTurn(turn, maxCharacters));
  }

  const groups: DialogueInput[][] = [];
  let group: DialogueInput[] = [];
  let characters = 0;
  for (const input of flattened) {
    if (group.length && characters + input.text.length > maxCharacters) {
      groups.push(group);
      group = [];
      characters = 0;
    }
    group.push(input);
    characters += input.text.length;
  }
  if (group.length) groups.push(group);

  return groups.map((inputs, index) => {
    const before = flattened.slice(0, groups.slice(0, index).reduce((n, g) => n + g.length, 0))
      .map(input => input.text).join(" ");
    const after = flattened.slice(groups.slice(0, index + 1).reduce((n, g) => n + g.length, 0))
      .map(input => input.text).join(" ");
    const uniqueTurnIds = [...new Set(inputs.map(input => input.turnId))];
    return {
      id: `section-${String(index + 1).padStart(2, "0")}`,
      inputs,
      turnIds: uniqueTurnIds,
      characters: inputs.reduce((n, input) => n + input.text.length, 0),
      previousText: before.slice(-100),
      futureText: after.slice(0, 100),
    };
  });
}
