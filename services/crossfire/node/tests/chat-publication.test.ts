import assert from 'node:assert/strict';
import test from 'node:test';
import { chatPublication } from '@ctlflow/crossfire-agent-core/chat-publication';
import { messageArtifacts } from '@ctlflow/crossfire-agent-core/message-artifacts';
import { eventView, type ReadBatch } from '@ctlflow/crossfire-agent-core/receive';
import type { LocalState } from '@ctlflow/crossfire-agent-core/port';
import type { RuntimeConnection } from '@ctlflow/crossfire-agent-core/runtime';
import type { PrincipalIdentity } from '@ctlflow/crossfire-contracts/schema/response';

function fixture(mode: 'shared' | 'per-room' = 'per-room', maximum = 65536) {
  const values = new Map<string, unknown>(), opened: string[] = [], inputs: { session: string; text: string; id: string }[] = [];
  const receipts = new Set<string>(), targets = new Map<string, RuntimeConnection>(), delivered: string[] = [];
  const signal = new AbortController().signal;
  let fail = false, messages = 0;
  const storage: LocalState = { exists: file => values.has(file), read: <Value>(file: string) => structuredClone(values.get(file)) as Value,
    write: (file, value) => { values.set(file, structuredClone(value)); }, remove: file => { values.delete(file); } };
  function target(session: string): RuntimeConnection {
    return { sessionId: session, signal, approval: 'none', inspect: async () => ({ busy: false }), settle: async () => false, close: () => {}, acknowledge: () => {},
      recover: async (_text, id) => receipts.has(id), deliver: async (text, id) => {
        inputs.push({ session, text, id }); receipts.add(id);
        if (fail && session === '!beta:test') throw new Error('Interrupted before receipt confirmation');
      } };
  }
  const runtime: RuntimeConnection = { ...target('shared'), conversation: async room => {
    opened.push(room); let selected = targets.get(room);
    if (!selected) { selected = target(room); targets.set(room, selected); }
    return selected;
  } };
  const owner = '@owner:test';
  const identity: PrincipalIdentity = { matrixUserId: owner, kind: 'human', ownerMatrixId: null, displayName: 'Owner', ownerDisplayName: null };
  const event = (room: string, id: string, body = 'task') => ({ ...eventView({ event_id: id, sender: owner, type: 'm.room.message',
    origin_server_ts: 1700000000000, content: { body, msgtype: 'm.text' } }, room), origin: { kind: 'room' as const, name: room, alias: null } });
  const batch: ReadBatch = { events: [event('!alpha:test', '$alpha'), event('!beta:test', '$beta')],
    cursors: { '!alpha:test': 'cursor-alpha', '!beta:test': 'cursor-beta' }, latest: { '!alpha:test': '$alpha', '!beta:test': '$beta' }, more_rooms: [] };
  const options = { storage, file: 'publication', settings: { instance: 'proof', homeserver: 'https://matrix.test', server_name: 'test', owner, max_upload_bytes: 100000 },
    runtime, mode, maximum, artifacts: messageArtifacts(storage, 'messages', Date.now), traffic: () => {},
    delivered: async (room: string) => { delivered.push(room); }, count: (count: number) => { messages += count; } };
  const create = () => chatPublication(options);
  return { values, opened, inputs, targets, delivered, event, batch, options, create, signal, identities: new Map([[owner, identity]]),
    fail: () => { fail = true; }, messages: () => messages };
}

test('partial room publication retains full-batch cursors and recovers exact receipts without replay', async () => {
  const proof = fixture(), allowed = new Set(Object.keys(proof.batch.cursors));
  let publisher = proof.create(); publisher.prepare(proof.batch, proof.batch.events, proof.identities);
  assert.equal(publisher.unpublished(), true);
  proof.fail(); await assert.rejects(publisher.publish(allowed, proof.signal), /Interrupted/);
  assert.equal(publisher.unpublished(), false, 'Uncertain or delivered native input cannot be released as an unsent reservation');
  assert.throws(() => publisher.discardUnpublished(), /original native receipts/u);
  assert.deepEqual(proof.inputs.map(input => input.session), ['!alpha:test', '!beta:test']);
  assert.equal(proof.messages(), 1);
  assert.equal(publisher.pending(), true);
  assert.throws(() => publisher.acknowledge(), /unconfirmed/);
  publisher = proof.create();
  const recovered = await publisher.recover(allowed, proof.signal);
  assert(recovered); assert.deepEqual(recovered.batch.cursors, proof.batch.cursors);
  assert.equal(proof.inputs.length, 2, 'Recovery is receipt-only, never a replacement input');
  assert.equal(proof.messages(), 2);
  assert(!proof.inputs[0]!.text.includes('$beta') && !proof.inputs[1]!.text.includes('$alpha'));
  assert(proof.inputs[0]!.text.includes('2023-11-14T22:13:20.000Z'));
  assert(proof.inputs[0]!.text.includes('"relationship":"owner"'));
  publisher.acknowledge(); assert.equal(proof.values.size, 0);
});

