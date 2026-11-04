import test from "node:test";
import assert from "node:assert/strict";
import { createTextPilot, textPilotActions } from "../lib/episode-v2/app-controls.ts";
import { quoteOperation } from "../lib/episode-v2/providers.ts";
import { savedStepFailureMessage } from "../lib/episode-v2/pause-message.ts";

function fixture() {
  const job = createTextPilot({ id: "pause-test", userId: "owner", topic: "A topic", lengthMinutes: 15, spendCeilingUsd: 5, now: 0 });
  job.status = "paused"; job.stage = "research"; job.substep = "read";
  job.pause = { code: "needs_input", reason: "private internal reason" };
  const record = quoteOperation({ id: "attempt-1", role: "source", kind: "source" }, job.state.modelPolicy!.roles.source!, new Date(0).toISOString());
  record.outcome = "invalid_output";
  record.error = { code: "source_not_opened", category: "output", message: "private provider body", ambiguous: false };
  job.state.usageLedger!.records.push(record);
  job.state.execution = { revision: 1, steps: { read: { id: "attempt-1", key: "read", step: { stage: "research", substep: "read" },
    inputHash: "a".repeat(64), inputs: [], prompt: { id: "source-reader", version: "1.0.0" }, phase: "failed",
    usageRecordId: record.id, resultRefs: [], createdAt: 0, updatedAt: 1, reason: "private step reason" } } };
  return { job, record };
}

test("failed source messages explain the cause without leaking raw provider data or enabling retry", () => {
  const { job, record } = fixture(), before = JSON.stringify(job);
  assert.match(savedStepFailureMessage(job)!, /did not confirm opening/);
  assert.equal(savedStepFailureMessage(job)!.includes("private"), false);
  assert.equal(textPilotActions(job).resume, false);
  assert.equal(JSON.stringify(job), before);
  record.error!.code = "invalid_output";
  assert.match(savedStepFailureMessage(job)!, /required data format/);
  record.error!.code = "unknown-private-code"; record.error!.category = "billing";
  assert.match(savedStepFailureMessage(job)!, /credit or spending-limit/);
  assert.equal(savedStepFailureMessage(job)!.includes("unknown-private-code"), false);
  record.error = null; record.outcome = "completed";
  assert.match(savedStepFailureMessage(job)!, /could not validate or save/);
});

test("other pauses and unrelated failed steps keep the existing explanation", () => {
  const { job } = fixture();
  job.pause!.code = "budget"; assert.equal(savedStepFailureMessage(job), null);
  job.pause!.code = "needs_input"; job.substep = "synthesize";
  assert.equal(savedStepFailureMessage(job), null);
  job.substep = "read"; job.status = "running";
  assert.equal(savedStepFailureMessage(job), null);
});
