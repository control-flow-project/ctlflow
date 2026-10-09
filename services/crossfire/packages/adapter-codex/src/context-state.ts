import { lstatSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { failure, failureError, success, type Result } from '@ctlflow/crossfire-kernel/result';
import type { SavedRuntimeContext } from '@ctlflow/crossfire-agent-core/owned-runtime';
import { metadataExists, nativeDirectories } from './home.js';

export const CONTEXT_REGISTRY = 'crossfire-context-registry.json';
export const CONTEXT_MIGRATION = 'crossfire-migrations/context-registry/manifest.json';
const context: check.Parser<string> = value => value === 'shared' || value === 'control' ? success(value) : check.roomId(value);
export const contextRegistry = check.refine(check.object({ mode: check.choice('shared', 'per-room'),
  bindings: check.list(check.object({ context, sessionId: check.identifier }), 2002) }), state =>
  new Set(state.bindings.map(binding => binding.context)).size === state.bindings.length
  && new Set(state.bindings.map(binding => binding.sessionId)).size === state.bindings.length,
  'Native history bindings require unique rooms and distinct session identities');
export function contextReceipt(home: string, context: string): string {
  return join(home, CONTEXT_REGISTRY + '.' + createHash('sha256').update(context).digest('hex') + '.receipt');
}

export function migrationFiles(registry: check.Parsed<typeof contextRegistry>) {
  const files = new Map<string, { target: string | null; sessionId: string | null; instructions: boolean }>();
  for (const name of ['crossfire-session.json', 'crossfire-contexts.json']) files.set(name, { target: null, sessionId: null, instructions: false });
  for (const binding of registry.bindings) {
    const suffix = createHash('sha256').update(binding.context).digest('hex') + '.receipt';
    const base = binding.context === 'shared' ? 'crossfire-session.json.receipt' : 'crossfire-contexts.json.' + suffix;
    for (const instructions of [false, true]) {
      const extension = instructions ? '.instructions' : '';
      files.set(base + extension, { target: CONTEXT_REGISTRY + '.' + suffix + extension, sessionId: binding.sessionId, instructions });
      files.set(base + extension + '.lock', { target: null, sessionId: null, instructions: false });
    }
  }
  return files;
}

export const contextMigration = check.refine(check.object({ phase: check.choice('prepared', 'complete'), registry: contextRegistry,
  files: check.list(check.object({ name: check.text(200),
    digest: check.refine(check.text(64, 64), value => /^[a-f0-9]{64}$/u.test(value), 'Invalid migration digest'),
    target: check.nullable(check.text(200)) }), 8010) }), plan => {
  const expected = migrationFiles(plan.registry), targets = plan.files.flatMap(file => file.target ? [file.target] : []);
  return new Set(plan.files.map(file => file.name)).size === plan.files.length && new Set(targets).size === targets.length
    && plan.files.every(file => expected.has(file.name) && expected.get(file.name)!.target === file.target);
}, 'Context migration contains an unexpected file, receipt target or duplicate');

export function obsoleteContextFile(name: string): boolean {
  return name === 'crossfire-session.json' || name.startsWith('crossfire-session.json.')
    || name === 'crossfire-contexts.json' || name.startsWith('crossfire-contexts.json.');
}

export function contextState(home: string) {
  try {
    if (readdirSync(home).some(obsoleteContextFile)) throw new Error('Native context metadata requires explicit fleetd --migrate-contexts before resume');
    const marker = join(home, CONTEXT_MIGRATION);
    if (metadataExists(marker)) {
      const migrated = contextMigration(readJson<unknown>(marker));
      if (!migrated.ok || migrated.value.phase !== 'complete') throw new Error('Native context migration is incomplete; repeat fleetd --migrate-contexts before resume');
    }
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
