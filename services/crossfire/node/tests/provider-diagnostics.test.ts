import test from 'node:test';
import assert from 'node:assert/strict';
import { providerState } from '@ctlflow/crossfire-adapter-codex/provider';
import { parseProvider } from '@ctlflow/crossfire-adapter-pi/provider';

test('Codex diagnostics distinguish missing accounts from providers that do not require OpenAI authentication', () => {
  assert.deepEqual(providerState({ account: { type: 'chatgpt', email: 'private@example.test' }, requiresOpenaiAuth: true }), { ok: true, value: 'present' });
  assert.deepEqual(providerState({ account: null, requiresOpenaiAuth: true }), { ok: true, value: 'missing' });
  assert.deepEqual(providerState({ account: null, requiresOpenaiAuth: false }), { ok: true, value: 'not-required' });
  for (const malformed of [null, [], {}, { account: [] }, { account: 'secret', requiresOpenaiAuth: true }, { account: null, requiresOpenaiAuth: 'true' }]) {
    const result = providerState(malformed); assert.equal(result.ok, false);
    assert(!JSON.stringify(result).includes('secret'));
  }
});

test('Pi diagnostics check only the selected provider and model, reject malformed metadata and never expose credential fields', () => {
  const state = { model: { provider: 'fixture', id: 'selected' } };
  assert.deepEqual(parseProvider(state, { models: [{ provider: 'fixture', id: 'selected', apiKey: 'private-secret' }] }), { ok: true, value: 'present' });
  assert.deepEqual(parseProvider(state, { models: [{ provider: 'other', id: 'selected' }] }), { ok: true, value: 'missing' });
  assert.deepEqual(parseProvider(state, { models: [] }), { ok: true, value: 'missing' });
  for (const available of [null, {}, { models: [null] }, { models: [{ id: 'selected', apiKey: 'private-secret' }] }, { models: new Array(20001).fill(state.model) }]) {
    const result = parseProvider(state, available); assert.equal(result.ok, false); assert(!JSON.stringify(result).includes('private-secret'));
  }
  assert.equal(parseProvider({}, { models: [] }).ok, false);
});
