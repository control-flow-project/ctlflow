import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { initializeHistory, canInitializeHistory, initializedHistory } from '@fleetd/storage/history';

test('only enrollment or explicit reset authorizes initial history creation, and successful binding consumes that authorization', scope => {
  const directory = mkdtempSync(join(tmpdir(), 'fleet-history-')), agentId = randomUUID();
  scope.after(() => rmSync(directory, { recursive: true, force: true }));
  assert.equal(canInitializeHistory(directory, agentId), false, 'Existing enrolled agents default to strict resume without migration or a new context');
  initializeHistory(directory, agentId, null); assert.equal(canInitializeHistory(directory, agentId), true);
  initializedHistory(directory, agentId); assert.equal(canInitializeHistory(directory, agentId), false);
  initializedHistory(directory, agentId);
  initializeHistory(directory, agentId, randomUUID()); assert.equal(canInitializeHistory(directory, agentId), true);
  writeFileSync(join(directory, '.fleet/history-initialization', agentId + '.json'), JSON.stringify({ agentId: randomUUID(), resetId: null }));
  assert.throws(() => canInitializeHistory(directory, agentId), /does not match/u);
  assert.throws(() => initializeHistory(directory, '../escape', null), /agentId: Expected an opaque UUID/u);
});
