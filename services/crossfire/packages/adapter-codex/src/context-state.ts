import { lstatSync, realpathSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import * as check from '@crossfire/contracts/schema/validation';
import { readJson } from '@crossfire/adapter-filesystem/index';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { SavedRuntimeContext } from '@crossfire/agent-core/owned-runtime';

const contexts = check.object({ mode: check.choice('shared', 'per-room'), control: check.nullable(check.identifier),
  rooms: check.list(check.object({ room: check.roomId, sessionId: check.identifier }), 2000) });

function metadataExists(file: string): boolean {
  try { lstatSync(file); return true; }
  catch (error) { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return false; throw error; }
}

export function contextState(home: string) {
  const file = join(home, 'crossfire-contexts.json');
  const loaded = contexts(metadataExists(file) ? readJson<unknown>(file) : { mode: 'shared', control: null, rooms: [] });
  if (!loaded.ok) throw new Error(loaded.error.message);
  const sharedFile = join(home, 'crossfire-session.json');
  const saved = metadataExists(sharedFile) ? check.object({ sessionId: check.identifier })(readJson<unknown>(sharedFile)) : success(null);
  if (!saved.ok) throw new Error(saved.error.message);
  const state = loaded.value, sharedSessionId = saved.value?.sessionId;
  const sessions = [sharedSessionId, state.control, ...state.rooms.map(room => room.sessionId)].filter((id): id is string => id != null);
  if (new Set(state.rooms.map(room => room.room)).size !== state.rooms.length || new Set(sessions).size !== sessions.length) {
    throw new Error('Native history bindings require unique rooms and distinct session identities');
  }
  return { file, sharedFile, state, sharedSessionId };
}

export async function codexSavedContexts(input: { workspace: string }): Promise<Result<SavedRuntimeContext[]>> {
  try {
    if (!isAbsolute(input.workspace) || resolve(input.workspace) !== realpathSync(input.workspace)) return failure('invalid', 'Use the exact native workspace, without symbolic links');
    const home = join(input.workspace, '.codex');
    if (!metadataExists(home)) return success([]);
    const info = lstatSync(home);
    if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid!() || info.mode & 0o077) return failure('invalid', 'Native history metadata must be an owned private directory');
    const { state, sharedSessionId } = contextState(home);
    return success([
      ...(sharedSessionId ? [{ context: 'shared', sessionId: sharedSessionId }] : []),
      ...(state.control ? [{ context: 'control', sessionId: state.control }] : []),
      ...state.rooms.map(room => ({ context: room.room, sessionId: room.sessionId })),
    ].map(context => ({ ...context, runtime: 'codex', workspace: input.workspace })));
  } catch (error) { return failure('invalid', error instanceof Error ? error.message : 'Cannot read exact native history metadata'); }
}
