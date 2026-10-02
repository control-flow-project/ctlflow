import assert from 'node:assert/strict';
import test from 'node:test';
import { createRoomOperations } from '@crossfire/domain/room-access/create-operations';
import { failure, success } from '@crossfire/kernel/result';

test('room application ownership serializes one room while other rooms remain independent', async () => {
  const owner = createRoomOperations();
  let started!: () => void, release!: () => void;
  const starting = new Promise<void>(resolve => { started = resolve; });
  const releasing = new Promise<void>(resolve => { release = resolve; });
  const entered: string[] = [];
  const first = owner.run('!first:test.localhost', async () => {
    entered.push('first'); started(); await releasing;
    return failure('native', 'First native application failed');
  });
  const second = owner.run('!first:test.localhost', async () => { entered.push('second'); return success(2); });
  const other = owner.run('!other:test.localhost', async () => { entered.push('other'); return success(3); });
  await starting;
  assert.deepEqual(await other, success(3));
  assert.deepEqual(entered, ['first', 'other']);
  release();
  assert.equal((await first).ok, false);
  assert.deepEqual(await second, success(2));
  assert.deepEqual(entered, ['first', 'other', 'second']);
});

test('an unexpected native throw releases room ownership without swallowing the error', async () => {
  const owner = createRoomOperations(), expected = new Error('Native operation threw');
  const first = owner.run('!room:test.localhost', async () => { throw expected; });
  const second = owner.run('!room:test.localhost', async () => success('applied'));
  await assert.rejects(first, error => error === expected);
  assert.deepEqual(await second, success('applied'));
  assert.deepEqual(await owner.run('!room:test.localhost', async () => success('next')), success('next'));
});
