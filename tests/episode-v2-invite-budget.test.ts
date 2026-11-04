import test from "node:test";
import assert from "node:assert/strict";
import { createTextPilot } from "../lib/episode-v2/app-controls.ts";
import { assertInviteReservation, remainingInviteAllowance, reserveInviteAllowance, settleInviteAllowance, releaseUncreatedReservation } from "../lib/episode-v2/invite-budget.ts";
import { quoteOperation } from "../lib/episode-v2/providers.ts";
import { createRouteHarness } from "./fixtures/route-harness.ts";

const owner = "route-owner";
const make = (id: string, userId = "invitee", spendCeilingUsd = 3) => createTextPilot({ id, userId, topic: "An authored budget test", lengthMinutes: 15, spendCeilingUsd, now: 0 });
function insert(h: ReturnType<typeof createRouteHarness>, job: ReturnType<typeof make>) {
  h.sqlite.prepare("INSERT INTO episodes (id, user_id, status, job_json, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)")
    .run(job.id, job.userId, job.status, JSON.stringify(job));
}

test("atomic reservations enforce five dollars across episodes and keep visitors separate", async () => {
  const h = createRouteHarness();
  try {
    const results = await Promise.allSettled([reserveInviteAllowance(h.DB, make("one"), owner), reserveInviteAllowance(h.DB, make("two"), owner)]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(await remainingInviteAllowance(h.DB, "invitee", owner), 2);
    assert.equal(await remainingInviteAllowance(h.DB, "another", owner), 5);
    await reserveInviteAllowance(h.DB, make("other", "another", 5), owner);
    assert.equal(await remainingInviteAllowance(h.DB, "another", owner), 0);
    assert.equal(await remainingInviteAllowance(h.DB, owner, owner), null);
    await reserveInviteAllowance(h.DB, make("owner-one", owner, 5), owner);
    await reserveInviteAllowance(h.DB, make("owner-two", owner, 5), owner);
    assert.equal(h.sqlite.prepare("SELECT COUNT(*) AS n FROM episode_allowance_holds WHERE user_id = ?").get(owner)!.n, 0);
    await assert.rejects(reserveInviteAllowance(h.DB, make("unconfigured")), /owner/i);
    await assert.rejects(assertInviteReservation(h.DB, make("not-reserved"), owner), /allowance/i);
  } finally { h.close(); }
});

test("a final stop returns unused allowance while uncertain paid work stays reserved", async () => {
  const h = createRouteHarness(), job = make("held", "invitee", 5);
  try {
    await reserveInviteAllowance(h.DB, job, owner); insert(h, job);
    const record = quoteOperation({ id: "unknown-work", role: "source", kind: "source" }, job.state.modelPolicy!.roles.source!, new Date(0).toISOString());
    record.outcome = "uncertain";
    job.state.usageLedger!.records.push(record);
    job.status = "paused"; job.pause = { code: "cancelled", reason: "An authored stop." }; h.update(job);
    await settleInviteAllowance(h.DB, job, owner);
    const held = h.sqlite.prepare("SELECT amount_microusd AS n FROM episode_allowance_holds WHERE episode_id = ?").get(job.id)!.n as number;
    assert.equal(held, Math.ceil(record.allowanceUsd * 1_000_000));
    assert.ok(held > 0 && held < 5_000_000);
    await reserveInviteAllowance(h.DB, make("next", "invitee", 4), owner);
    await assert.rejects(reserveInviteAllowance(h.DB, make("too-much", "invitee", 1), owner), /allowance/i);
    // A stale copy may never refund a currently running or changed episode.
    const current = structuredClone(job); current.status = "running"; delete current.pause; h.update(current);
    job.state.usageLedger!.records = [];
    await settleInviteAllowance(h.DB, job, owner);
    assert.equal(h.sqlite.prepare("SELECT amount_microusd AS n FROM episode_allowance_holds WHERE episode_id = ?").get(job.id)!.n, held);
  } finally { h.close(); }
});

test("reservation cleanup cannot refund an episode whose INSERT committed", async () => {
  const h = createRouteHarness(), job = make("committed", "invitee", 5);
  try {
    await reserveInviteAllowance(h.DB, job, owner); insert(h, job);
    await releaseUncreatedReservation(h.DB, job.id, job.userId);
    assert.equal(await remainingInviteAllowance(h.DB, job.userId, owner), 0);
    await reserveInviteAllowance(h.DB, make("orphan", "other", 5), owner);
    await releaseUncreatedReservation(h.DB, "orphan", "other");
    assert.equal(await remainingInviteAllowance(h.DB, "other", owner), 5);
  } finally { h.close(); }
});
