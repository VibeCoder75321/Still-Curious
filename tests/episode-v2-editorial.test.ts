import test from "node:test";
import assert from "node:assert/strict";
import { conversationObservations } from "../lib/episode-v2/conversation-observations.ts";
import { createGuestRolePlan } from "../lib/episode-v2/roles/guest.ts";
import { createHostRolePlan } from "../lib/episode-v2/roles/host.ts";
import { speakingFixture } from "./fixtures/speaking.ts";
import type { SpokenTurn } from "../lib/episode-v2/contracts.ts";

test("participation describes absent and returning guests without claiming semantic interaction", () => {
  const turns: SpokenTurn[] = [
    { id: "a", speaker: "host", text: "One question." },
    { id: "b", speaker: "expert1", text: "An initial explanation." },
    { id: "c", speaker: "expert2", text: "A related point." },
    { id: "d", speaker: "expert2", text: "One clarification." },
    { id: "e", speaker: "host", text: "And now?" },
    { id: "f", speaker: "expert1", text: "A return." },
  ];
  const before = JSON.stringify(turns), result = conversationObservations(turns);
  assert.deepEqual(result, { totalTurns: 6, totalWords: 14, hostWords: 4,
    guests: [
      { speaker: "expert1", turns: 2, words: 5, lastTurnId: "f", otherGuestTurnsSinceLast: 0 },
      { speaker: "expert2", turns: 2, words: 5, lastTurnId: "d", otherGuestTurnsSinceLast: 1 },
      { speaker: "expert3", turns: 0, words: 0, lastTurnId: null, otherGuestTurnsSinceLast: 4 },
    ], guestsNotYetHeard: ["expert3"], adjacentDifferentGuestTurns: 1 });
  assert.equal(JSON.stringify(turns), before);
  assert.deepEqual(conversationObservations([]).guestsNotYetHeard, ["expert1", "expert2", "expert3"]);
  assert.equal(conversationObservations([]).adjacentDifferentGuestTurns, 0);
});

test("the host sees live participation; guests keep only their own preparation and exact shared speech", async () => {
  const { job, read, transcript } = await speakingFixture();
  const before = JSON.stringify(transcript);
  const host = JSON.parse((await createHostRolePlan(job, read)).request.input);
  assert.deepEqual(host.participation.guestsNotYetHeard, ["expert1"]);
  assert.deepEqual(host.participation.guests.map((guest: { turns: number }) => guest.turns), [0, 1, 1]);
  const guest = JSON.parse((await createGuestRolePlan(job, read, "expert1")).request.input);
  assert.deepEqual(guest.acceptedTranscript.turns, transcript.data.turns);
  for (const key of ["participation", "hostPlan", "guestPreparationSummaries", "cast"]) assert.equal(guest[key], undefined);
  assert.equal(JSON.stringify(transcript), before);
});

test("schema-compatible saved preparation survives guidance updates while unknown versions still block", async () => {
  const { job, read, cast, preparations, hostPlan } = await speakingFixture();
  for (const version of ["1.0.0", "1.1.0", "1.2.0"]) {
    for (const artifact of [cast, ...preparations, hostPlan]) artifact.provenance.prompt!.version = version;
    const plan = await createHostRolePlan(job, read);
    assert.equal(plan.prompt.version, "1.4.0");
  }
  hostPlan.provenance.prompt!.version = "1.99.0";
  await assert.rejects(createHostRolePlan(job, read), /host plan/i);
  assert.equal(job.state.usageLedger!.records.length, 0);
});
