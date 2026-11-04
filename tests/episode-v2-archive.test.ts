import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, routeEnv, routeRequest as request, routeContext as context } from './fixtures/route-harness.ts';
import './fixtures/route-loader.mjs';
import { createTextPilot } from '../lib/episode-v2/app-controls.ts';
import { advanceEpisode } from '../lib/episode-v2/advance-episode.ts';
const archive = await import('../app/api/episodes/[id]/archive/route.ts');
const episodes = await import('../app/api/episodes/route.ts');
const controls = await import('../app/api/episodes/[id]/control/route.ts');
function insert(h: ReturnType<typeof createRouteHarness>, id = 'archive-test', owner = 'route-owner') {
  const job = createTextPilot({ id, userId: owner, topic: 'A saved conversation', now: 0, spendCeilingUsd: 5 });
  h.sqlite.prepare('INSERT INTO episodes (id, user_id, active_user_id, status, job_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)').run(id, owner, owner, job.status, JSON.stringify(job));
  return job;
}
test('archive stops and frees the slot; restore preserves research and never resumes generation', async () => {
  const h = createRouteHarness(), originalFetch = globalThis.fetch; let paid = 0;
  globalThis.fetch = async () => { paid++; throw new Error('No provider work allowed'); };
  try {
    const job = insert(h);
    const result = await archive.POST(request('/api/episodes/archive-test/archive', { body: { action: 'archive' } }), context(job.id));
    assert.equal(result.status, 200); assert.ok((await result.json() as any).archivedAt);
    assert.equal(h.active(), undefined); assert.equal(h.job(job.id).pause.code, 'cancelled');
    assert.deepEqual(h.job(job.id).state, job.state);
    assert.equal(h.job(job.id).archiveContext.status, job.status);
    assert.equal(h.job(job.id).archiveContext.stage, job.stage);
    const list = await (await episodes.GET(request())).json() as any;
    assert.equal(list.episodes.length, 0); assert.equal(list.archivedEpisodes[0].id, job.id);
    assert.equal((await controls.POST(request('/control', { body: { action: 'resume' } }), context(job.id))).status, 409);
    assert.equal((await advanceEpisode(job.id, job.userId, routeEnv as Cloudflare.Env)).disposition, 'waiting');
    assert.equal((await archive.POST(request('/archive', { body: { action: 'restore' } }), context(job.id))).status, 200);
    assert.equal(h.job(job.id).archivedAt, undefined); assert.equal(h.job(job.id).pause.code, 'cancelled'); assert.equal(h.active(), undefined);
    assert.equal((await (await episodes.GET(request())).json() as any).episodes[0].id, job.id);
    assert.equal(paid, 0);
  } finally { globalThis.fetch = originalFetch; h.close(); }
});

test('archiving a paused episode preserves its original diagnostic reason', async () => {
  const h = createRouteHarness();
  try {
    const job = insert(h); job.status = 'paused';
    job.pause = { code: 'needs_input', reason: 'Input allowance exceeded before any provider request.' };
    h.sqlite.prepare('UPDATE episodes SET status = ?, job_json = ? WHERE id = ?').run(job.status, JSON.stringify(job), job.id);
    assert.equal((await archive.POST(request('/archive', { body: { action: 'archive' } }), context(job.id))).status, 200);
    assert.deepEqual(h.job(job.id).archiveContext.pause, job.pause);
    assert.equal((await archive.POST(request('/archive', { body: { action: 'restore' } }), context(job.id))).status, 200);
    assert.deepEqual(h.job(job.id).archiveContext.pause, job.pause);
  } finally { h.close(); }
});
test('archive respects ownership, origin, and an in-flight lease', async () => {
  const h = createRouteHarness();
  try {
    const job = insert(h);
    assert.equal((await archive.POST(request('/archive', { user: null, body: { action: 'archive' } }), context(job.id))).status, 401);
    assert.equal((await archive.POST(request('/archive', { user: 'other', body: { action: 'archive' } }), context(job.id))).status, 404);
    assert.equal((await archive.POST(request('/archive', { origin: 'https://elsewhere.test', body: { action: 'archive' } }), context(job.id))).status, 403);
    h.sqlite.prepare("UPDATE episodes SET lock_token = 'busy', lock_until = ? WHERE id = ?").run(Date.now() + 10000, job.id);
    assert.equal((await archive.POST(request('/archive', { body: { action: 'archive' } }), context(job.id))).status, 409);
    assert.deepEqual(h.job(job.id), job); assert.ok(h.active());
  } finally { h.close(); }
});
test('archiving completed audio keeps the audio and permits restoring it', async () => {
  const h = createRouteHarness();
  try {
    const job = { id: 'finished', userId: 'route-owner', topic: 'Saved episode', lengthMinutes: 5, status: 'ready', stage: 'ready', state: { artifacts: {}, sources: [] }, audioKey: 'owned-audio.mp3', createdAt: 0, updatedAt: 0 };
    h.sqlite.prepare('INSERT INTO episodes (id,user_id,status,job_json,created_at,updated_at) VALUES (?,?,?,?,0,0)').run(job.id,job.userId,job.status,JSON.stringify(job));
    for (const action of ['archive','restore']) {
      assert.equal((await archive.POST(request('/archive', { body: { action } }), context(job.id))).status, 200);
      assert.equal(h.job(job.id).status, 'ready'); assert.equal(h.job(job.id).audioKey, 'owned-audio.mp3');
    }
  } finally { h.close(); }
});
