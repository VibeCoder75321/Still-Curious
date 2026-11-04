'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'dist/index.html'), 'utf8');
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'dist/episode.json'), 'utf8'));

class Element {
  constructor() {
    this.disabled = false; this.value = ''; this.textContent = ''; this.children = []; this.events = new Map();
    this.classList = { toggle() {} };
  }
  addEventListener(type, fn) { this.events.set(type, [...(this.events.get(type) || []), fn]); }
  fire(type) { for (const fn of this.events.get(type) || []) fn({ type }); }
  replaceChildren() { this.children = []; }
  append(...items) { this.children.push(...items); }
  setAttribute() {} removeAttribute() {} remove() {} click() { this.fire('click'); }
}
function boot(localVoices) {
  const elements = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map((match) => [match[1], new Element()]));
  elements.get('speech-rate').value = '0.9';
  elements.get('script-title').value = 'Test conversation';
  const events = new Map();
  let activeEpisode = fixture; let imported = false; let audioPaused = 0; let current = null;
  let available = localVoices;
  const spoken = [];
  const document = {
    hidden: false, body: new Element(),
    getElementById: (id) => elements.get(id),
    querySelectorAll: () => [],
    createElement: () => new Element(),
    addEventListener(type, fn) { events.set(type, [...(events.get(type) || []), fn]); },
    dispatchEvent(event) { for (const fn of events.get(event.type) || []) fn(event); }
  };
  const voiceListeners = new Map();
  const synth = {
    getVoices: () => available.map((voice) => ({ ...voice })),
    speak(item) { spoken.push(item); current = item; },
    cancel() { const old = current; current = null; if (old && old.onend) old.onend(); },
    resume() {}, addEventListener(type, fn) { voiceListeners.set(type, fn); }
  };
  const windowEvents = new Map();
  const context = {
    document, speechSynthesis: synth,
    SpeechSynthesisUtterance: function (text) { this.text = text; },
    CustomEvent: function (type, options = {}) { this.type = type; this.detail = options.detail; },
    URL, Blob, console,
    setTimeout: () => 1, clearTimeout() {},
    addEventListener(type, fn) { windowEvents.set(type, fn); },
    StillCuriousPlayer: {
      getEpisode: () => activeEpisode, isImported: () => imported,
      setEpisode(episode, flag) {
        activeEpisode = episode; imported = flag;
        document.dispatchEvent({ type: 'stillcurious:episode', detail: { episode, imported } });
      }
    }
  };
  context.window = context;
  document.addEventListener('stillcurious:speechstart', () => { audioPaused += 1; });
  vm.createContext(context);
  for (const file of ['script-import.js', 'speech-preview.js', 'audition-ui.js']) {
    vm.runInContext(fs.readFileSync(path.join(root, 'dist', file), 'utf8'), context, { filename: file });
  }
  return {
    elements, document, spoken,
    getEpisode: () => activeEpisode, getCurrent: () => current, audioPauseCount: () => audioPaused,
    setAvailable(voices) { available = voices; voiceListeners.get('voiceschanged')(); }
  };
}
const voices = [
  { name: 'Local A', voiceURI: 'a', lang: 'en-US', localService: true, default: true },
  { name: 'Local B', voiceURI: 'b', lang: 'en-GB', localService: true }
];
const app = boot(voices);
assert.equal(app.elements.get('speech-start').disabled, false);
assert.equal(app.spoken.length, 0, 'no automatic speaking');
app.elements.get('speech-start').click();
assert.equal(app.spoken.length, 1, 'first speech starts in the click handler');
assert.equal(app.audioPauseCount(), 1, 'voice preview pauses audio');
assert.match(app.spoken[0].text, /far out at sea/);
const ongoing = app.getCurrent();
app.elements.get('script-text').value = '[T001] HOST: Hello.\n[T002] GENETICIST: Wrong role.';
app.elements.get('import-script').click();
assert.equal(app.getEpisode(), fixture, 'invalid import preserves current episode');
assert.equal(app.getCurrent(), ongoing, 'invalid import does not stop valid preview');
assert.match(app.elements.get('import-message').textContent, /speaker|label|COMPANION/i);
app.elements.get('script-text').value = '[T001] HOST: Shall we try this?\n[T002] COMPANION: This is your new conversation.';
app.elements.get('import-script').click();
assert.equal(app.getEpisode().status, 'draft');
assert.equal(app.getEpisode().turns.length, 2);
assert.equal(app.elements.get('speech-start').textContent, 'Hear your script');
app.elements.get('speech-start').click();
assert.equal(app.getCurrent().text, 'Shall we try this?');
app.document.hidden = true;
app.document.dispatchEvent({ type: 'visibilitychange' });
assert.equal(app.getCurrent(), null);
assert.equal(app.elements.get('speech-pause').textContent, 'Resume');
app.elements.get('speech-pause').click();
assert.equal(app.getCurrent().text, 'Shall we try this?');
const prior = app.getCurrent();
app.document.dispatchEvent({ type: 'stillcurious:audiostart' });
const count = app.spoken.length;
prior.onend();
assert.equal(app.spoken.length, count, 'canceled callbacks cannot restart speech');
app.elements.get('restore-sample').click();
assert.equal(app.getEpisode(), fixture);
assert.equal(app.elements.get('speech-start').textContent, 'Hear the audition');
app.setAvailable([{ name: 'Remote', voiceURI: 'r', lang: 'en-US', localService: false }]);
assert.equal(app.elements.get('speech-start').disabled, true);
assert.match(app.elements.get('speech-message').textContent, /No local English voices/);
console.log('audition UI integration tests passed (mocked DOM and speech; not browser audio verification)');
const three = boot([...voices, { name: 'Local C', voiceURI: 'c', lang: 'en-US', localService: true }]);
assert.equal(three.elements.get('companion2-voice-row').hidden, false);
assert.equal(three.elements.get('companion2-voice').value, '2');
assert.match(three.elements.get('voice-note').textContent, /3 distinct voices are selected for 3 roles/);
three.elements.get('speech-start').click();
const thirdTurnIndex = fixture.turns.findIndex((turn) => turn.speaker === 'companion2');
assert.ok(thirdTurnIndex > 0);
for (let i = 0; i < thirdTurnIndex; i += 1) three.elements.get('speech-next').click();
assert.equal(three.getCurrent().voice.voiceURI, 'c');
assert.match(three.elements.get('speech-message').textContent, /Companion 2/);
three.elements.get('script-text').value = '[T001] HOST: Hello.\n[T002] COMPANION 1: First view.\n[T003] COMPANION 2: Second view.';
three.elements.get('import-script').click();
assert.equal(three.getEpisode().turns[2].speaker, 'companion2');
assert.equal(three.elements.get('companion2-voice-row').hidden, false);
console.log('three-speaker UI integration checks passed');
