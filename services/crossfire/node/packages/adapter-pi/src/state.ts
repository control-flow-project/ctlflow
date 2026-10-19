import { MAX_HISTORY_CONTEXT, validHistoryContext } from '@ctlflow/crossfire-kernel/history-context';
import { createHash } from 'node:crypto';
import { constants, openSync, closeSync, fsyncSync, fchmodSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { privateDir, readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { historyHeader, historySince, ownedFile } from '@ctlflow/crossfire-adapter-runtime/native-file';
import { success, failureError } from '@ctlflow/crossfire-kernel/result';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { record } from './protocol.js';

const binding = check.object({ context: check.refine(check.text(MAX_HISTORY_CONTEXT), validHistoryContext, 'Invalid native history context'), file: check.refine(check.text(80), value => /^[a-f0-9]{64}\.jsonl$/u.test(value), 'Invalid Pi history allocation'),
  sessionId: check.nullable(check.identifier), instructionsDigest: check.nullable(check.refine(check.text(64), value => /^[a-f0-9]{64}$/u.test(value), 'Invalid Pi instruction digest')) });
const registry = check.object({ mode: check.choice('shared', 'per-room'), bindings: check.list(binding, 2002) });
export type PiBinding = check.Parsed<typeof binding>;
export function piState(home: string) {
  const file = join(home, 'crossfire-contexts.json');
  const state = lstatSync(file, { throwIfNoEntry: false }) ? registry(readJson<unknown>(file)) : success({ mode: 'shared' as const, bindings: [] as PiBinding[] });
  if (!state.ok || state.value.bindings.some((value, index, all) => value.file !== allocatePi(value.context).file || all.some((other, position) => position !== index &&
    (other.context === value.context || other.file === value.file || value.sessionId !== null && other.sessionId === value.sessionId)))) throw failureError({ code: 'invalid', message: 'Invalid canonical Pi context registry' });
  return { file, state: state.value, save: () => writeJson(file, state.value) };
}
export function allocatePi(context: string): PiBinding {
  const name = createHash('sha256').update(context).digest('hex') + '.jsonl';
  return { context, file: name, sessionId: null, instructionsDigest: null };
}
export function piHistory(home: string, binding: PiBinding): string { return join(home, 'histories', binding.file); }
export function verifyPiHistory(file: string, workspace: string, sessionId: string): void {
  const value = historyHeader(file);
  if (!value) throw failureError({ code: 'missing', message: 'Saved Pi history is missing; resume cannot create a different history' });
  const header = record(value);
  if (header.type !== 'session' || header.id !== sessionId || header.cwd !== workspace || header.version !== 3) throw failureError({ code: 'conflict', message: 'Pi history identity, workspace or native format changed' });
}
export function flushPiHistory(file: string): void {
  ownedFile(file, Number.MAX_SAFE_INTEGER, descriptor => { fchmodSync(descriptor, 0o600); fsyncSync(descriptor); });
}
export function instructionDigest(text: string): string { return createHash('sha256').update(text).digest('hex'); }
export function readPiBinding(home: string, binding: PiBinding, workspace: string): void {
  const file = piHistory(home, binding);
  if (binding.sessionId) { verifyPiHistory(file, workspace, binding.sessionId); return; }
  if (!lstatSync(file, { throwIfNoEntry: false })) return;
  ownedFile(file, Number.MAX_SAFE_INTEGER, (_descriptor, info) => {
    if (!info.size) return;
    const header = record(historyHeader(file));
    const id = check.identifier(header.id);
    if (!id.ok || header.type !== 'session' || header.cwd !== workspace || header.version !== 3) throw failureError({ code: 'invalid', message: 'Allocated Pi history is not a valid native session' });
    binding.sessionId = id.value;
  });
}
export function initializePiBinding(home: string, binding: PiBinding, workspace: string): void {
  const file = piHistory(home, binding);
  if (binding.sessionId) { verifyPiHistory(file, workspace, binding.sessionId); return; }
  const directory = privateDir(join(home, 'histories'));
  if (!lstatSync(file, { throwIfNoEntry: false })) {
    const descriptor = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    const parent = openSync(directory, 'r'); try { fsyncSync(parent); } finally { closeSync(parent); }
  }
  readPiBinding(home, binding, workspace);
}
export function verifyInstructions(file: string, digest: string, text: string, since: Parameters<typeof historySince>[1], entryId: string): void {
  let matched = false;
  historySince(file, since, item => {
    const value = record(item);
    if (value.type === 'custom' && value.id === entryId && value.customType === 'crossfire-instructions') {
      const data = record(value.data); matched = data.digest === digest && data.text === text;
    }
  });
  if (!matched) throw failureError({ code: 'conflict', message: 'Pi did not persist the exact instruction receipt' });
  flushPiHistory(file);
}
