import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { freePorts } from '@ctlflow/crossfire-test-support/contract-process';

test('fixture cleanup is reverse acquisition order, isolated and complete even after failures', async () => {
  const hooks: (() => Promise<void>)[] = [], otherHooks: (() => Promise<void>)[] = [], events: string[] = [];
  const scope = { after: (hook: () => Promise<void>) => { hooks.push(hook); } };
  const other = { after: (hook: () => Promise<void>) => { otherHooks.push(hook); } };
  cleanup(scope, () => { events.push('backend'); });
  cleanup(scope, async () => { events.push('worker'); throw new Error('Exact failed disposal'); });
  cleanup(scope, () => { events.push('listener'); });
  cleanup(other, () => { events.push('other'); });
  assert.equal(hooks.length, 1); assert.equal(otherHooks.length, 1);
  await assert.rejects(hooks[0]!(), (error: unknown) => error instanceof AggregateError && error.errors.length === 1
    && error.errors[0] instanceof Error && error.errors[0].message === 'Exact failed disposal');
  assert.deepEqual(events, ['listener', 'worker', 'backend']);
  await otherHooks[0]!(); assert.deepEqual(events, ['listener', 'worker', 'backend', 'other']);
});

test('contract ports stay independently leased outside automatic client allocations until scope cleanup', async () => {
  const hooks: (() => Promise<void>)[] = [], scope = { after: (hook: () => Promise<void>) => { hooks.push(hook); } };
  const [first, last] = readFileSync('/proc/sys/net/ipv4/ip_local_port_range', 'utf8').trim().split(/\s+/u).map(Number) as [number, number];
  const selections = await Promise.all(Array.from({ length: 32 }, () => freePorts(scope)));
  const ports = selections.flat(); assert.equal(new Set(ports).size, 64);
  try {
    for (const port of ports) {
      assert(port < first || port > last, 'Contract port must not be selected for an automatic client connection');
      const duplicate = createServer(); duplicate.listen('\0ctlflow-contract-port-' + process.getuid!() + '-' + port);
      await assert.rejects(once(duplicate, 'listening'), (error: unknown) => error instanceof Error && 'code' in error && error.code === 'EADDRINUSE');
      const native = createServer(); native.listen(port, '127.0.0.1'); await once(native, 'listening');
      await new Promise<void>(resolveClose => native.close(() => resolveClose()));
    }
  } finally { await hooks[0]!(); }
  for (const port of ports) {
    const released = createServer(); released.listen('\0ctlflow-contract-port-' + process.getuid!() + '-' + port); await once(released, 'listening');
    await new Promise<void>(resolveClose => released.close(() => resolveClose()));
  }
});
