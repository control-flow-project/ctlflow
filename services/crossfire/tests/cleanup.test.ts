import assert from 'node:assert/strict';
import test from 'node:test';
import { cleanup } from '@crossfire/test-support/cleanup';

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
