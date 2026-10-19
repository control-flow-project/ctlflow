import { validHistoryContext } from '@ctlflow/crossfire-kernel/history-context';
import { lstatSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { failure, failureError, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { metadataExists, nativeDirectories } from './home.js';

export const CONTEXT_REGISTRY = 'crossfire-context-registry.json';
const context: check.Parser<string> = value => typeof value === 'string' && validHistoryContext(value) ? success(value) : failure('invalid', 'Invalid native history context');
export const contextRegistry = check.refine(check.object({ mode: check.choice('shared', 'per-room'),
  bindings: check.list(check.object({ context, sessionId: check.identifier }), 2002) }), state =>
  new Set(state.bindings.map(binding => binding.context)).size === state.bindings.length
  && new Set(state.bindings.map(binding => binding.sessionId)).size === state.bindings.length,
  'Native history bindings require unique rooms and distinct session identities');
export function contextReceipt(home: string, context: string): string {
  return join(home, CONTEXT_REGISTRY + '.' + createHash('sha256').update(context).digest('hex') + '.receipt');
}

export function contextState(home: string) {
  try {
    const file = join(home, CONTEXT_REGISTRY);
    const loaded = contextRegistry(metadataExists(file) ? readJson<unknown>(file) : { mode: 'shared', bindings: [] });
    if (!loaded.ok) throw new Error(loaded.error.message);
    return { file, state: loaded.value };
  } catch (error) { throw failureError({ code: 'invalid', message: error instanceof Error ? error.message : 'Invalid native context registry' }); }
}

export async function codexSavedContexts(input: { workspace: string; stateDirectory: string }): Promise<Result<SavedRuntimeContext[]>> {
  try {
    nativeDirectories(input);
    const home = join(input.stateDirectory, '.codex');
    if (!metadataExists(home)) return success([]);
    const info = lstatSync(home);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || info.mode & 0o077) return failure('invalid', 'Native history metadata must be an owned private directory');
    const { state } = contextState(home);
    return success(state.bindings.map(binding => ({ ...binding, runtime: 'codex', workspace: input.workspace })));
  } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Cannot read exact native history metadata'); }
}
