'use strict';

const assert = require('node:assert/strict');
const { createController, validateEpisode } = require('../dist/speech-preview.js');

class FakeUtterance {
  constructor(text) { this.text = text; this.voice = null; this.rate = 1; this.onend = null; this.onerror = null; }
}

function setup(voices = [
  { name: 'Local A', voiceURI: 'local-a', lang: 'en-US', localService: true },
  { name: 'Local B', voiceURI: 'local-b', lang: 'en-GB', localService: true },
  { name: 'Remote', voiceURI: 'remote', lang: 'en-US', localService: false },
  { name: 'French', voiceURI: 'fr', lang: 'fr-FR', localService: true },
], freshVoiceObjects = false) {
  const scheduled = new Map();
  let timerId = 0;
  const synth = {
    voices,
    spoken: [],
    cancelled: [],
    resumeCalls: 0,
    getVoices() { return freshVoiceObjects ? this.voices.map((voice) => ({ ...voice })) : this.voices; },
    speak(item) { this.spoken.push(item); },
    cancel() { this.cancelled.push(this.spoken.at(-1) || null); },
    resume() { this.resumeCalls += 1; },
  };
  const controller = createController({
    synth,
    Utterance: FakeUtterance,
    setTimer(fn, delay) { const id = ++timerId; scheduled.set(id, { fn, delay }); return id; },
    clearTimer(id) { scheduled.delete(id); },
  });
  return {
    controller, synth, scheduled,
    fireTimer() {
      const entry = scheduled.entries().next().value;
      assert.ok(entry, 'expected a scheduled timer');
      scheduled.delete(entry[0]);
      entry[1].fn();
      return entry[1].delay;
    },
  };
}

function selectVoices(controller, synth) {
  const available = controller.getLocalVoices();
  controller.setVoices({ host: available[0], companion: available[1] || available[0] });
  return available;
}

const episode = (turns) => ({ turns });
const turn = (speaker, text) => ({ speaker, text });

{
  const { controller, synth } = setup(undefined, true);
  controller.setEpisode(episode([turn('host', 'Fresh voice wrappers.')]));
  const [host, companion] = controller.getLocalVoices();
  controller.setVoices({ host, companion });
  assert.equal(controller.getState().voiceReady, true);
  controller.start();
  assert.equal(synth.spoken.length, 1);
  assert.notEqual(synth.spoken[0].voice, host, 'speech uses the current wrapper matching the selected voice signature');
  assert.equal(synth.spoken[0].voice.voiceURI, host.voiceURI);
  assert.equal(synth.spoken[0].voice.lang, host.lang);
}

{
  const voices = [
    { name: 'Host Local', voiceURI: 'host-local', lang: 'en-US', localService: true },
    { name: 'Companion Local', voiceURI: 'companion-local', lang: 'en-GB', localService: true },
    { name: 'Second Companion Local', voiceURI: 'companion2-local', lang: 'en-AU', localService: true },
    { name: 'Remote Third', voiceURI: 'remote-third', lang: 'en-US', localService: false },
  ];
  const { controller, synth, fireTimer } = setup(voices);
  controller.setEpisode(episode([
    turn('host', 'Host turn.'), turn('companion', 'Companion turn.'), turn('companion2', 'Second companion turn.'),
  ]));
  const [host, companion, companion2] = controller.getLocalVoices();
  assert.throws(() => controller.setVoices({ host, companion, companion2: voices[3] }), /companion2 voice/);
  controller.setVoices({ host, companion, companion2 });
  assert.equal(controller.getState().voiceReady, true);
  controller.start();
  assert.equal(synth.spoken.at(-1).voice.voiceURI, 'host-local');
  synth.spoken.at(-1).onend();
  assert.equal(fireTimer(), 350);
  assert.equal(synth.spoken.at(-1).text, 'Companion turn.');
  assert.equal(synth.spoken.at(-1).voice.voiceURI, 'companion-local');
  synth.spoken.at(-1).onend();
  assert.equal(fireTimer(), 350);
  assert.equal(synth.spoken.at(-1).text, 'Second companion turn.');
  assert.equal(synth.spoken.at(-1).voice.voiceURI, 'companion2-local');
}

{
  const { controller, synth } = setup();
  const voices = controller.getLocalVoices();
  controller.setEpisode(episode([turn('host', 'One.'), turn('companion', 'Two.')]));
  controller.setVoices({ host: voices[0], companion: voices[1] });
  assert.equal(controller.getState().voiceReady, true, 'legacy two-role episodes need no third voice');
  controller.start();
  assert.equal(synth.spoken.length, 1);

  controller.setEpisode(episode([turn('host', 'One.'), turn('companion2', 'Three.') ]));
  assert.equal(controller.getState().voiceReady, false);
  controller.start();
  assert.equal(controller.getState().status, 'error');
  assert.equal(synth.spoken.length, 1, 'a three-role episode cannot start without its third voice');
  controller.setVoices({ host: voices[0], companion: voices[1], companion2: voices[0] });
  assert.equal(controller.getState().voiceReady, true, 'one local voice may be assigned to multiple roles');
}

{
  const { controller, synth } = setup();
  assert.deepEqual(controller.getLocalVoices().map((voice) => voice.name), ['Local A', 'Local B']);
  controller.setEpisode(episode([turn('host', 'Hello.')]));
  const [host, companion] = selectVoices(controller, synth);
  assert.equal(controller.getState().voiceReady, true);
  assert.throws(() => controller.setVoices({ host: synth.voices[2], companion }), /available local English/);
  controller.start();
  assert.equal(synth.spoken.length, 1, 'first utterance starts synchronously in start()');
  assert.equal(synth.spoken[0].voice, host);
  assert.equal(synth.spoken[0].rate, 1);
  synth.spoken[0].onend();
  assert.equal(controller.getState().status, 'finished');
}

