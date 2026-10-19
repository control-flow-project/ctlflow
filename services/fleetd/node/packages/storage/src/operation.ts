import { lstatSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { operationView } from '@ctlflow/fleetd-contracts/api';
import type { Registry } from '@ctlflow/fleetd-domain/port';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';

export function operationStorage(root: string): Pick<Registry, 'pendingOperations' | 'operation' | 'saveOperation' | 'pruneOperations'> {
  const directory = privateDir(join(root, 'operations'));
  function read(id: string) {
    const valid = check.identifier(id); if (!valid.ok) return valid;
    const file = join(directory, id + '.json');
    if (!lstatSync(file, { throwIfNoEntry: false })) return success(null);
    const parsed = operationView(readJson<unknown>(file));
    return !parsed.ok ? parsed : parsed.value.operationId === id ? parsed : failure('invalid', 'Operation file identity mismatch');
  }
  function files(): Result<string[]> {
    const names = readdirSync(directory).filter(name => {
      if (!name.startsWith('.pending-') || !check.identifier(name.slice(9)).ok) return true;
      const file = join(directory, name), information = lstatSync(file);
      if (!information.isFile() || information.uid !== process.getuid!() || information.mode & 0o077 || information.nlink !== 1)
        throw new Error('Abandoned operation writes must be private owned regular files');
      unlinkSync(file); return false;
    });
    if (names.some(name => !name.endsWith('.json') || !check.identifier(name.slice(0, -5)).ok)) return failure('invalid', 'Unexpected file in private operation storage');
    return success(names.map(name => name.slice(0, -5)));
  }
  function save(value: Parameters<Registry['saveOperation']>[0]) {
    const valid = operationView(value); if (!valid.ok) return valid;
    writeJson(join(directory, value.operationId + '.json'), valid.value);
    return success(undefined);
  }
  function attempt<Value>(action: () => Result<Value>): Result<Value> {
    try { return action(); } catch { return failure('unavailable', 'Private operation storage is unavailable'); }
  }
  return {
    operation: id => attempt(() => read(id)),
    saveOperation: value => attempt(() => save(value)),
    pendingOperations: () => attempt(() => {
      const selected = files(); if (!selected.ok) return selected;
      const pending: check.Parsed<typeof operationView>[] = [];
      for (const id of selected.value) {
        const result = read(id); if (!result.ok) return result;
        if (!result.value) return failure('unavailable', 'Operation disappeared during inspection');
        if (result.value.completedAt === null || result.value.receiptPending) pending.push(result.value);
      }
      return success(pending);
    }),
    pruneOperations: (cutoff, limit) => attempt(() => {
      if (!Number.isSafeInteger(cutoff) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
        return failure('invalid', 'Invalid operation retention boundary');
      const selected = files(); if (!selected.ok) return selected;
      let removed = 0;
      for (const id of selected.value) {
        const result = read(id); if (!result.ok) return result;
        if (!result.value) return failure('unavailable', 'Operation disappeared during cleanup');
        if (result.value.completedAt !== null && !result.value.receiptPending && result.value.completedAt < cutoff) {
          unlinkSync(join(directory, id + '.json'));
          if (++removed === limit) return success({ more: true });
        }
      }
      return success({ more: false });
    }),
  };
}
