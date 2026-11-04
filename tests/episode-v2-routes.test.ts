import test from 'node:test';
import assert from 'node:assert/strict';
import { createRouteHarness, routeEnv, routeRequest as request, routeContext as context } from './fixtures/route-harness.ts';
import './fixtures/route-loader.mjs';
import { producerFixtures } from './fixtures/producer.ts';
import { discoveryFixture, readingFixture, researchUrls } from './fixtures/research.ts';
import { evidenceOutputFixture } from './fixtures/evidence.ts';
import { castingFixture } from './fixtures/casting.ts';
import { guestPreparationFixtures, hostPreparationFixture } from './fixtures/preparation.ts';
import { hostAction, guestContribution } from './fixtures/conversation.ts';
import { lightEdit, acceptableReview, postProductionSpeech } from './fixtures/post-production.ts';
import { ARCHIVED_PILOT_EPISODE_IDS } from '../lib/episode-v2/library-history.ts';
import { quoteOperation } from '../lib/episode-v2/providers.ts';
import { positionedPreparation, discussionHost, parallelInteraction } from './fixtures/discussion-design.ts';
import type { GuestSpeaker } from '../lib/episode-v2/contracts.ts';

const episodes = await import('../app/api/episodes/route.ts');
const episode = await import('../app/api/episodes/[id]/route.ts');
const advance = await import('../app/api/episodes/[id]/advance/route.ts');
const controls = await import('../app/api/episodes/[id]/control/route.ts');
const capabilities = await import('../app/api/capabilities/route.ts');
const audio = await import('../app/api/episodes/[id]/audio/route.ts');
const research = await import('../app/api/episodes/[id]/research/route.ts');
const pilotBody = { topic: 'Why do fireflies flash together?', lengthMinutes: 5, pipelineVersion: 2, textOnly: true, spendCeilingUsd: 5 };

