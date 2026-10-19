import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync, writeFileSync, readdirSync, existsSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { operationStorage } from '@ctlflow/fleetd-storage/operation';
import { createRegistry } from '@ctlflow/fleetd-storage/registry';
import { readLoggingConfiguration } from '@ctlflow/fleetd-storage/logging';
import { createOperationHistory } from '@ctlflow/fleetd-domain/operation-history';
import type { Operation } from '@ctlflow/fleetd-domain/model';
import { DAY_MS } from '@ctlflow/crossfire-kernel/logging';
import type { Result } from '@ctlflow/crossfire-kernel/result';

function value<Value>(result: Result<Value>): Value { if (!result.ok) assert.fail(result.error.message); return result.value; }
function operation(at: number, updates: Partial<Operation> = {}): Operation {
  return { operationId: randomUUID(), target: { kind: 'daemon' }, action: 'stop', expectedRevision: 0,
    status: 'succeeded', createdAt: at, completedAt: at, approval: null, errors: [], ...updates };
}

test('controller logging configuration defaults to seven days and rejects malformed, unsafe or unowned configuration', scope => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-log-policy-')); cleanup(scope, () => rmSync(root, { recursive: true }));
  assert.equal(value(readLoggingConfiguration(root)).loggingRetentionDays, 7);
  const file = join(root, 'config.json'); writeFileSync(file, '{}', { mode: 0o600 });
  assert.equal(value(readLoggingConfiguration(root)).loggingRetentionDays, 7);
  writeFileSync(file, '{"loggingRetentionDays":14}'); assert.equal(value(readLoggingConfiguration(root)).loggingRetentionDays, 14);
  for (const input of ['{"loggingRetentionDays":0}', '{"loggingRetentionDays":"7"}', '{"unknown":1}', '{']) {
    writeFileSync(file, input); assert.equal(readLoggingConfiguration(root).ok, false);
  }
  rmSync(file); symlinkSync('/dev/null', file); assert.equal(readLoggingConfiguration(root).ok, false);
});

test('controller operations expire by age in bounded batches without the superseded history count limit', scope => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-op-retention-')); cleanup(scope, () => rmSync(root, { recursive: true }));
  const storage = operationStorage(root), at = Date.UTC(2026, 9, 1), retained = operation(at);
  for (let index = 0; index < 750; index++) value(storage.saveOperation(operation(at - 1)));
  const pending = operation(at - 1, { status: 'running', completedAt: null }), unacknowledged = operation(at - 1, { receiptPending: true });
  for (const item of [retained, pending, unacknowledged]) value(storage.saveOperation(item));
  assert.equal(readdirSync(join(root, 'operations')).length, 753);
  assert.equal(value(storage.pruneOperations(at, 100)).more, true);
  assert.equal(readdirSync(join(root, 'operations')).length, 653);
  let more = true, rounds = 0; while (more && rounds++ < 10) more = value(storage.pruneOperations(at, 100)).more;
  assert.equal(more, false); assert.equal(readdirSync(join(root, 'operations')).length, 3);
  assert.deepEqual(value(storage.pendingOperations()).map(item => item.operationId).sort(), [pending.operationId, unacknowledged.operationId].sort());
  assert.deepEqual(value(storage.operation(retained.operationId)), retained);
  assert.equal(storage.pruneOperations(at, 0).ok, false); assert.equal(storage.pruneOperations(NaN, 100).ok, false);
});

test('restart keeps current pending receipts and logging cleanup never erases desired state', scope => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-op-restart-')); cleanup(scope, () => rmSync(root, { recursive: true }));
  let now = Date.UTC(2026, 9, 13), at = now - 8 * DAY_MS;
  const completed = operation(at), unacknowledged = operation(at, { receiptPending: true });
  const registry = createRegistry(root), fleetId = randomUUID();
  value(registry.saveOperation(completed)); value(registry.saveOperation(unacknowledged));
  value(registry.saveDesiredIntent([{ fleetId, instanceKey: 'retained' }])); value(registry.saveResumeSelections([{ fleetId, instanceKeys: ['retained'] }]));
  assert.deepEqual(value(registry.operation(completed.operationId)), completed);
  const history = value(createOperationHistory(registry, () => now, 7));
  assert.equal(value(history.prune()).more, false); assert.equal(value(history.find(completed.operationId)), null);
  assert.deepEqual(value(history.find(unacknowledged.operationId)), unacknowledged);
  assert.deepEqual(value(registry.desiredIntent()), [{ fleetId, instanceKey: 'retained' }]);
  assert.deepEqual(value(registry.resumeSelections()), [{ fleetId, instanceKeys: ['retained'] }]);
  const reopened = createRegistry(root); assert.deepEqual(value(reopened.pendingOperations()), [unacknowledged]);
  const { receiptPending, ...acknowledged } = unacknowledged; assert.equal(receiptPending, true);
  value(history.save(acknowledged)); now += DAY_MS;
  value(history.prune()); assert.equal(value(history.find(unacknowledged.operationId)), null);
});

test('abandoned atomic writes are reclaimed and unsafe operation storage is rejected', scope => {
  const root = mkdtempSync(join(tmpdir(), 'fleet-op-safety-')); cleanup(scope, () => rmSync(root, { recursive: true }));
  const storage = operationStorage(root), item = operation(1); value(storage.saveOperation(item));
  const pending = join(root, 'operations', '.pending-' + randomUUID()); writeFileSync(pending, 'incomplete', { mode: 0o600 });
  assert.deepEqual(value(storage.pendingOperations()), []); assert.equal(existsSync(pending), false);
  const unsafe = join(root, 'operations', randomUUID() + '.json'); symlinkSync('/dev/null', unsafe);
  assert.equal(storage.pendingOperations().ok, false); rmSync(unsafe);
  assert.deepEqual(value(storage.operation(item.operationId)), item);
});
