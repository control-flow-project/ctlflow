import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseUpdates } from '@ctlflow/crossfire-agent-core/updates';
import type { LocalState } from '@ctlflow/crossfire-agent-core/port';
import type { RuntimeConnection } from '@ctlflow/crossfire-agent-core/runtime';
import { fakeCodex, matrixFixture, THREAD } from '../scripts/test-support/listener.js';
import { updatedRelease } from './release-fixture.js';
import { builtRelease } from '../scripts/test-support/release.js';

function storageFixture() {
  const values = new Map<string, unknown>();
  const storage: LocalState = { exists: file => values.has(file), read: <Value>(file: string) => structuredClone(values.get(file)) as Value,
    write: (file, value) => { values.set(file, structuredClone(value)); }, remove: file => { values.delete(file); } };
  return { values, storage };
}
test('one receipt-confirmed notice per native session and release survives restarts and never authorizes an automatic upgrade', async scope => {
  const native = await fakeCodex(scope), fixture = await matrixFixture(scope, native.directory), stop = new AbortController();
  const { storage } = storageFixture();
  const runtime = await native.runtime(stop.signal, 100);
  cleanup(scope, () => runtime.close());
  const installed = builtRelease().release.manifest.release;
  const first = updatedRelease(builtRelease().release, 'SKILL.md', 'First update').manifest.release;
  const next = updatedRelease(builtRelease().release, 'SKILL.md', 'Next update').manifest.release;
  const notices = () => releaseUpdates(storage, fixture.cursorFile, installed, fixture.settings.owner, THREAD);
  const publisher = notices();
  publisher.available(first);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 0);
  publisher.available(installed);
  assert.equal(publisher.pending(), false, 'A current server heartbeat cancels a pending obsolete update notice');
  publisher.available(first);
  await publisher.publish(runtime, stop.signal);
  const inputs = native.requests().filter(request => request.method === 'turn/start');
  assert.equal(inputs.length, 1);
  const payload = JSON.stringify(inputs[0]!.params);
  assert(payload.includes('Do not update without consent'));
  assert(payload.includes(fixture.settings.owner));
  publisher.available(first);
  assert.equal(publisher.pending(), false);
  const restarted = notices();
  restarted.available(first);
  assert.equal(restarted.pending(), false);
  restarted.available(next);
  await restarted.publish(runtime, stop.signal);
  restarted.available(first);
  assert.equal(restarted.pending(), false);
  assert.equal(native.requests().filter(request => request.method === 'turn/start').length, 2);
  assert.equal(storage.exists(fixture.cursorFile), false, 'Software notices do not consume room unread positions');
  assert.equal(fixture.requests.length, 0, 'Notices do not change enrollment or server permissions');
});
test('uncertain or cancelled delivery is not recorded as notified and retries the exact native receipt identity', async () => {
  const { storage, values } = storageFixture(), recorded: string[] = [], acknowledged: string[] = [];
  let reject = true;
  const runtime: RuntimeConnection = { sessionId: THREAD, approval: 'none', signal: new AbortController().signal,
    deliver: async (_text, id) => { recorded.push(id); if (reject) throw Error('Receipt unavailable'); },
    acknowledge: ids => { acknowledged.push(...ids); }, recover: async () => false, inspect: async () => ({ busy: false }), close: () => {}, settle: async () => false };
  const installed = '0.1.0-aaaaaaaaaaaaaaaaaaaaaaaa', release = '0.1.0-bbbbbbbbbbbbbbbbbbbbbbbb';
  const publisher = () => releaseUpdates(storage, 'cursor', installed, '@human:test', THREAD);
  const failed = publisher(); failed.available(release);
  await assert.rejects(failed.publish(runtime, runtime.signal), /Receipt unavailable/);
  assert.equal(values.size, 0);
  assert.equal(acknowledged.length, 0);
  reject = false;
  const recovered = publisher(); recovered.available(release); await recovered.publish(runtime, runtime.signal);
  assert.equal(recorded[0], recorded[1]);
  assert.deepEqual(acknowledged, [recorded[1]]);
  const another = releaseUpdates(storage, 'cursor', installed, '@human:test', 'aaaaaaaa-bbbb-cccc-dddd-ffffffffffff');
  another.available(release);
  assert.equal(another.pending(), true, 'Another session has an independent consent notice');
  values.set([...values.keys()][0]!, [release, release]);
  assert.throws(() => publisher().available(release), /Invalid saved release notices/);
});

test('update notices retain opaque runtime identities without using them as filesystem paths', async () => {
  const { storage, values } = storageFixture(), delivered: string[] = [];
  const session = 'runtime:/session/with:opaque-identity';
  const runtime: RuntimeConnection = { sessionId: session, approval: 'none', signal: new AbortController().signal,
    deliver: async (_text, id) => { delivered.push(id); }, acknowledge: () => {}, inspect: async () => ({ busy: false }),
    close: () => {}, settle: async () => false, recover: async () => false };
  const installed = '0.1.0-aaaaaaaaaaaaaaaaaaaaaaaa', release = '0.1.0-bbbbbbbbbbbbbbbbbbbbbbbb';
  const publisher = () => releaseUpdates(storage, 'cursor', installed, '@human:test', session);
  const first = publisher(); first.available(release); await first.publish(runtime, runtime.signal);
  assert.equal(delivered.length, 1);
  assert.match([...values.keys()][0]!, /^cursor\.update\.[a-f0-9]{64}$/u);
  const restarted = publisher(); restarted.available(release); assert.equal(restarted.pending(), false);
  const other = releaseUpdates(storage, 'cursor', installed, '@human:test', 'different-session');
  other.available(release);
  await assert.rejects(other.publish(runtime, runtime.signal), /session changed/u);
  for (const invalid of ['', 'x'.repeat(201), 'session\u0000identity']) assert.throws(() => releaseUpdates(storage, 'cursor', installed, '@human:test', invalid), /Invalid update notice session/u);
});
