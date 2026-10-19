import assert from 'node:assert/strict';
import test from 'node:test';
import { contextRoom, roomContext, validHistoryContext, MAX_HISTORY_CONTEXT } from '@ctlflow/crossfire-kernel/history-context';

test('opaque room histories cannot collide with private contexts and preserve every identifier', () => {
  for (const room of ['shared', 'control', 'room/x', '__proto__', 'é/🙂', 'a'.repeat(255)]) {
    const context = roomContext(room);
    assert.equal(contextRoom(context), room);
    assert.equal(validHistoryContext(context), true);
    assert(context !== 'shared' && context !== 'control');
    assert(context.length <= MAX_HISTORY_CONTEXT);
  }
  assert.equal(contextRoom('shared'), null); assert.equal(contextRoom('control'), null);
  assert.equal(validHistoryContext('shared'), true); assert.equal(validHistoryContext('control'), true);
  for (const room of ['', 'a'.repeat(256), 'bad\nroom', '\u007f', '\ud800']) assert.equal(validHistoryContext(roomContext(room)), false);
});
