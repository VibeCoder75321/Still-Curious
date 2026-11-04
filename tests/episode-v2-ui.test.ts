import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { setImmediate as nextTurn } from 'node:timers/promises';
import test from 'node:test';
import vm from 'node:vm';

const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
const script = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const catalog = readFileSync(new URL('../public/library.js', import.meta.url), 'utf8');
type Handler = (event: { type: string; preventDefault(): void }) => unknown;
class Element {
  value = ''; textContent = ''; hidden = false; disabled = false; checked = false; open = false;
  paused = true; playbackRate = 1; defaultPlaybackRate = 1; loadCount = 0; playCount = 0; duration = NaN;
  children: Element[] = []; attributes = new Map<string, string>(); events = new Map<string, Handler[]>();
  className = ''; type = ''; controls = false; preload = ''; href = ''; target = ''; rel = ''; tagName = ''; scrollCount = 0;
  set innerHTML(_value: string) { throw new Error('Use textContent and created elements for episode data.'); }
  get src() { return this.attributes.get('src') || ''; } set src(value: string) { this.attributes.set('src', value); }
  addEventListener(type: string, fn: Handler) { this.events.set(type, [...(this.events.get(type) || []), fn]); }
  async fire(type: string) { await Promise.all((this.events.get(type) || []).map(fn => fn({ type, preventDefault() {} }))); }
  replaceChildren(...elements: Element[]) { this.children = [...elements]; } append(...elements: Element[]) { this.children.push(...elements); }
  setAttribute(key: string, value: string) { this.attributes.set(key, value); } getAttribute(key: string) { return this.attributes.get(key) ?? null; }
  removeAttribute(key: string) { this.attributes.delete(key); }
  pause() { this.paused = true; void this.fire('pause'); }
  async play() { this.paused = false; this.playCount++; await this.fire('play'); }
  load() { this.loadCount++; } scrollIntoView() { this.scrollCount++; }
}
type RequestCall = { path: string; method: string; body?: Record<string, unknown> };
type Reply = Record<string, any>;
function pilot(overrides: Reply = {}): Reply {
  return { id: 'pilot-1', topic: 'How fireflies glow', title: 'A small light in the dark', overview: 'Exploring how and why fireflies make light.', lengthMinutes: 5, pipelineVersion: 2,
    status: 'paused', stage: 'commission', textReady: false, pause: { reason: 'Paused by you.' }, actions: { pause: false, resume: false, cancel: true, start: false }, ...overrides };
}
async function flush() { for (let turn = 0; turn < 5; turn++) await nextTurn(); }
function descendants(element: Element): Element[] { return [element, ...element.children.flatMap(descendants)]; }
function buttonIn(card: Element) { const button = descendants(card).find(e => e.tagName === 'BUTTON'); assert.ok(button); return button; }
function boot(options: { episodes?: Reply[]; archivedEpisodeIds?: string[]; reply?: (call: RequestCall) => Reply | Promise<Reply>; local?: unknown[]; legacyLocal?: unknown[]; capabilities?: Reply; savedSpeed?: string } = {}) {
  const elements = new Map<string, Element>();
  for (const match of html.matchAll(/<([\w-]+)[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const element = new Element(); element.tagName = match[1].toUpperCase();
    element.hidden = /\bhidden\b/.test(match[0]); element.checked = /\bchecked\b/.test(match[0]); element.disabled = /\bdisabled\b/.test(match[0]);
    element.value = /\bvalue="([^"]*)"/.exec(match[0])?.[1] || ''; elements.set(match[2], element);
  }
  for (const match of html.matchAll(/<select[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/select>/g)) {
    const option = [...match[2].matchAll(/<option value="([^"]+)"([^>]*)>/g)];
    elements.get(match[1])!.value = (option.find(o => /selected/.test(o[2])) || option[0])[1];
  }
  const get = (id: string) => { const element = elements.get(id); assert.ok(element, `Missing actual page element ${id}`); return element; };
  const calls: RequestCall[] = [], events = new Map<string, Handler[]>(), storage = new Map<string, string>();
  if (options.local) storage.set('still-curious-jobs-v2', JSON.stringify(options.local));
  if (options.legacyLocal) storage.set('still-curious-jobs-v1', JSON.stringify(options.legacyLocal));
  if (options.savedSpeed) storage.set('still-curious-speed-v1', options.savedSpeed);
  const timers = new Map<number, () => void>(); let sequence = 0;
  const document = {
    hidden: false, getElementById: get,
    createElement: (tag: string) => Object.assign(new Element(), { tagName: tag.toUpperCase() }),
    addEventListener(type: string, fn: Handler) { events.set(type, [...(events.get(type) || []), fn]); },
  };
  const context = vm.createContext({
    document, console, URL, Number, Object,
    localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
    setTimeout(fn: () => void) { const id = ++sequence; timers.set(id, fn); return id; }, clearTimeout(id: number) { timers.delete(id); },
    async fetch(path: string, init: { method?: string; body?: string } = {}) {
      const call = { path, method: init.method || 'GET', ...(init.body ? { body: JSON.parse(init.body) } : {}) }; calls.push(call);
      let reply: Reply;
      if (path === '/api/capabilities') reply = options.capabilities || { text_pilot: true, podcast_generation: true, supported_lengths: [5, 15] };
      else if (path === '/api/episodes' && call.method === 'GET') reply = { episodes: options.episodes || [], archivedEpisodeIds: options.archivedEpisodeIds || [] };
      else { assert.ok(options.reply, `Unexpected request ${call.method} ${path}`); reply = await options.reply(call); }
      return { ok: true, status: 200, headers: { get: () => 'application/json' }, json: async () => reply };
    },
  });
  vm.runInContext(catalog, context, { filename: 'public/library.js' }); vm.runInContext(script, context, { filename: 'public/app.js' });
  return { get, calls, document, storage, timers, context,
    async ready() { await flush(); },
    async visibility(hidden: boolean) { document.hidden = hidden; await Promise.all((events.get('visibilitychange') || []).map(fn => fn({ type: 'visibilitychange', preventDefault() {} }))); await flush(); },
    async selectFree(index = 0) { await buttonIn(get('library-grid').children[index]).fire('click'); await flush(); },
    async open(index = 0) { await buttonIn(get('saved-list').children[index]).fire('click'); await flush(); },
  };
}

test('one app source contains a library, creation below it, one player and the exact requested speed choices', () => {
  assert.equal(existsSync(new URL('../public/index.html', import.meta.url)), false);
  assert.match(readFileSync(new URL('../app/route.ts', import.meta.url), 'utf8'), /client\/index\.html\?raw/);
  assert.ok(html.indexOf('id="library"') < html.indexOf('id="create"'));
  assert.ok(html.indexOf('id="create"') < html.indexOf('id="now-playing"'));
  assert.equal([...html.matchAll(/<audio\b/g)].length, 1);
  const speeds = /<select id="playback-speed">([\s\S]*?)<\/select>/.exec(html)![1];
  assert.deepEqual([...speeds.matchAll(/value="([^"]+)"/g)].map(m => Number(m[1])), [1.2, 1, 0.9, 0.8, 0.7, 0.6]);
  assert.match(html, /<summary>Reading List<\/summary>/); assert.doesNotMatch(html, /Source notes|source notes|spend-ceiling|audio-allowance|type="number"|API spending/i);
});

test('all available library recordings have distinct titles, overviews and lengths with no tile players or settings', async () => {
  const app = boot(); await app.ready();
  assert.equal(app.get('library-grid').children.length, 1); assert.equal(app.get('now-content').hidden, true);
  assert.doesNotMatch(catalog, /wayfinding|polynesian-opening/i);
  assert.equal(existsSync(new URL('../public/audio/polynesian-opening.mp3', import.meta.url)), false);
  assert.equal(app.get('now-audio').src, ''); assert.equal(app.get('now-audio').playCount, 0);
  for (const card of app.get('library-grid').children) {
    const content = descendants(card); assert.ok(content.some(e => e.className === 'episode-title' && e.textContent));
    assert.ok(content.some(e => e.className === 'episode-overview' && e.textContent)); assert.ok(content.some(e => e.className === 'episode-length' && e.textContent));
    assert.equal(content.some(e => ['AUDIO', 'SELECT'].includes(e.tagName)), false);
  }
  assert.equal(app.calls.filter(c => c.method === 'POST').length, 0);
});

test('selecting the pharmaceutical excerpt uses Now Playing and its Reading List without generation', async () => {
  const app = boot(); await app.ready(); await app.selectFree();
  assert.equal(app.get('now-episode-title').textContent, 'Making the Same Drug a Different Way');
  assert.match(app.get('now-overview').textContent, /chemistry/); assert.equal(app.get('now-audio').paused, false);
  assert.equal(app.get('now-kind').textContent, 'Opening excerpt'); assert.equal(app.get('now-length').textContent, '5 min 6 sec');
  assert.equal(app.get('now-audio').src, '/audio/pharmaceutical-opening.mp3'); assert.ok(app.get('reading-links').children.length >= 2);
  assert.match(app.get('reading-links').children[0].children[0].href, /^https:\/\/www.epa.gov/); assert.equal(app.calls.filter(c => c.method === 'POST').length, 0);
});

test('playback speed is shared and remembered while switching episodes clears the sleep timer', async () => {
  const app = boot({ savedSpeed: '0.8' }); await app.ready(); await app.selectFree(); assert.equal(app.get('now-audio').playbackRate, 0.8);
  app.get('playback-speed').value = '0.7'; await app.get('playback-speed').fire('change'); assert.equal(app.get('now-audio').playbackRate, 0.7); assert.equal(app.storage.get('still-curious-speed-v1'), '0.7');
  app.get('sleep-timer').value = '15'; await app.get('sleep-timer').fire('change'); assert.equal(app.timers.size, 1);
  await app.get('voice-preview-button').fire('click'); assert.equal(app.timers.size, 0); assert.equal(app.get('sleep-timer').value, '0'); assert.equal(app.get('now-audio').playbackRate, 0.7);
  app.get('sleep-timer').value = '30'; await app.get('sleep-timer').fire('change'); const [id, fire] = [...app.timers][0]; app.timers.delete(id); fire();
  assert.equal(app.get('now-audio').paused, true); assert.equal(app.get('sleep-timer').value, '0'); assert.match(app.get('now-status').textContent, /finished/);
});

test('timer selected while paused starts on play, and loaded metadata refreshes duration without changing speed', async () => {
  const app = boot(); await app.ready(); await app.selectFree(); app.get('now-audio').pause();
  app.get('sleep-timer').value = '15'; await app.get('sleep-timer').fire('change'); assert.equal(app.timers.size, 0); await app.get('now-audio').play(); assert.equal(app.timers.size, 1);
  app.get('playback-speed').value = '0.6'; await app.get('playback-speed').fire('change'); app.get('now-audio').duration = 301; await app.get('now-audio').fire('loadedmetadata');
  assert.equal(app.get('now-length').textContent, '5 min 1 sec'); assert.equal(app.get('now-audio').playbackRate, 0.6);
});

test('the voice preview also opens in Now Playing rather than adding another player', async () => {
  const app = boot(); await app.ready(); await app.get('voice-preview-button').fire('click');
  assert.equal(app.get('now-kind').textContent, 'Voice preview'); assert.equal(app.get('now-audio').src, '/audio/dialogue-preview.mp3'); assert.equal(app.get('now-length').textContent, '31 sec');
});

test('15-minute creation submits the topic and listening options without user-editable amounts', async () => {
  const ready = pilot({ status: 'ready', stage: 'ready', audio_url: '/api/episodes/pilot-1/audio', durationSeconds: 900, actions: {} }); let reads = 0;
  const app = boot({ reply(call) { if (call.path === '/api/episodes' && call.method === 'POST') return pilot({ status: 'running' }); if (call.path.endsWith('/advance')) return { ok: true }; return reads++ === 0 ? pilot({ status: 'running', stage: 'tts' }) : ready; } }); await app.ready();
  app.get('length-15').checked = true; app.get('length-5').checked = false; await app.get('length-15').fire('change');
  app.get('topic').value = 'A science question'; await app.get('create-form').fire('submit');
  assert.deepEqual(app.calls.find(c => c.path === '/api/episodes' && c.method === 'POST')?.body, { topic: 'A science question', lengthMinutes: 15, pipelineVersion: 2, textOnly: false, auditionFirst: false });
  assert.equal(app.get('now-audio').src, ready.audio_url); assert.equal(app.get('now-audio').playCount, 0); assert.equal(app.get('now-length').textContent, '15 min');
  await app.get('job-listen-button').fire('click'); assert.equal(app.get('now-audio').paused, false);
});

test('text-only creation stops before audio and exposes a transcript and Reading List', async () => {
  let reads = 0; const checkpoint = pilot({ textReady: true, stage: 'ready_for_audio', actions: {}, transcript_url: '/api/episodes/pilot-1/transcript', research_url: '/api/episodes/pilot-1/research' });
  const app = boot({ reply(call) { if (call.path === '/api/episodes' && call.method === 'POST') return pilot({ status: 'running' }); if (call.path.endsWith('/advance')) return { ok: true }; return reads++ === 0 ? pilot({ status: 'running' }) : checkpoint; } }); await app.ready();
  app.get('text-only').checked = true; app.get('topic').value = 'How fireflies glow'; await app.get('create-form').fire('submit');
  assert.deepEqual(app.calls.find(c => c.path === '/api/episodes' && c.method === 'POST')?.body, { topic: 'How fireflies glow', lengthMinutes: 5, pipelineVersion: 2, textOnly: true });
  assert.equal(app.get('result-state').textContent, 'Script ready'); assert.equal(app.get('result-transcript').href, checkpoint.transcript_url); assert.equal(app.get('result-reading-list').href, checkpoint.research_url);
  assert.equal(app.get('now-content').hidden, true); await app.visibility(true); await app.visibility(false); assert.equal(app.calls.filter(c => c.path.endsWith('/advance')).length, 1);
});

test('generation progress and saved-job selection do not interrupt an independently playing free episode', async () => {
  const running = pilot({ status: 'running', actions: { pause: true, resume: true, cancel: true } }); const app = boot({ episodes: [running], reply: () => running }); await app.ready();
  await app.selectFree(); const loads = app.get('now-audio').loadCount; await app.open();
  assert.equal(app.get('now-audio').src, '/audio/pharmaceutical-opening.mp3'); assert.equal(app.get('now-audio').loadCount, loads); assert.equal(app.get('now-audio').paused, false);
  assert.equal(app.calls.filter(c => c.method === 'POST').length, 0);
});

test('a verified server scheduler makes the page monitor progress without posting advance requests', async () => {
  let reads = 0;
  const running = pilot({ status: 'running' }), finished = pilot({ textReady: true, stage: 'ready_for_audio' });
  const app = boot({ capabilities: { text_pilot: true, podcast_generation: true, supported_lengths: [5, 15], background_processing: true },
    reply(call) {
      if (call.path === '/api/episodes' && call.method === 'POST') return running;
      assert.equal(call.method, 'GET'); return reads++ === 0 ? running : finished;
    } });
  await app.ready(); assert.match(app.get('create-status').textContent, /leave this page/);
  app.get('topic').value = 'A background conversation'; await app.get('create-form').fire('submit');
  assert.equal(app.get('result-state').textContent, 'Script ready');
  assert.equal(app.calls.filter(call => call.path.endsWith('/advance')).length, 0);
});

test('a hidden page stops monitoring a background job without claiming creation has paused', async () => {
  const running = pilot({ status: 'running' });
  const app = boot({ capabilities: { text_pilot: true, podcast_generation: true, supported_lengths: [5, 15], background_processing: true }, reply: () => running });
  await app.ready(); await app.visibility(true); app.get('topic').value = 'A saved background job';
  await app.get('create-form').fire('submit');
  assert.match(app.get('result-status').textContent, /continues in the background/);
  assert.equal(app.calls.filter(call => call.path.endsWith('/advance')).length, 0);
});

test('paused or uncertain saved jobs and returning to the page never restart processing', async () => {
  for (const pause of [{ code: 'cancelled', reason: 'Stopped by you.' }, { code: 'ambiguous_provider_result', reason: 'Saved result needs checking.' }]) {
    const job = pilot({ pause, actions: {} }); const app = boot({ episodes: [job], reply: () => job }); await app.ready(); await app.open(); await app.visibility(true); await app.visibility(false);
    assert.equal(app.calls.filter(c => c.method === 'POST').length, 0); assert.equal(app.get('result-status').textContent, pause.reason);
  }
});

test('control permissions are refreshed before posting and revoked permissions send no mutation', async () => {
  let reads = 0; const app = boot({ episodes: [pilot()], reply(call) { assert.equal(call.method, 'GET'); return reads++ === 0 ? pilot({ actions: { resume: true } }) : pilot({ actions: {} }); } });
  await app.ready(); await app.open(); await app.get('resume-button').fire('click'); await flush(); assert.equal(reads, 2); assert.equal(app.calls.filter(c => c.method === 'POST').length, 0);
});

test('an unstarted saved episode uses the server default without exposing a limit field', async () => {
  const initial = pilot({ actions: { start: true } }); const app = boot({ episodes: [initial], reply(call) { if (call.method === 'GET') return initial; assert.deepEqual(call.body, { action: 'set_budget' }); return pilot({ actions: {} }); } });
  await app.ready(); await app.open(); await app.get('start-episode-button').fire('click'); await flush();
  assert.deepEqual(app.calls.slice(-2).map(c => [c.method, c.path]), [['GET', '/api/episodes/pilot-1'], ['POST', '/api/episodes/pilot-1/control']]);
});

test('saved ready audio uses the same player and treats episode and reading-list text as literal content', async () => {
  const title = '<img src=x onerror=alert(1)>'; const job = pilot({ title, status: 'ready', stage: 'ready', audio_url: '/api/episodes/pilot-1/audio', actions: {},
    sources: [{ title: '<script>bad()</script>', url: 'https://example.org/study' }] });
  const app = boot({ episodes: [job] }); await app.ready(); await app.open();
  assert.equal(app.get('now-episode-title').textContent, title); assert.equal(app.get('now-audio').src, job.audio_url); assert.equal(app.get('reading-links').children[0].children[0].textContent, '<script>bad()</script>');
  assert.equal(app.calls.filter(c => c.method === 'POST').length, 0);
  assert.equal(descendants(app.get('saved-list').children[0]).some(e => e.tagName === 'AUDIO'), false);
});

test('the history reset clears old browser entries and keeps subsequent saved episodes', async () => {
  const archived = boot({ local: [pilot({ id: 'retired-attempt' })], archivedEpisodeIds: ['retired-attempt'] }); await archived.ready();
  assert.equal(archived.get('saved-list').children[0].textContent, 'Your own conversations will appear here.');
  assert.deepEqual(JSON.parse(archived.storage.get('still-curious-jobs-v2')!), []);
  const cleared = boot({ legacyLocal: [pilot()], savedSpeed: '0.8' }); await cleared.ready();
  assert.equal(cleared.get('saved-list').children[0].textContent, 'Your own conversations will appear here.');
  assert.equal(cleared.storage.has('still-curious-jobs-v1'), false);
  assert.equal(cleared.get('playback-speed').value, '0.8');
  const current = boot({ local: [pilot({ id: 'new-local' })], episodes: [pilot({ id: 'new-server' })] }); await current.ready();
  assert.equal(current.get('saved-list').children.length, 2);
  assert.equal(current.storage.has('still-curious-jobs-v2'), true);
});

test('existing scripts can record without an amount, and optional preview acceptance remains explicit', async () => {
  let state = pilot({ textReady: true, stage: 'ready_for_audio', audioAvailable: true, actions: { authorizeAudio: true } });
  const audition = pilot({ audition_url: '/api/episodes/pilot-1/audio?preview=audition', actions: { acceptAudition: true } });
  const app = boot({ episodes: [state], reply(call) {
    if (call.method === 'GET') return state;
    if (call.body?.action === 'authorize_audio') { assert.deepEqual(call.body, { action: 'authorize_audio', auditionFirst: false }); state = audition; return state; }
    assert.deepEqual(call.body, { action: 'accept_audition' }); state = pilot({ actions: {} }); return state;
  } }); await app.ready(); await app.open(); await app.get('generate-audio-button').fire('click'); await flush();
  assert.equal(app.get('accept-preview-button').hidden, false); await app.get('job-listen-button').fire('click'); assert.equal(app.get('now-audio').src, audition.audition_url);
  await app.visibility(true); await app.visibility(false); assert.equal(app.calls.filter(c => c.method === 'POST').length, 1);
  await app.get('accept-preview-button').fire('click'); await flush(); assert.equal(app.calls.filter(c => c.method === 'POST').length, 2);
});

test('the library remains playable when generation is unavailable and a failed creation is never retried', async () => {
  const unavailable = boot({ capabilities: { supported_lengths: [5], text_pilot: false } }); await unavailable.ready(); assert.equal(unavailable.get('create-button').disabled, true); await unavailable.selectFree(); assert.equal(unavailable.get('now-audio').paused, false);
  const app = boot({ reply() { throw new Error('Unknown acknowledgement'); } }); await app.ready(); app.get('topic').value = 'A new topic'; await app.get('create-form').fire('submit');
  assert.equal(app.calls.filter(c => c.method === 'POST').length, 1); assert.match(app.get('result-status').textContent, /not confirmed/);
});

test('persistent player expands without scrolling or reloading audio, with seek and skip controls', async () => {
  const app = boot(); await app.ready(); await app.selectFree();
  assert.equal(app.get('now-playing').hidden, false); assert.equal(app.get('now-playing').scrollCount, 0);
  const player = app.get('now-audio') as Element & { currentTime: number }; player.duration = 300; player.currentTime = 10;
  await player.fire('loadedmetadata');
  const loads = player.loadCount;
  await app.get('expand-player').fire('click'); assert.equal(app.get('player-details').hidden, false);
  await app.get('skip-back').fire('click'); assert.equal(player.currentTime, 0);
  await app.get('skip-forward').fire('click'); assert.equal(player.currentTime, 15);
  app.get('seek').value = '500'; await app.get('seek').fire('input'); assert.equal(player.currentTime, 150);
  assert.equal(app.get('elapsed').textContent, '2:30');
  await app.get('collapse-player').fire('click'); assert.equal(app.get('player-details').hidden, true);
  assert.equal(player.loadCount, loads); assert.equal(player.paused, false);
  await app.get('play-toggle').fire('click'); assert.equal(player.paused, true);
});

test('library views and recoverable archiving preserve independent audio playback', async () => {
  const job = pilot({ actions: { cancel: true } });
  const app = boot({ episodes: [job], reply(call) {
    if (call.path.endsWith('/archive')) return { ...job, ...(call.body?.action === 'archive' ? { archivedAt: 123 } : {}), pause: { code: 'cancelled' }, actions: {} };
    return job;
  } });
  await app.ready(); await app.selectFree(); await app.get('yours-tab').fire('click'); await flush();
  assert.equal(app.get('free-panel').hidden, true); assert.equal(app.get('saved-panel').hidden, false);
  await app.open(); await app.get('cancel-button').fire('click'); await flush();
  assert.equal(app.get('custom-result').hidden, true);
  assert.equal(app.get('saved-list').children[0].textContent, 'Your own conversations will appear here.');
  assert.equal(app.get('archive-list').children.length, 1);
  assert.equal(app.get('now-audio').paused, false);
  await buttonIn(app.get('archive-list').children[0]).fire('click'); await flush();
  assert.equal(app.get('saved-list').children.length, 1);
  assert.deepEqual(app.calls.filter(c => c.method === 'POST').map(c => c.body), [{ action: 'archive' }, { action: 'restore' }]);
});
