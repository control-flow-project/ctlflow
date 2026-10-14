import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { archiveState } from '@ctlflow/crossfire-adapter-filesystem/archive';
import { identifier } from '@ctlflow/crossfire-contracts/schema/validation';
import { nativeDirectories, prepareHome } from './home.js';
import { contextState, CONTEXT_REGISTRY } from './context-state.js';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';

export async function resetCodex(input: { workspace: string; stateDirectory: string; resetId: string }) {
  if (!identifier(input.resetId).ok) return failure('invalid', 'Invalid context reset identity');
  let release: (() => Promise<void>) | undefined;
  try {
    nativeDirectories(input);
    const home = prepareHome(input.stateDirectory), marker = join(home, 'crossfire-reset.json');
    release = await acquireProcessLock(join(home, 'owner'));
    contextState(home);
    if (existsSync(marker) && readJson<{ resetId: string }>(marker).resetId === input.resetId) return success(undefined);
    archiveState(home, join(home, 'crossfire-archive', input.resetId), name => name === CONTEXT_REGISTRY || name.startsWith(CONTEXT_REGISTRY + '.'));
    writeJson(marker, { resetId: input.resetId });
    return success(undefined);
  } catch (error) { return failure('native', error instanceof Error ? error.message : 'Native context reset failed'); }
  finally { await release?.(); }
}
