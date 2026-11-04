import test from "node:test";
import assert from "node:assert/strict";
import { createRouteHarness } from "./fixtures/route-harness.ts";
import { createTextPilot } from "../lib/episode-v2/app-controls.ts";
import { RETIRED_ATTEMPT_IDS } from "../lib/episode-v2/library-history.ts";
import { retirePreviousAttempts } from "../lib/episode-v2/retire-attempts.ts";

test("retirement frees the owner's slot, preserves saved work, and leaves other episodes alone", async () => {
  const h = createRouteHarness();
  try {
    const original = createTextPilot({ id: RETIRED_ATTEMPT_IDS[0], userId: "route-owner", topic: "Saved research", now: 0, spendCeilingUsd: 5 });
    original.status = "paused"; original.pause = { code: "needs_input", reason: "Saved hold" };
    const other = { ...structuredClone(original), id: "new-episode", userId: "another-owner" };
    for (const job of [original, other]) h.sqlite.prepare("INSERT INTO episodes (id, user_id, active_user_id, status, job_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)")
      .run(job.id, job.userId, job.userId, job.status, JSON.stringify(job));
    await retirePreviousAttempts(h.DB, "wrong-owner");
    assert.ok(h.active());
    await retirePreviousAttempts(h.DB, "route-owner");
    assert.equal(h.active(), undefined);
    const retired = h.job(original.id);
    assert.equal(retired.pause.code, "cancelled");
    assert.deepEqual(retired.state.artifacts, original.state.artifacts);
    assert.deepEqual(retired.state.usageLedger, original.state.usageLedger);
    assert.deepEqual(h.job(other.id), other);
    await retirePreviousAttempts(h.DB, "route-owner");
    assert.deepEqual(h.job(original.id), retired);
  } finally { h.close(); }
});