test('invitees share one lifetime allowance across episodes; controls and ownership cannot bypass it', async () => {
  const h = createRouteHarness(), original = globalThis.fetch; let paidCalls = 0;
  globalThis.fetch = async () => { paidCalls++; throw new Error('No paid work requested'); };
  const createFor = (user: string) => episodes.POST(request('/api/episodes', { user, body: pilotBody }));
  try {
    const first = await createFor('invitee'); assert.equal(first.status, 201);
    const id = (await first.json() as any).id, job = h.job(id);
    assert.equal(h.sqlite.prepare('SELECT amount_microusd AS n FROM episode_allowance_holds WHERE episode_id = ?').get(id)!.n, 5_000_000);
    assert.equal((await episode.GET(request(`/api/episodes/${id}`, { user: 'other' }), context(id))).status, 404);
    const record = quoteOperation({ id: 'saved-cost', role: 'producer', kind: 'structured' }, job.state.modelPolicy.roles.producer, new Date(0).toISOString());
    record.outcome = 'completed'; record.allowanceUsd = 2; record.estimatedUsd = 2;
    job.state.usageLedger.records.push(record); h.update(job);
    const cancelled = await controls.POST(request(`/api/episodes/${id}/control`, { user: 'invitee', body: { action: 'cancel' } }), context(id));
    assert.equal(cancelled.status, 200);
    const next = await createFor('invitee'); assert.equal(next.status, 201);
    const nextId = (await next.json() as any).id;
    assert.equal(h.job(nextId).config.limits.spendCeilingUsd, 3);
    // Removing the active-slot blocker still cannot create another authorization.
    h.sqlite.prepare('UPDATE episodes SET active_user_id = NULL WHERE id = ?').run(nextId);
    assert.equal((await createFor('invitee')).status, 409);
    assert.equal((await createFor('other')).status, 201);
    assert.equal((await createFor('route-owner')).status, 201);
    assert.equal(paidCalls, 0);
  } finally { globalThis.fetch = original; h.close(); }
});
async function create(body: unknown = pilotBody) { return episodes.POST(request('/api/episodes', { body })); }
async function control(id: string, action: string, extra = {}) { return controls.POST(request(`/api/episodes/${id}/control`, { body: { action, ...extra } }), context(id)); }
async function tick(id: string, user = 'route-owner') { return advance.POST(request(`/api/episodes/${id}/advance`, { method: 'POST', user }), context(id)); }
function completed(body: any, value: unknown, output: unknown[] = [], id = 'resp_route_complete') {
  return new Response(JSON.stringify({ id, status: 'completed', model: body.model, service_tier: 'default', output, output_text: JSON.stringify(value),
    usage: { input_tokens: 1200, output_tokens: 350, total_tokens: 1550, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 100 } } }));
}
function pipelineFetch() {
  const calls: { method: string; schema?: string; url: string }[] = []; let hosts = 0;
  const fetchMock: typeof fetch = async (url, init) => {
    assert.match(String(url), /^https:\/\/api\.openai\.com\/v1\/responses/);
    assert.equal(init?.method, 'POST');
    const body = JSON.parse(String(init.body)), schema = body.text.format.name;
    const input = JSON.parse(body.input.split('\n\nOpen and read this source URL:')[0]);
    calls.push({ method: 'POST', schema, url: String(url) });
    let value: any, output: any[] = [];
    switch (schema) {
      case 'still_curious_producer_v1': value = producerFixtures[1].output; break;
      case 'still_curious_source_discovery_v1': value = discoveryFixture; output = [{ type: 'web_search_call', status: 'completed', action: { type: 'search', sources: researchUrls.map(url => ({ url, title: 'Authored offline source' })) } }]; break;
      case 'still_curious_source_reading_v1': {
        const index = researchUrls.indexOf(input.selectedSource.url); assert.ok(index >= 0);
        value = readingFixture(index, index === 3); output = [{ type: 'web_search_call', status: index === 3 ? 'failed' : 'completed', action: { type: 'open_page', url: input.selectedSource.url } }]; break;
      }
      case 'still_curious_evidence_v1':
      case 'still_curious_evidence_v17': {
        const refs = input.sourceRecords.data.sources.slice(0, 3).map((source: any) => ({ sourceId: source.id, passageId: source.passages.find((p: any) => p.coverage === 'body').id }));
        value = structuredClone(evidenceOutputFixture); value.claims = [{ ...value.claims[0], passages: [refs[0]] }];
        value.specialistExtracts.forEach((extract: any) => { extract.claimIds = ['c1']; });
        value.interpretations[0].passages = [refs[0]]; value.stories[0].passages = [refs[0], refs[2]];
        if (schema.endsWith('v17')) value.foundationCoverage = input.episodeBrief.data.essentialFoundations.map((_foundation: string, foundationIndex: number) => ({ foundationIndex, claimIds: ['c1'], gap: null }));
        break;
      }
      case 'still_curious_casting_v1':
        value = body.text.format.schema.properties.guests.items.properties.temperament ? castingFixture
          : { ...castingFixture, guests: castingFixture.guests.map(({ temperament: _t, confidenceStyle: _c, humour: _h, ...guest }) => guest) };
        break;
      case 'still_curious_guest_preparation_v1': value = guestPreparationFixtures[input.ownProfile.speaker as keyof typeof guestPreparationFixtures]; break;
      case 'still_curious_guest_preparation_v17': value = positionedPreparation(input.ownProfile.speaker as GuestSpeaker); break;
      case 'still_curious_host_preparation_v1': value = hostPreparationFixture; break;
      case 'still_curious_host_preparation_v17': value = discussionHost(); break;
      case 'still_curious_host_action_v1': value = hosts++ === 0 ? hostAction({ text: postProductionSpeech.opening }) : hostAction({ action: 'close', nextSpeaker: null, text: postProductionSpeech.ending }); break;
      case 'still_curious_guest_contribution_v1': value = guestContribution(postProductionSpeech.qualified); break;
      case 'still_curious_light_editing_v1': value = lightEdit(); break;
      case 'still_curious_episode_review_v1': value = acceptableReview(); break;
      case 'still_curious_episode_review_v17': value = { ...acceptableReview(), interactionReview: parallelInteraction() }; break;
      default: throw new Error(`Unexpected fixture operation ${schema}`);
    }
    return completed(body, value, output, `resp_route_${calls.length}`);
  };
  return { calls, fetchMock };
}

test('capability requires explicit rollout, authentication and all text bindings; new episodes use the capped workflow', async () => {
  const h = createRouteHarness();
  try {
    assert.equal((await (await capabilities.GET(request('/api/capabilities'))).json().then(value => value as any)).text_pilot, true);
    assert.equal((await (await capabilities.GET(request('/api/capabilities', { user: null }))).json().then(value => value as any)).text_pilot, false);
    for (const key of ['V2_TEXT_PILOT_ENABLED', 'DB', 'BUCKET', 'OPENAI_API_KEY']) {
      const previous = routeEnv[key]; delete routeEnv[key];
      assert.equal((await (await capabilities.GET(request('/api/capabilities'))).json().then(value => value as any)).text_pilot, false, key);
      assert.equal((await create()).status, 503, `V2 creation must fail without ${key}`);
      routeEnv[key] = previous;
    }
    assert.equal((await create({ topic: 'Legacy topic', lengthMinutes: 5 })).status, 400);
    const response = await create(); assert.equal(response.status, 201); const saved = h.job((await response.json() as any).id);
    assert.equal(saved.pipelineVersion, 2); assert.equal(saved.config.limits.spendCeilingUsd, 5);
    assert.equal((await create()).status, 409);
  } finally { h.close(); }
});

