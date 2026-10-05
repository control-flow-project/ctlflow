import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createListenerHost } from '@crossfire/adapter-crossfire/listener-host';
import { listenerRequest } from '@crossfire/adapter-crossfire/listener-client';
import { readJson } from '@crossfire/adapter-filesystem/index';
import { createListenerBudget } from '@crossfire/agent-core/budget';
import { cleanup } from '@crossfire/test-support/cleanup';

test('one listener host serves independent capability-bound agents and rejects superseded control URLs', async scope => {
  const root = mkdtempSync(join(tmpdir(), 'listener-host-')), host = await createListenerHost();
  cleanup(scope, async () => { await host.close(); rmSync(root, { recursive: true, force: true }); });
  const stopped: string[] = [];
  const first = host.bind({ cursorFile: join(root, 'first', 'cursor.json'), binding: 'first', release: '0.1.0-' + 'a'.repeat(24), session: () => 'history-one', stop: () => { stopped.push('first'); } });
  const second = host.bind({ cursorFile: join(root, 'second', 'cursor.json'), binding: 'second', release: '0.1.0-' + 'a'.repeat(24), session: () => 'history-two', stop: () => { stopped.push('second'); } });
  cleanup(scope, () => { first.close(); second.close(); });
  const one = readJson<{ port: number; secret: string; binding: string }>(join(root, 'first', 'listener.json'));
  const two = readJson<typeof one>(join(root, 'second', 'listener.json'));
  assert.equal(one.port, two.port); assert.notEqual(one.secret, two.secret); assert.equal(host.size(), 2);
  const status = await listenerRequest(join(root, 'first'), { action: 'status' });
  assert(status?.ok); assert.equal(status.value.session, 'history-one');
  for (const path of ['/control', '/bindings/second/control']) {
    const response = await fetch('http://127.0.0.1:' + one.port + path, { method: 'POST', headers: { Authorization: 'Bearer ' + one.secret }, body: '{"action":"stop"}' });
    assert.equal(response.status, 403);
  }
  assert.deepEqual(stopped, []);
  const stop = await listenerRequest(join(root, 'second'), { action: 'stop' }); assert(stop?.ok);
  assert.deepEqual(stopped, ['second']);
  const invalid = await fetch('http://127.0.0.1:' + one.port + '/bindings/first/control', { method: 'POST',
    headers: { Authorization: 'Bearer ' + one.secret, Origin: 'https://content.example.test' }, body: '{"action":"status"}' });
  assert.equal(invalid.status, 403);
  first.close(); assert.equal(host.size(), 1);
  const still = await listenerRequest(join(root, 'second'), { action: 'status' }); assert(still?.ok);
  assert.equal(still.value.session, 'history-two');
});

test('shared native startup queue is FIFO, cancellable, bounded and release is idempotent', async () => {
  const budget = createListenerBudget(), stop = new AbortController();
  const releases = await Promise.all(Array.from({ length: 4 }, () => budget.acquire('native-start', stop.signal)));
  const cancelled = new AbortController(), order: number[] = [];
  const first = budget.acquire('native-start', stop.signal).then(release => { order.push(1); return release; });
  const removed = budget.acquire('native-start', cancelled.signal); void removed.catch(() => undefined);
  const second = budget.acquire('native-start', stop.signal).then(release => { order.push(2); return release; });
  cancelled.abort(new Error('Canceled queued work')); await assert.rejects(removed, /Canceled queued work/u);
  releases[0]!(); releases[0]!(); const releaseFirst = await first; assert.deepEqual(order, [1]);
  releaseFirst(); const releaseSecond = await second; assert.deepEqual(order, [1, 2]);
  releaseSecond(); releases.slice(1).forEach(release => release());
});
