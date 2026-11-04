import test from "node:test";
import assert from "node:assert/strict";
import { createRouteHarness, routeEnv } from "./fixtures/route-harness.ts";
import { backgroundSchedulerActive, runEpisodeScheduler } from "../lib/episode-v2/scheduler.ts";
import { createTextPilot } from "../lib/episode-v2/app-controls.ts";

test("server scheduling advances a saved job without a browser and leaves error holds untouched", async () => {
  const h = createRouteHarness(); let clock = 1000, calls = 0;
  const job = createTextPilot({ id: "background", userId: "route-owner", topic: "An offline server test", now: 0, spendCeilingUsd: 5 });
  const held = structuredClone(job); held.id = "held"; held.userId = "held-owner"; held.status = "paused";
  held.pause = { code: "needs_input", reason: "Authored error hold." };
  for (const saved of [job, held]) h.sqlite.prepare("INSERT INTO episodes (id, user_id, status, job_json, created_at, updated_at) VALUES (?, ?, ?, ?, 0, 0)")
    .run(saved.id, saved.userId, saved.status, JSON.stringify(saved));
  try {
    assert.equal(await backgroundSchedulerActive(h.DB as any, clock), false);
    const result = await runEpisodeScheduler(routeEnv as Cloudflare.Env, { now: () => clock, wait: async ms => { clock += ms; }, maxRunMs: 10_000,
      advance: async (id, userId) => {
        assert.equal(id, job.id); assert.equal(userId, job.userId); calls++;
        // A second invocation cannot take the scheduler's active lease.
        assert.equal((await runEpisodeScheduler(routeEnv as Cloudflare.Env, { now: () => clock })).claimed, false);
        if (calls === 2) { job.status = "paused"; job.pause = { code: "text_checkpoint", reason: "Authored completion." }; h.update(job); }
        return { job, disposition: "saved" };
      } });
    assert.deepEqual(result, { claimed: true, operations: 2 });
    assert.equal(h.job("held").pause.code, "needs_input");
    assert.equal(await backgroundSchedulerActive(h.DB as any, clock), true);
    assert.equal(await backgroundSchedulerActive(h.DB as any, clock + 120_000), false);
    assert.equal(await backgroundSchedulerActive(h.DB as any, 0), false);
  } finally { h.close(); }
});

test("expired scheduler leases recover; missing configuration and active leases do no work", async () => {
  const h = createRouteHarness();
  try {
    assert.equal((await runEpisodeScheduler({ DB: h.DB } as any)).claimed, false);
    h.sqlite.prepare("INSERT INTO episode_scheduler_health (id, last_tick, lease_token, lease_until) VALUES (1, 0, 'old', 2000)").run();
    assert.equal((await runEpisodeScheduler(routeEnv as Cloudflare.Env, { now: () => 1000 })).claimed, false);
    assert.equal((await runEpisodeScheduler(routeEnv as Cloudflare.Env, { now: () => 2001 })).claimed, true);
  } finally { h.close(); }
});
