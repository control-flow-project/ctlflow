import { lstatSync, readdirSync, unlinkSync, openSync, closeSync, fsyncSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { privateDir, readJson, readPrivateBytes, writeJson, writePrivateBytes } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireFileLock } from '@ctlflow/crossfire-adapter-filesystem/lock';
import { readDeliveryJournal } from '@ctlflow/crossfire-adapter-runtime/journal';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { failure, failureError, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { CONTEXT_MIGRATION, CONTEXT_REGISTRY, contextMigration, contextRegistry, contextState, migrationFiles, obsoleteContextFile } from './context-state.js';
import { metadataExists, nativeDirectories } from './home.js';
import { codexInput } from './input.js';
import { instructionInput } from './instructions.js';

const previousRegistry = check.object({ mode: check.choice('shared', 'per-room'), control: check.nullable(check.identifier),
  rooms: check.list(check.object({ room: check.roomId, sessionId: check.identifier }), 2000) });
const MAXIMUM = 32 * 1024 * 1024;
type Plan = check.Parsed<typeof contextMigration>;
function digest(bytes: Buffer): string { return createHash('sha256').update(bytes).digest('hex'); }
function parsed<Value>(value: Result<Value>): Value { if (!value.ok) throw failureError(value.error); return value.value; }

function prepare(home: string): Plan | null {
  const files = readdirSync(home).filter(obsoleteContextFile).sort();
  if (!files.length) return null;
  if (metadataExists(join(home, CONTEXT_REGISTRY))) throw new Error('Canonical and obsolete contexts coexist without an explicit migration manifest');
  const state = parsed(previousRegistry(metadataExists(join(home, 'crossfire-contexts.json'))
    ? readJson<unknown>(join(home, 'crossfire-contexts.json')) : { mode: 'shared', control: null, rooms: [] }));
  const shared = metadataExists(join(home, 'crossfire-session.json'))
    ? parsed(check.object({ sessionId: check.identifier })(readJson<unknown>(join(home, 'crossfire-session.json')))).sessionId : null;
  const registry = parsed(contextRegistry({ mode: state.mode, bindings: [
    ...(shared ? [{ context: 'shared', sessionId: shared }] : []),
    ...(state.control ? [{ context: 'control', sessionId: state.control }] : []),
    ...state.rooms.map(room => ({ context: room.room, sessionId: room.sessionId })),
  ] }));
  const expected = migrationFiles(registry);
  return { phase: 'prepared', registry, files: files.map(name => {
    const selected = expected.get(name);
    if (!selected) throw new Error('Unrecognized obsolete native metadata; migration does not guess or discard it');
    const path = join(home, name), bytes = readPrivateBytes(path, MAXIMUM);
    if (selected.sessionId) {
      if (selected.instructions) readDeliveryJournal(path, selected.sessionId, instructionInput);
      else readDeliveryJournal(path, selected.sessionId, codexInput);
    }
    return { name, digest: digest(bytes), target: selected.target };
  }) };
}

export async function migrateCodexContexts(input: { workspace: string; stateDirectory: string }): Promise<Result<{ migrated: boolean; contexts: number }>> {
  const releases: (() => void)[] = [];
  try {
    nativeDirectories(input);
    const home = join(input.stateDirectory, '.codex');
    if (!metadataExists(home)) return success({ migrated: false, contexts: 0 });
    const info = lstatSync(home);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || info.mode & 0o077) throw new Error('Native history metadata must be an owned private directory');
    const manifest = join(home, CONTEXT_MIGRATION);
    for (const name of readdirSync(home).filter(name => obsoleteContextFile(name) && name.endsWith('.lock'))) {
      releases.push(acquireFileLock(join(home, name.slice(0, -5))));
    }
    let plan = metadataExists(manifest) ? parsed(contextMigration(readJson<unknown>(manifest))) : prepare(home);
    if (!plan) { const current = contextState(home); return success({ migrated: false, contexts: current.state.bindings.length }); }
    if (plan.phase === 'complete') { const current = contextState(home); return success({ migrated: false, contexts: current.state.bindings.length }); }
    plan = parsed(contextMigration(plan));
    const archive = privateDir(join(dirname(manifest), 'originals'));
    if (!metadataExists(manifest)) writeJson(manifest, plan);
    for (const file of plan.files) {
      const source = join(home, file.name), saved = join(archive, file.name);
      const exists = metadataExists(source);
      const bytes = readPrivateBytes(exists ? source : saved, MAXIMUM);
      if (digest(bytes) !== file.digest) throw new Error('Native metadata changed since migration preparation; no original was replaced');
      if (metadataExists(saved)) {
        if (digest(readPrivateBytes(saved, MAXIMUM)) !== file.digest) throw new Error('Native context archive failed its exact-byte verification');
      } else writePrivateBytes(saved, bytes, MAXIMUM);
      if (file.target) {
        const target = join(home, file.target);
        if (metadataExists(target)) {
          if (digest(readPrivateBytes(target, MAXIMUM)) !== file.digest) throw new Error('Canonical receipt conflicts with the verified migration; no receipt was overwritten');
        } else writePrivateBytes(target, bytes, MAXIMUM);
      }
    }
    const target = join(home, CONTEXT_REGISTRY);
    if (metadataExists(target) && JSON.stringify(parsed(contextRegistry(readJson<unknown>(target)))) !== JSON.stringify(plan.registry)) throw new Error('Canonical registry conflicts with the verified migration');
    writeJson(target, plan.registry);
    for (const file of plan.files) {
      const path = join(home, file.name);
      if (metadataExists(path)) {
        if (digest(readPrivateBytes(path, MAXIMUM)) !== file.digest) throw new Error('Original context metadata changed before retirement');
        unlinkSync(path);
      }
    }
    const directory = openSync(home, 'r'); try { fsyncSync(directory); } finally { closeSync(directory); }
    writeJson(manifest, { ...plan, phase: 'complete' });
    contextState(home);
    return success({ migrated: true, contexts: plan.registry.bindings.length });
  } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Native context migration failed'); }
  finally { for (const release of releases.reverse()) release(); }
}
