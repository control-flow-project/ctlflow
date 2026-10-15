import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { Registry } from './port.js';
import type { Operation } from './model.js';
import { DAY_MS, LOGGING_MAINTENANCE_MS } from '@ctlflow/crossfire-kernel/logging';

export function createOperationHistory(registry: Registry, now: () => number, days: number) {
  const initial = registry.pendingOperations(); if (!initial.ok) return initial;
  const pending = new Map<string, Operation>();
  for (const original of initial.value) {
    const operation = ['succeeded', 'failed'].includes(original.status) ? original : { ...original, status: 'failed' as const, completedAt: now(),
      errors: [{ instanceKey: null, code: 'unavailable', message: 'Controller stopped before this operation completed; inspect and retry explicitly' }] };
    const saved = registry.saveOperation(operation); if (!saved.ok) return saved;
    if (operation.receiptPending) pending.set(operation.operationId, operation);
  }
  let checkedAt = -Infinity, more = false;
  return success({
    pending: () => [...pending.values()],
    find: (id: string) => registry.operation(id),
    save(operation: Operation) {
      const stored = registry.saveOperation(operation);
      if (stored.ok) {
        if (operation.completedAt === null || operation.receiptPending) pending.set(operation.operationId, structuredClone(operation));
        else pending.delete(operation.operationId);
      }
      return stored;
    },
    prune() {
      const time = now(), cutoff = time - days * DAY_MS;
      if (!Number.isSafeInteger(cutoff)) return failure('invalid', 'Invalid controller history retention cutoff');
      if (!more && time >= checkedAt && time - checkedAt < LOGGING_MAINTENANCE_MS) return success({ more: false });
      const result = registry.pruneOperations(cutoff, 500);
      if (result.ok) { checkedAt = time; more = result.value.more; }
      return result;
    },
  });
}