test('explicit V2 creation records budget allocation and null budget makes no provider calls', async () => {
  const h = createRouteHarness(), original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('No provider should be called'); };
  try {
    const response = await create({ ...pilotBody, spendCeilingUsd: null }); assert.equal(response.status, 201);
    const id = (await response.json().then(value => value as any)).id, saved = h.job(id);
    assert.equal(saved.status, 'paused'); assert.equal(saved.pause.code, 'budget'); assert.equal(saved.textOnly, true);
    assert.equal((await tick(id)).status, 200); assert.equal(calls, 0); assert.ok(h.active());
    assert.equal((await control(id, 'set_budget', { spendCeilingUsd: 5 })).status, 200);
    assert.deepEqual(h.job(id).state.usageLedger.allocations, { research: 1.75, text: 2.25, review: 1, audio: 0 });
    assert.equal(h.job(id).status, 'running'); assert.equal(calls, 0);
  } finally { globalThis.fetch = original; h.close(); }
});

test('real creation and advance routes reach a stable text checkpoint and export reviewed speech privately', async () => {
  const h = createRouteHarness(), original = globalThis.fetch, fixture = pipelineFetch(); globalThis.fetch = fixture.fetchMock;
  try {
    const created = await create(); assert.equal(created.status, 201); const id = (await created.json().then(value => value as any)).id;
    let visible: any;
    for (let i = 0; i < 32; i++) {
      const response = await tick(id); assert.equal(response.status, 200); visible = await response.json().then(value => value as any);
      if (visible.status === 'paused') break;
    }
    assert.equal(visible.pause?.code, 'text_checkpoint', JSON.stringify(visible)); assert.equal(visible.textReady, true);
    const savedCast = h.job(id).state.artifacts['cast:1'];
    assert.equal(savedCast.data.personality.generator_version, '1.7.0-coherent.1');
    assert.equal(h.job(id).state.artifacts['guest-preparation:expert1:1'].data.position.priority, 'Explain individual response');
    assert.ok(h.job(id).state.artifacts['host-plan:1'].data.discussionPoints.length);
    assert.equal(h.job(id).state.artifacts['review:1'].data.interactionReview.assessment, 'parallel');
    assert.equal(new Set(savedCast.data.personality.cast.map((guest: any) => guest.prompt)).size, 3);
    assert.equal(visible.audio_url, undefined); assert.equal(visible.state, undefined); assert.equal(visible.userId, undefined);
    const callCount = fixture.calls.length; assert.ok(callCount >= 17);
    assert.equal((await tick(id)).status, 200); assert.equal(fixture.calls.length, callCount);
    const refreshed = await (await episode.GET(request(`/api/episodes/${id}`), context(id))).json().then(value => value as any); assert.equal(refreshed.textReady, true);
    const listed = await (await episodes.GET(request())).json().then(value => value as any); assert.equal(listed.episodes[0].textReady, true);
    assert.equal(h.active(), undefined, 'checkpoint releases the active episode slot');
    const transcript = await import('../app/api/episodes/[id]/transcript/route.ts');
    const exported = await transcript.GET(request(`/api/episodes/${id}/transcript`), context(id)); assert.equal(exported.status, 200);
    const exportedText = await exported.text(); assert.ok(exportedText.includes(postProductionSpeech.qualified)); assert.ok(exportedText.includes(postProductionSpeech.ending));
    assert.ok(!exportedText.includes('possibleOveremphasis')); assert.ok(!exportedText.includes('usageRecordIds'));
    assert.ok(!exportedText.includes('host_cast_brief')); assert.ok(!exportedText.includes('language_richness'));
    const sources = await research.GET(request(`/api/episodes/${id}/research`), context(id)); assert.equal(sources.status, 200);
    const sourceText = await sources.text(); assert.ok(sourceText.includes(researchUrls[0])); assert.ok(!sourceText.includes('guest_preparation'));
    for (const handler of [episode.GET, transcript.GET, research.GET, audio.GET]) {
      const response = await handler(request(`/api/episodes/${id}`, { user: 'someone-else' }), context(id)); assert.equal(response.status, 404);
    }
    assert.equal((await tick(id, 'someone-else')).status, 404);
    assert.equal((await controls.POST(request(`/api/episodes/${id}/control`, { body: { action: 'cancel' }, user: 'someone-else' }), context(id))).status, 404);
    assert.equal(fixture.calls.length, callCount);
  } finally { globalThis.fetch = original; h.close(); }
});

