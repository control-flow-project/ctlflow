import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { ResumeWork, ResumeWorkStore } from '@ctlflow/fleetd-domain/resume-work';

const context = { context: check.text(255), sessionId: check.text(200) };
const pending = check.list(check.object({ ...context, messageId: check.identifier, checkpointedAt: check.integer(0, 8640000000000000) }), 2002);
const captured = check.list(check.object(context), 2002);
const maximum = 2 * 1024 * 1024;
export function createResumeWork(state: string, now = Date.now, id = randomUUID): ResumeWorkStore {
  const file = join(privateDir(state), 'resume-work.json');
  function read(): Result<ResumeWork[]> {
    try {
      try { lstatSync(file); }
      catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return success([]); throw error; }
      const parsed = pending(readJson<unknown>(file, maximum));
      if (!parsed.ok) return parsed;
      if (new Set(parsed.value.map(item => item.context)).size !== parsed.value.length
        || new Set(parsed.value.map(item => item.messageId)).size !== parsed.value.length) return failure('invalid', 'Duplicate interrupted native history');
      return parsed;
    } catch { return failure('unavailable', 'Cannot read private interrupted-work checkpoints'); }
  }
  function save(values: ResumeWork[]): Result<void> {
    try { const valid = pending(values); if (!valid.ok) return valid; writeJson(file, valid.value, maximum); return success(undefined); }
    catch { return failure('unavailable', 'Cannot persist private interrupted-work checkpoints'); }
  }
  return { read,
    capture(contexts) {
      const valid = captured(contexts); if (!valid.ok) return valid;
      const previous = read(); if (!previous.ok) return previous;
      const next = new Map(previous.value.map(item => [item.context, item]));
      let changed = false;
      for (const item of valid.value) {
        const retained = next.get(item.context);
        if (retained && retained.sessionId !== item.sessionId) return failure('conflict', 'Interrupted work belongs to another saved native history');
        if (!retained) { next.set(item.context, { ...item, messageId: id(), checkpointedAt: now() }); changed = true; }
      }
      return changed ? save([...next.values()]) : success(undefined);
    },
    acknowledge(messageId) {
      const previous = read(); if (!previous.ok) return previous;
      return previous.value.some(item => item.messageId === messageId) ? save(previous.value.filter(item => item.messageId !== messageId)) : success(undefined);
    },
  };
}
