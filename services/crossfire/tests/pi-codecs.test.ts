import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { piOptions, piVersion } from '@ctlflow/crossfire-adapter-pi/options';
import { piObservation } from '@ctlflow/crossfire-adapter-pi/observation';
import { piQuestion } from '@ctlflow/crossfire-adapter-pi/questions';
import { piReceipt } from '@ctlflow/crossfire-adapter-pi/receipt';
import { allocatePi, piState } from '@ctlflow/crossfire-adapter-pi/state';
import { piRuntime } from '@ctlflow/crossfire-adapter-pi/owned';
import { refreshPiAuthentication } from '@ctlflow/crossfire-adapter-pi/home';
import { captureHistory } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { value } from '@ctlflow/crossfire-test-support/result';
import type { RuntimeObservationEvent } from '@ctlflow/crossfire-agent-core/runtime';
import { observation as runtimeObservation } from '@ctlflow/crossfire-contracts/runtime';

test('Pi admits only exact native options and its verified released protocol', () => {
  for (const thinking_level of ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']) assert(piOptions({ thinking_level }).ok);
  for (const options of [{ thinking_level: 'med' }, { thinking_level: 'ultra' }, { provider: 'alone' }, { model: 'alone' }, { sandbox_mode: 'danger-full-access' },
    { approval_policy: 'never' }, { model_reasoning_effort: 'max' }, { thinking_level: true }]) assert.equal(piOptions(options).ok, false);
  assert(piVersion('1.0.0\n').ok);
  for (const version of ['0.60.0', '1.1.0', '1.0.1', 'garbage']) assert.equal(piVersion(version).ok, false);
});
test('Pi observations forward native text once without reasoning or tool arguments', () => {
  const events: RuntimeObservationEvent[] = [], observation = piObservation({ requestDecision: async () => { throw new Error('Not a decision'); }, observe: event => events.push(event) }, () => 'session');
  observation.event({ type: 'message_start', message: { role: 'assistant' } });
  observation.event({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'secret reasoning' } });
  observation.event({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', delta: 'secret arguments' } });
  observation.event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Visible 😀' } });
  observation.event({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'thinking', thinking: 'secret reasoning' }, { type: 'text', text: 'Visible 😀' }] } });
  assert.deepEqual(events.filter(event => event.kind === 'output').map(event => event.text), ['Visible 😀']);
  assert.throws(() => observation.event({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'no stream' } }), /exact native message stream/u);
});
test('Pi native questions preserve confirm, select, input and editor identity and reject invalid choices', () => {
  for (const method of ['confirm', 'select', 'input', 'editor']) {
    const question = piQuestion({ id: 'original-question', method, title: 'Pick\nDetailed prompt', options: ['A', 'B'], timeout: 30000 }, 'original-history', 'original-run');
    assert.equal(question.request, 'original-question'); assert.equal(question.turn, 'original-run'); assert.equal(question.expiresMs, 30000);
    assert.equal(question.questions?.[0]?.allowText, method === 'input' || method === 'editor');
    assert.equal(question.questions?.[0]?.prompt, 'Detailed prompt');
  }
  assert.throws(() => piQuestion({ id: 'question', method: 'select', title: 'Pick', options: ['A', 'A'] }, 'history', 'run'), /Invalid native Pi options/u);
  assert.throws(() => piQuestion({ id: 'question', method: 'select', title: 'Pick', options: ['A'], timeout: -1 }, 'history', 'run'), /timeout/u);
  const prompt = 'P'.repeat(16000), title = 'T'.repeat(1000);
  const largest = piQuestion({ id: 'question', method: 'select', title: title + '\n' + prompt, options: ['A'], timeout: 0 }, 'history', 'run');
  assert.equal(largest.questions?.[0]?.title, title); assert.equal(largest.questions?.[0]?.prompt, prompt); assert.equal(largest.expiresMs, null);
  assert.equal(piQuestion({ id: 'editor', method: 'editor', title: 'Edit draft', prefill: 'Retained original draft' }, 'history', 'run').questions?.[0]?.prompt, 'Retained original draft');
  assert.throws(() => piQuestion({ id: 'unknown', method: 'unsupported', title: 'Do not invent controls' }, 'history', 'run'), /method/u);
});
test('Pi failure statuses preserve valid UTF-8 plain text within the shared observation contract', () => {
  for (const message of ['E'.repeat(5000), 'Native failure\u0000\u001b\u007f\n' + '東京😀'.repeat(1000)]) {
    const events: RuntimeObservationEvent[] = [];
    piObservation({ requestDecision: async () => { throw new Error('Not a decision'); }, observe: event => events.push(event) }, () => 'session').state('failed', message);
    const event = events[0];
    assert.equal(event?.kind, 'state');
    if (event?.kind !== 'state') throw new Error('Missing failure observation');
    assert.equal(runtimeObservation({ ...event.observation, historyMode: 'shared', maxInputBytes: 65536,
      lastActivityAt: null, historyAvailable: true }).ok, true, 'Native diagnostic must not corrupt the shared owner observation journal');
    assert.equal(event.observation.errorMessage?.startsWith(message.startsWith('E') ? 'E' : 'Native failure   \n'), true);
    assert.equal(Buffer.byteLength(event.observation.errorMessage ?? '') <= 4000, true);
    assert.equal(event.observation.errorMessage?.includes('\ufffd'), false, 'Do not split UTF-8 characters while bounding failure text');
  }
});
test('Pi receipt requires exact metadata, a persisted user entry and current-branch ancestry', scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/pi-receipt-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'history.jsonl'), header = JSON.stringify({ type: 'session', id: 'history' }) + '\n';
  writeFileSync(file, header, { mode: 0o600 }); const boundary = captureHistory(file)!;
  const input = { text: 'exact text', messageId: 'exact-id' };
  const marker = { type: 'custom', id: 'marker', parentId: null, customType: 'crossfire-input', data: input };
  const user = { type: 'message', id: 'user', parentId: 'marker', message: { role: 'user', content: [{ type: 'text', text: input.text }] } };
  const save = (items: unknown[]) => writeFileSync(file, header + items.map(item => JSON.stringify(item) + '\n').join(''), { mode: 0o600 });
  save([marker]); assert.equal(piReceipt(file, boundary, input, 'marker'), false);
  save([user]); assert.equal(piReceipt(file, boundary, input, 'user'), false);
  save([marker, user]); assert.equal(piReceipt(file, boundary, input, 'user'), true);
  assert.equal(piReceipt(file, boundary, { ...input, text: 'different' }, 'user'), false);
  assert.equal(piReceipt(file, boundary, input, 'other-branch'), false);
  save([marker, { ...user, parentId: null }]); assert.equal(piReceipt(file, boundary, input, 'user'), false);
  writeFileSync(file, '{}\n', { mode: 0o600 }); assert.throws(() => piReceipt(file, boundary, input, 'user'), /publication boundary/u);
});
test('saved Pi contexts inspect an incomplete allocation without creating native history or replacing it', async scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/pi-allocation-')); cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const home = join(directory, '.pi'); mkdirSync(home, { mode: 0o700 });
  const stored = piState(home); stored.state.bindings.push(allocatePi('shared')); stored.save();
  const before = readFileSync(stored.file, 'utf8');
  assert.deepEqual(value(await piRuntime('/unavailable-pi').savedContexts({ workspace: directory, stateDirectory: directory })), []);
  assert.equal(readFileSync(stored.file, 'utf8'), before);
  assert.equal(readdirSync(home).some(name => name === 'histories'), false);
});
test('Pi registry rejects an allocation pointing to another context even with a unique native identity', scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/pi-context-identity-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const stored = piState(directory), original = allocatePi('!original:fixture'), other = allocatePi('!other:fixture');
  stored.state.mode = 'per-room'; stored.state.bindings.push(original); stored.save();
  assert.deepEqual(piState(directory).state.bindings, [original]);
  original.file = other.file; stored.save();
  const before = readFileSync(stored.file, 'utf8');
  assert.throws(() => piState(directory), /Invalid canonical Pi context registry/u);
  assert.equal(readFileSync(stored.file, 'utf8'), before, 'Reject changed context allocation without repairing or replacing evidence');
});

test('Pi login refresh rejects relative and invalid private sources and removes absent host copies', scope => {
  const directory = mkdtempSync(join(process.cwd(), '.temp/pi-auth-')), source = join(directory, 'source'), home = join(directory, 'managed');
  const previous = process.env.PI_CODING_AGENT_DIR;
  cleanup(scope, () => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; rmSync(directory, { recursive: true, force: true }); });
  mkdirSync(source, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  process.env.PI_CODING_AGENT_DIR = 'relative';
  assert.throws(() => refreshPiAuthentication(home), /absolute path/u);
  process.env.PI_CODING_AGENT_DIR = source;
  writeFileSync(join(source, 'auth.json'), '{invalid', { mode: 0o600 });
  assert.throws(() => refreshPiAuthentication(home), /configure it on the host/u);
  writeFileSync(join(source, 'auth.json'), '{}', { mode: 0o600 });
  refreshPiAuthentication(home); assert.equal(readFileSync(join(home, 'auth.json'), 'utf8'), '{}');
  rmSync(join(source, 'auth.json')); refreshPiAuthentication(home);
  assert.equal(readdirSync(home).includes('auth.json'), false);
});