test('pause/resume/cancel are local durable controls and cancellation releases the active slot', async () => {
  const h = createRouteHarness(), original = globalThis.fetch; let calls = 0; globalThis.fetch = async () => { calls++; throw new Error('No fetch expected'); };
  try {
    const id = (await (await create()).json().then(value => value as any)).id;
    assert.equal((await control(id, 'pause')).status, 200); const paused = h.job(id); assert.equal(paused.pause.code, 'user_paused'); assert.ok(h.active());
    assert.equal((await create()).status, 409);
    assert.equal((await control(id, 'resume')).status, 200); assert.deepEqual(h.job(id).state.usageLedger, paused.state.usageLedger);
    assert.equal((await control(id, 'cancel')).status, 200); assert.equal(h.job(id).pause.code, 'cancelled'); assert.equal(h.active(), undefined);
    assert.equal((await control(id, 'resume')).status, 409); assert.equal(calls, 0);
    assert.equal((await create()).status, 201);
  } finally { globalThis.fetch = original; h.close(); }
});

test('mutations reject cross-origin requests and invalid explicit V2 inputs before persistence', async () => {
  const h = createRouteHarness();
  try {
    assert.equal((await episodes.POST(request('/api/episodes', { body: pilotBody, origin: 'https://elsewhere.test' }))).status, 403);
    for (const patch of [{ textOnly: 'false' }, { spendCeilingUsd: -1 }, { spendCeilingUsd: 1.001 }, { pipelineVersion: 3 }]) assert.equal((await create({ ...pilotBody, ...patch })).status, 400);
    const id = (await (await create()).json().then(value => value as any)).id;
    for (const handler of [advance.POST, controls.POST]) assert.equal((await handler(request(`/api/episodes/${id}`, { method: 'POST', body: { action: 'cancel' }, origin: 'https://elsewhere.test' }), context(id))).status, 403);
    assert.equal(h.job(id).status, 'running');
  } finally { h.close(); }
});

test('legacy stored jobs still list and serve owner-only audio including byte ranges', async () => {
  const h = createRouteHarness();
  try {
    const id = 'legacy-audio';
    const job = { id, userId: 'route-owner', topic: 'Legacy audio', lengthMinutes: 5, status: 'ready', stage: 'ready', audioKey: 'legacy.mp3', state: { artifacts: {}, sources: [] }, createdAt: 1, updatedAt: 1 };
    h.sqlite.prepare('INSERT INTO episodes VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, ?)').run(id, job.userId, job.status, JSON.stringify(job), 1, 1);
    await h.BUCKET.put('legacy.mp3', new TextEncoder().encode('0123456789'), { httpMetadata: { contentType: 'audio/mpeg' } });
    assert.equal((await (await episodes.GET(request())).json().then(value => value as any)).episodes[0].audio_url, `/api/episodes/${id}/audio`);
    const full = await audio.GET(request(`/api/episodes/${id}/audio`), context(id)); assert.equal(full.status, 200); assert.equal(await full.text(), '0123456789');
    const partial = await audio.GET(request(`/api/episodes/${id}/audio`, { headers: { range: 'bytes=2-5' } }), context(id)); assert.equal(partial.status, 206); assert.equal(await partial.text(), '2345'); assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
    assert.equal((await audio.GET(request(`/api/episodes/${id}/audio`, { user: 'someone-else' }), context(id))).status, 404);
  } finally { h.close(); }
});

test('the requested history reset archives only the retired pilots and preserves owned records and new episodes', async () => {
  const h = createRouteHarness();
  try {
    for (const id of [...ARCHIVED_PILOT_EPISODE_IDS, 'another-users-episode']) {
      const job = { id, userId: id === 'another-users-episode' ? 'another-user' : 'route-owner', topic: 'Saved pilot', lengthMinutes: 5,
        status: 'ready', stage: 'ready', state: { artifacts: {}, sources: [] }, createdAt: 1, updatedAt: 1 };
      h.sqlite.prepare('INSERT INTO episodes VALUES (?, ?, NULL, ?, ?, NULL, NULL, ?, ?)').run(id, job.userId, job.status, JSON.stringify(job), 1, 1);
    }
    assert.deepEqual((await (await episodes.GET(request())).json() as any).episodes, []);
    assert.equal((await episodes.GET(request('/api/episodes', { user: null }))).status, 401);
    const created = await create(); assert.equal(created.status, 201);
    const id = (await created.json() as any).id;
    assert.deepEqual((await (await episodes.GET(request())).json() as any).episodes.map((job: any) => job.id), [id]);
    assert.deepEqual((await (await episodes.GET(request('/api/episodes', { user: 'another-user' }))).json() as any).episodes.map((job: any) => job.id), ['another-users-episode']);
    const archived = ARCHIVED_PILOT_EPISODE_IDS[0];
    assert.equal((await episode.GET(request(`/api/episodes/${archived}`), context(archived))).status, 200);
    assert.equal((await episode.GET(request(`/api/episodes/${archived}`, { user: 'another-user' }), context(archived))).status, 404);
    assert.equal((h.sqlite.prepare('SELECT COUNT(*) AS count FROM episodes').get() as any).count, ARCHIVED_PILOT_EPISODE_IDS.length + 2);
  } finally { h.close(); }
});

