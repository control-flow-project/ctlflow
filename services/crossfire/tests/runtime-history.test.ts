import { cleanup } from '@crossfire/test-support/cleanup';
import { trustWorkspace } from '@crossfire/test-support/codex';
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { codexRuntime } from '@crossfire/adapter-codex/owned';
import { nativeProvider } from '../scripts/test-support/native-provider.js';
import { until } from '../scripts/test-support/listener.js';
import { value } from './support/application.js';
import type { RuntimeDecision, RuntimeObservationEvent } from '@crossfire/agent-core/runtime';
import { success } from '@crossfire/kernel/result';
import { codexTerminal } from '@crossfire/adapter-codex/terminal';

async function environment(scope: Parameters<typeof nativeProvider>[0]) {
  const directory = mkdtempSync(join(process.cwd(), '.temp/native-histories-'));
  const workspace = join(directory, 'workspace'), home = join(workspace, '.codex');
  mkdirSync(workspace, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  writeFileSync(join(home, 'auth.json'), '{}', { mode: 0o600 });
  const provider = await nativeProvider(scope, home);
  trustWorkspace(home, workspace);
  return { workspace, provider, adapter: codexRuntime(process.env.CROSSFIRE_TEST_CODEX ?? 'codex') };
}

test('stock Codex routes persistent room histories, protects unacknowledged work and retains exact terminal pointers across mode changes', { timeout: 60000 }, async scope => {
  const { workspace, provider, adapter } = await environment(scope);
  const observed: RuntimeObservationEvent[] = [], stop = new AbortController();
  const input = { name: 'room-proof', workspace, instructions: 'Inert history proof.', options: { model: 'gpt-5.2', model_reasoning_effort: 'high' },
    listenerOptions: { history_mode: 'per-room' as 'per-room' | 'shared', max_input_bytes: 100000 },
    hooks: { requestDecision: async () => { throw new Error('No permission expected'); }, observe: (event: RuntimeObservationEvent) => observed.push(event) } };
  let runtime = value(await adapter.start(input, stop.signal));
  cleanup(scope, () => runtime.close());
  assert.equal(provider.requests.length, 0);
  assert(runtime.conversation);
  const alpha = await runtime.conversation('!alpha:test'), beta = await runtime.conversation('!beta:test');
  assert.notEqual(alpha.sessionId, beta.sessionId); assert.notEqual(alpha.sessionId, runtime.sessionId);
  const retained = (await runtime.attachments()).map(entry => [entry.context, entry.attachment.sessionId]);
  const pointer = (await runtime.attachments()).find(entry => entry.context === '!alpha:test')!;
  assert(value(codexTerminal().command(pointer.attachment)).includes(alpha.sessionId));
  assert.equal(provider.requests.length, 0, 'History selection/attachment performs no inference');
  await alpha.deliver('alpha private evidence', 'alpha-input', stop.signal);
  await until(() => provider.held() !== undefined); provider.finish();
  await until(async () => (await alpha.inspect()).busy === false);
  await beta.deliver('beta request', 'beta-input', stop.signal);
  await until(async () => (await beta.inspect()).busy === false);
  const second = JSON.stringify(provider.requests[1]);
  assert(!second.includes('alpha private evidence'), 'A room does not inherit another room history');
  assert(observed.some(event => event.kind === 'output' && event.text.includes('Fixture complete.')));
  await runtime.close();
  input.listenerOptions.history_mode = 'shared';
  const blocked = await adapter.start(input, stop.signal);
  assert.equal(blocked.ok, false, 'Mode changes cannot move unacknowledged publications');
  input.listenerOptions.history_mode = 'per-room';
  runtime = value(await adapter.start(input, stop.signal));
  assert.deepEqual((await runtime.attachments()).map(entry => [entry.context, entry.attachment.sessionId]), retained);
  assert(runtime.conversation);
  const resumed = await runtime.conversation('!alpha:test');
  await resumed.deliver('alpha private evidence', 'alpha-input', stop.signal);
  assert.equal(provider.requests.length, 2, 'Receipt recovery does not replay inference');
  await runtime.settle(); runtime.acknowledge(['alpha-input', 'beta-input']);
  await runtime.close();
  input.listenerOptions.history_mode = 'shared';
  runtime = value(await adapter.start(input, stop.signal));
  const sharedId = runtime.sessionId; assert(!runtime.conversation);
  await runtime.close();
  input.listenerOptions.history_mode = 'per-room'; runtime = value(await adapter.start(input, stop.signal));
  await runtime.close();
  input.listenerOptions.history_mode = 'shared'; runtime = value(await adapter.start(input, stop.signal));
  assert.equal(runtime.sessionId, sharedId); assert.equal(provider.requests.length, 2);
});

test('stock Codex structured questions preserve native attribution and exact responses without a routing model call', { timeout: 60000 }, async scope => {
  const { workspace, provider, adapter } = await environment(scope);
  const requests: RuntimeDecision[] = [], observed: RuntimeObservationEvent[] = [];
  const runtime = value(await adapter.start({ name: 'question-proof', workspace, instructions: 'Use native structured questions when a human decision is necessary.',
    options: { features: { default_mode_request_user_input: true } },
    listenerOptions: { history_mode: 'per-room' },
    hooks: { observe: (event: RuntimeObservationEvent) => observed.push(event), requestDecision: async request => {
      requests.push(request);
      const answers = Object.fromEntries(request.questions!.map(question => [question.id, { answers: [question.options[0]!.label] }]));
      return success({ answers });
    } } }, new AbortController().signal));
  cleanup(scope, () => runtime.close());
  assert(runtime.conversation);
  const original = await runtime.conversation('!question:test');
  await runtime.conversation('!unrelated:test');
  assert.equal(provider.requests.length, 0, 'Opening other histories must not invoke the provider');
  provider.tool('request_user_input', { questions: [{ id: 'destination', header: 'Destination', question: 'Choose the exact original destination.',
    options: [{ label: 'A', description: 'First destination' }, { label: 'B', description: 'Second destination' }] }] });
  await original.deliver('Ask the native question from the inert provider', 'question-proof');
  await until(() => requests.length === 1);
  const request = requests[0]!;
  assert.equal(request.session, original.sessionId); assert.notEqual(request.session, runtime.sessionId);
  assert(request.turn); assert(request.item); assert.equal(typeof request.blocking, 'boolean');
  assert.equal(request.questions![0]!.id, 'destination'); assert.equal(request.questions![0]!.options[0]!.label, 'A');
  await until(async () => !(await original.inspect()).busy);
  assert.equal(requests.length, 1, 'Other open histories must not receive or answer this native request');
  assert.equal(provider.requests.length, 2, 'Only task and continuation reach the inert provider');
  assert(JSON.stringify(provider.requests[1]).includes('A'));
  assert(observed.some(event => event.kind === 'state' && event.observation.settings.some(setting => setting.name === 'features.default_mode_request_user_input' && setting.configured === 'true')));
});

test('corrupt native history bindings cannot share a session or ambiguously select a room', { timeout: 60000 }, async scope => {
  const { workspace, provider, adapter } = await environment(scope);
  const shared = randomUUID(), other = randomUUID();
  writeFileSync(join(workspace, '.codex', 'crossfire-session.json'), JSON.stringify({ sessionId: shared }), { mode: 0o600 });
  for (const rooms of [
    [{ room: '!alpha:test', sessionId: shared }],
    [{ room: '!alpha:test', sessionId: other }, { room: '!beta:test', sessionId: other }],
    [{ room: '!alpha:test', sessionId: other }, { room: '!alpha:test', sessionId: randomUUID() }],
  ]) {
    writeFileSync(join(workspace, '.codex', 'crossfire-contexts.json'), JSON.stringify({ mode: 'per-room', control: null, rooms }), { mode: 0o600 });
    const started = await adapter.start({ name: 'invalid-history', workspace, instructions: 'No input.', options: {},
      listenerOptions: { history_mode: 'per-room' }, hooks: { requestDecision: async () => { throw new Error('No decision expected'); } } }, new AbortController().signal);
    assert(!started.ok && started.error.message.includes('unique rooms and distinct session identities'));
    assert.equal(provider.requests.length, 0);
  }
});