{
  const { controller, synth } = setup();
  const valid = episode([turn('host', 'Keep this episode playing.')]);
  controller.setEpisode(valid);
  selectVoices(controller, synth);
  controller.start();
  const current = synth.spoken[0];
  const cancelCount = synth.cancelled.length;
  assert.throws(() => validateEpisode(episode([turn('host', '...?!')])), /speakable text/);
  assert.throws(() => controller.setEpisode(episode([turn('companion', '...')])), /speakable text/);
  assert.equal(controller.getState().status, 'speaking');
  assert.equal(synth.cancelled.length, cancelCount, 'invalid episode does not cancel the current speech');
  current.onend();
  assert.equal(controller.getState().status, 'finished');
}

{
  const { controller, synth, fireTimer } = setup();
  const longText = `${'word '.repeat(72).trim()}. Next sentence.`;
  controller.setEpisode(episode([turn('host', longText), turn('companion', 'A reply.') ]));
  const [host, companion] = selectVoices(controller, synth);
  controller.start();
  assert.ok(synth.spoken[0].text.length <= 300);
  assert.equal(synth.spoken[0].voice, host);
  const chunks = [];
  while (controller.getState().status === 'speaking' && synth.spoken.length < 10) {
    const current = synth.spoken.at(-1);
    chunks.push(current.text);
    current.onend();
    if (controller.getState().turnIndex > 0) break;
    if (controller.getState().status === 'speaking') fireTimer();
  }
  assert.equal(chunks.join(' '), longText.replace(/\s+/g, ' '));
  assert.equal(fireTimer(), 350, 'speaker changes have the longer inter-turn pause');
  assert.equal(synth.spoken.at(-1).voice, companion);
  assert.equal(synth.spoken.at(-1).text, 'A reply.');
}

{
  const { controller, synth } = setup();
  controller.setEpisode(episode([turn('host', 'First sentence. Second sentence.')]));
  const [host] = selectVoices(controller, synth);
  controller.start();
  const first = synth.spoken[0];
  controller.pause();
  first.onend(); // A stale cancellation callback must not advance the cursor.
  assert.equal(controller.getState().status, 'paused');
  controller.resume();
  assert.equal(synth.spoken.at(-1).text, first.text, 'resume re-speaks the current sentence');
  assert.equal(synth.spoken.at(-1).voice, host);

  synth.spoken.at(-1).onend();
  controller.pause(); // Pause while the second sentence is waiting behind its gap timer.
  assert.equal(controller.getState().status, 'paused');
  controller.resume();
  assert.equal(synth.spoken.at(-1).text, 'Second sentence.', 'pausing between chunks retains the upcoming chunk');
}

{
  const { controller, synth } = setup();
  controller.setEpisode(episode([turn('host', 'Old episode.'), turn('companion', 'Second turn.')]));
  selectVoices(controller, synth);
  controller.start();
  const late = synth.spoken[0];
  controller.setEpisode(episode([turn('companion', 'Replacement.') ]));
  late.onend();
  assert.equal(synth.spoken.length, 1);
  assert.equal(controller.getState().status, 'idle');
  assert.equal(controller.getState().turnCount, 1);
  controller.start();
  assert.equal(synth.spoken.at(-1).text, 'Replacement.');
  synth.spoken.at(-1).onerror({ error: 'voice-unavailable' });
  assert.equal(controller.getState().status, 'error');
  assert.match(controller.getState().error, /voice-unavailable/);
  assert.equal(controller.getState().voiceReady, true);

  controller.start();
  const stoppedUtterance = synth.spoken.at(-1);
  controller.stop();
  stoppedUtterance.onend();
  assert.equal(controller.getState().status, 'idle', 'stop ignores a late onend callback');
  assert.equal(synth.spoken.length, 3, 'late onend does not restart speech');
}

{
  const { controller, synth } = setup();
  controller.setEpisode(episode([turn('host', 'One.'), turn('companion', 'Two.'), turn('host', 'Three.')]));
  selectVoices(controller, synth);
  assert.throws(() => controller.setRate(0.59), RangeError);
  assert.throws(() => controller.setRate(1.21), RangeError);
  controller.setRate(1.2);
  controller.start();
  assert.equal(synth.spoken[0].rate, 1.2);
  controller.setRate(0.6);
  assert.equal(synth.spoken[0].rate, 1.2, 'rate change only affects the next utterance');
  controller.next();
  assert.equal(synth.spoken.at(-1).text, 'Two.');
  assert.equal(synth.spoken.at(-1).rate, 0.6);
  controller.pause();
  controller.next();
  assert.equal(controller.getState().status, 'paused');
  assert.equal(controller.getState().turnIndex, 2);
  const priorCount = synth.spoken.length;
  controller.previous();
  assert.equal(controller.getState().turnIndex, 1);
  assert.equal(synth.spoken.length, priorCount, 'navigation while paused does not speak');
  controller.resume();
  assert.equal(synth.spoken.at(-1).text, 'Two.');
  controller.stop();
  assert.equal(controller.getState().status, 'idle');
  assert.equal(controller.getState().turnIndex, 0);
}

{
  const { controller, synth } = setup([]);
  controller.setEpisode(episode([turn('host', 'No voice.') ]));
  controller.start();
  assert.equal(synth.spoken.length, 0);
  assert.equal(controller.getState().status, 'error');
  assert.equal(controller.getState().voiceReady, false);
}

console.log('speech-preview tests passed');