test('a saved queued provider response resumes by GET of its known ID without another POST or reservation', async () => {
  const h = createRouteHarness(), original = globalThis.fetch; const methods: string[] = []; let submitted: any;
  globalThis.fetch = async (url, init) => {
    const method = init?.method ?? 'GET'; methods.push(method);
    if (method === 'POST') {
      submitted = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ id: 'resp_route_pending', status: 'queued', model: submitted.model, output: [] }));
    }
    assert.equal(new URL(String(url)).pathname, '/v1/responses/resp_route_pending');
    return completed(submitted, producerFixtures[1].output, [], 'resp_route_pending');
  };
  try {
    const id = (await (await create()).json().then(value => value as any)).id;
    assert.equal((await tick(id)).status, 200); const pending = h.job(id);
    assert.equal(pending.state.usageLedger.records[0].responseId, 'resp_route_pending');
    assert.equal((await control(id, 'pause')).status, 200); assert.equal((await control(id, 'resume')).status, 200);
    const resumed = h.job(id); Object.values(resumed.state.execution.steps).forEach((step: any) => { step.nextPollAt = 0; }); h.update(resumed);
    assert.equal((await tick(id)).status, 200);
    assert.deepEqual(methods, ['POST', 'GET']); assert.equal(h.job(id).state.usageLedger.records.length, 1);
    assert.equal(h.job(id).stage, 'research', JSON.stringify(h.job(id).pause ?? h.job(id).state.usageLedger.records));
  } finally { globalThis.fetch = original; h.close(); }
});

test('an unknown provider result holds its reservation and cannot be resumed or replaced with a budget change', async () => {
  const h = createRouteHarness(), original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('Network interruption after possible submission'); };
  try {
    const id = (await (await create()).json().then(value => value as any)).id;
    assert.equal((await tick(id)).status, 200); const saved = h.job(id);
    assert.equal(saved.pause.code, 'ambiguous_provider_result'); assert.equal(saved.state.usageLedger.records[0].outcome, 'uncertain');
    assert.ok(h.active());
    const response = await episode.GET(request(`/api/episodes/${id}`), context(id));
    const visible = await response.json().then(value => value as any); assert.equal(visible.state, undefined);
    assert.equal((await control(id, 'resume')).status, 409);
    assert.equal((await control(id, 'set_budget', { spendCeilingUsd: 200 })).status, 409);
    assert.equal((await tick(id)).status, 200); assert.equal(calls, 1);
    assert.equal((await control(id, 'cancel')).status, 200); assert.equal(h.active(), undefined);
    assert.deepEqual(h.job(id).state.usageLedger.records, saved.state.usageLedger.records);
  } finally { globalThis.fetch = original; h.close(); }
});

test('future-version stored records return safe errors instead of exposing or advancing their contents', async () => {
  const h = createRouteHarness();
  try {
    const id = (await (await create()).json().then(value => value as any)).id;
    const saved = h.job(id); saved.schemaVersion = 99; saved.pipelineVersion = 99; saved.secretMarker = 'MUST_NOT_LEAK'; h.update(saved);
    for (const handler of [episode.GET, advance.POST, research.GET, audio.GET, controls.POST]) {
      const response = await handler(request(`/api/episodes/${id}`, { method: handler === advance.POST || handler === controls.POST ? 'POST' : 'GET', ...(handler === controls.POST ? { body: { action: 'resume' } } : {}) }), context(id));
      assert.ok(response.status >= 400); assert.ok(!(await response.text()).includes('MUST_NOT_LEAK'));
    }
    const listed = await episodes.GET(request()); assert.ok(listed.status >= 400); assert.ok(!(await listed.text()).includes('MUST_NOT_LEAK'));
  } finally { h.close(); }
});