test('pausing can release empty and wholly unsent plans without consuming Matrix cursors or publishing native input', () => {
  const proof = fixture('shared'), publisher = proof.create();
  for (const events of [[], proof.batch.events]) {
    publisher.prepare(proof.batch, events, proof.identities); assert.equal(publisher.pending(), true); assert.equal(publisher.unpublished(), true);
    publisher.discardUnpublished(); assert.equal(publisher.pending(), false); assert.equal(publisher.unpublished(), false); assert.equal(proof.values.size, 0);
  }
  assert.equal(proof.inputs.length, 0); assert.equal(proof.messages(), 0);
  assert.deepEqual(proof.batch.cursors, { '!alpha:test': 'cursor-alpha', '!beta:test': 'cursor-beta' });
});

test('unpublished revoked rooms create no history or input and changed pending modes/budgets are refused', async () => {
  const proof = fixture(), publisher = proof.create();
  publisher.prepare(proof.batch, proof.batch.events, proof.identities);
  assert.throws(() => chatPublication({ ...proof.options, mode: 'shared' }), /changed history/);
  assert.throws(() => chatPublication({ ...proof.options, maximum: 100 }), /Invalid chat input/);
  const completed = await publisher.publish(new Set(['!alpha:test']), proof.signal);
  assert(completed); assert.deepEqual(completed.batch.cursors, { '!alpha:test': 'cursor-alpha' });
  assert.deepEqual(proof.opened, ['!alpha:test']); assert.equal(proof.inputs.length, 1);
  publisher.acknowledge();
});

test('uncertain publication cannot move to another room history', async () => {
  const proof = fixture(), publisher = proof.create(), allowed = new Set(Object.keys(proof.batch.cursors));
  publisher.prepare(proof.batch, proof.batch.events, proof.identities);
  proof.fail(); await assert.rejects(publisher.publish(allowed, proof.signal));
  proof.targets.set('!beta:test', { ...proof.targets.get('!beta:test')!, sessionId: 'replacement' });
  await assert.rejects(proof.create().recover(allowed, proof.signal), /Original pending history/);
  assert.equal(proof.inputs.length, 2);
});

test('shared history keeps a single bounded input and file-backs complete oversized UTF-8 messages', async () => {
  const proof = fixture('shared'), allowed = new Set(Object.keys(proof.batch.cursors));
  let publisher = proof.create(); publisher.prepare(proof.batch, proof.batch.events, proof.identities);
  await publisher.publish(allowed, proof.signal);
  assert.equal(proof.inputs.length, 1); assert.equal(proof.opened.length, 0);
  assert(proof.inputs[0]!.text.includes('$alpha') && proof.inputs[0]!.text.includes('$beta'));
  publisher.acknowledge();
  proof.batch.events = [proof.event('!alpha:test', '$large-alpha', '😀'.repeat(18000)), proof.event('!beta:test', '$large-beta', '😀'.repeat(18000))];
  publisher = proof.create(); publisher.prepare(proof.batch, proof.batch.events, proof.identities);
  const completed = await publisher.publish(allowed, proof.signal);
  assert(completed); assert.equal(proof.inputs.length, 2);
  assert(proof.inputs.every(input => Buffer.byteLength(input.text) <= 65536));
  assert(!proof.inputs[1]!.text.includes('😀'.repeat(18000)));
  const pointer = JSON.parse(proof.inputs[1]!.text.split('\n').at(-1)!);
  assert.equal(pointer.count, 2);
  const manifest = proof.values.get(pointer.manifest) as { messages: { file: string }[] };
  assert.deepEqual(manifest.messages.map(entry => (proof.values.get(entry.file) as { content: { body: string } }).content.body), ['😀'.repeat(18000), '😀'.repeat(18000)]);
  publisher.acknowledge();
  proof.batch.events = [proof.event('!alpha:test', '$oversized', '😀'.repeat(26000))];
  publisher.prepare(proof.batch, proof.batch.events, proof.identities);
  await publisher.publish(allowed, proof.signal);
  assert.equal(proof.inputs.length, 3); assert(Buffer.byteLength(proof.inputs[2]!.text) <= 65536);
  publisher.acknowledge();
});

test('steering-confirmed events are removed from prepared ordinary input without skipping its acquisition checkpoint', async () => {
  const proof = fixture('shared');
  const accepted = new Set<string>();
  const publisher = chatPublication({ ...proof.options, admit: event => !accepted.has(event.event_id) });
  publisher.prepare(proof.batch, proof.batch.events, proof.identities);
  accepted.add('$alpha');
  const completed = await publisher.publish(new Set(Object.keys(proof.batch.cursors)), proof.signal);
  assert(completed); assert.deepEqual(completed.batch.cursors, proof.batch.cursors);
  assert.equal(proof.inputs.length, 1);
  assert(!proof.inputs[0]!.text.includes('$alpha')); assert(proof.inputs[0]!.text.includes('$beta'));
  assert.equal(proof.messages(), 1);
  publisher.acknowledge();
});
