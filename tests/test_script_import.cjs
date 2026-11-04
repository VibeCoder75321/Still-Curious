'use strict';

const assert = require('node:assert/strict');
const { parseScript, spokenWordCount } = require('../dist/script-import.js');

function throwsMessage(fn, fragment) {
  assert.throws(fn, error => error instanceof Error && error.message.toLowerCase().includes(fragment.toLowerCase()));
}

const tagged = `Preamble and notes

## Section C: Script

[T001] HOST: **Where does the story begin?**
It begins with a question.

[T002] **COMPANION:** With a quiet answer, and another paragraph.

**HOST:** That sounds right.`;
const parsed = parseScript(tagged, 'A conversation');
assert.equal(parsed.status, 'draft');
assert.equal(parsed.title, 'A conversation');
assert.equal(parsed.topic, 'A conversation');
assert.equal(parsed.turns.length, 3);
assert.equal(parsed.turns[0].id, 't001');
assert.equal(parsed.turns[0].text, '**Where does the story begin?**\nIt begins with a question.');
assert.equal(parsed.turns[1].text, 'With a quiet answer, and another paragraph.');
assert.deepEqual(parsed.sources, []);
assert.deepEqual(parsed.claims, []);
assert.deepEqual(parsed.turns[0].claim_ids, []);
assert.equal(parsed.target_minutes, 0.2);
assert.equal(spokenWordCount(parsed), 20);
assert.equal(parsed.audio, null);

const noPreamble = parseScript('[T001] HOST: First line.\n[T002] COMPANION: Second line.');
assert.equal(noPreamble.turns.length, 2);
assert.equal(noPreamble.turns[0].text, 'First line.');
const doubleBold = parseScript('**HOST**: First line.\n**COMPANION**: Second line.');
assert.equal(doubleBold.turns[0].speaker, 'host');
assert.equal(doubleBold.turns[1].speaker, 'companion');
assert.deepEqual(Object.keys(doubleBold.speakers), ['host', 'companion']);

const threeVoices = parseScript('[T001] HOST: Welcome.\n[T002] **COMPANION 1:** I am the first companion.\n[T003] **COMPANION_2**: And I am the second.');
assert.deepEqual(threeVoices.turns.map(turn => turn.speaker), ['host', 'companion', 'companion2']);
assert.deepEqual(threeVoices.turns.map(turn => turn.text), ['Welcome.', 'I am the first companion.', 'And I am the second.']);
assert.deepEqual(threeVoices.speakers, {
  host: { display_name: 'Host' },
  companion: { display_name: 'Companion 1' },
  companion2: { display_name: 'Companion 2' }
});
const companionAliases = parseScript('HOST: Hello.\nCOMPANION1: One.\nCOMPANION 2: Two.');
assert.deepEqual(companionAliases.turns.map(turn => turn.speaker), ['host', 'companion', 'companion2']);

const fullReport = `Report introduction
## Section C: Final script
HOST: First spoken part.
COMPANION: Second spoken part.
## Section D: Evidence appendix
This evidence should never be spoken.
HOST: Nor should this line.`;
const appendixParsed = parseScript(fullReport);
assert.equal(appendixParsed.turns.length, 2);
assert.equal(appendixParsed.turns.some(turn => turn.text.includes('evidence')), false);
const researchSentence = parseScript('HOST: Research is slow, but useful.\nCOMPANION: Agreed.');
assert.equal(researchSentence.turns.length, 2);

const source = { id: 'S1', title: 'Example', url: 'https://example.org/source', accessed_on: '2026-10-14', locator: 'Page 2' };
const claim = { id: 'C1', statement: 'A supplied claim.', source_ids: ['S1'] };
const json = parseScript(JSON.stringify({
  turns: [
    { speaker: 'host', text: 'First.', claim_ids: [] },
    { speaker: 'companion', text: 'Second.', claim_ids: ['C1'], delivery: 'settling' }
  ],
  sources: [source], claims: [claim]
}));
assert.equal(json.turns[1].delivery, 'settling');
assert.deepEqual(json.sources, [source]);
assert.deepEqual(json.claims, [claim]);
assert.equal(json.turns[1].claim_ids[0], 'C1');
assert.deepEqual(Object.keys(json), ['schema_version', 'episode_id', 'topic', 'title', 'target_minutes', 'status', 'speakers', 'sources', 'claims', 'turns', 'audio']);
assert.deepEqual(Object.keys(json.speakers), ['host', 'companion']);

const threeVoiceJson = parseScript(JSON.stringify({ turns: [
  { speaker: 'host', text: 'Welcome.' },
  { speaker: 'companion1', text: 'First companion.' },
  { speaker: 'companion2', text: 'Second companion.' }
] }));
assert.deepEqual(threeVoiceJson.turns.map(turn => turn.speaker), ['host', 'companion', 'companion2']);
assert.deepEqual(Object.keys(threeVoiceJson.speakers), ['host', 'companion', 'companion2']);

throwsMessage(() => parseScript('{"turns": ['), 'json');
throwsMessage(() => parseScript('[]'), 'object');
throwsMessage(() => parseScript('{"turns":{}}'), 'turns array');
throwsMessage(() => parseScript(JSON.stringify({ turns: [{ speaker: 'narrator', text: 'Hello' }, { speaker: 'host', text: 'Hi' }] })), 'speaker');
throwsMessage(() => parseScript(JSON.stringify({ turns: [{ speaker: 'host', text: 'Hello' }, { speaker: 'companion', text: ' ' }] })), 'text');
throwsMessage(() => parseScript('HOST: only one turn'), 'at least two');
throwsMessage(() => parseScript('HOST: hello\nHOST: again'), 'needs at least one');
throwsMessage(() => parseScript('HOST:\nCOMPANION: response'), 'spoken text');
throwsMessage(() => parseScript('HOST: hello\n## Section B: More script\nCOMPANION: response'), 'unexpected section heading');
throwsMessage(() => parseScript('HOST: hello\n[T003] GENETICIST: research detail\nCOMPANION: response'), 'unknown speaker');
throwsMessage(() => parseScript('HOST: hello\n**GENETICIST:** research detail\nCOMPANION: response'), 'unknown speaker');
throwsMessage(() => parseScript(JSON.stringify({ turns: [
  { speaker: 'host', text: 'Hello', claim_ids: ['C404'] },
  { speaker: 'companion', text: 'Hi' }
] })), 'missing or repeated claim');
throwsMessage(() => parseScript(JSON.stringify({ turns: [
  { speaker: 'host', text: 'Hello', claim_ids: ['C1'] },
  { speaker: 'companion', text: 'Hi' }
], claims: [claim] })), 'missing or repeated source');
throwsMessage(() => parseScript(JSON.stringify({ turns: [
  { speaker: 'host', text: 'Hello' }, { speaker: 'companion', text: 'Hi' }
], sources: [{ ...source, url: 'javascript:alert(1)' }] })), 'http');
throwsMessage(() => parseScript('H'.repeat(120001)), '120,000-character');
throwsMessage(() => parseScript(JSON.stringify({ turns: Array.from({ length: 501 }, (_, i) => ({ speaker: i % 2 ? 'companion' : 'host', text: 'x' })) })), '500 turns');

console.log('script import tests passed');
