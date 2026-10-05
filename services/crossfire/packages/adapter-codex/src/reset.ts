import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { readJson, writeJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { archiveState } from '@ctlflow/crossfire-adapter-filesystem/archive';
import { identifier } from '@ctlflow/crossfire-contracts/schema/validation';
import { prepareHome } from './home.js';

export async function resetCodex(input: { workspace: string; resetId: string }) {
  if (!identifier(input.resetId).ok) return failure('invalid', 'Invalid context reset identity');
  try {
    const home = prepareHome(input.workspace), marker = join(home, 'crossfire-reset.json');
    if (existsSync(marker) && readJson<{ resetId: string }>(marker).resetId === input.resetId) return success(undefined);
    archiveState(home, join(home, 'crossfire-archive', input.resetId), name => name === 'crossfire-contexts.json' || name.startsWith('crossfire-contexts.json.')
      || name === 'crossfire-session.json' || name.startsWith('crossfire-session.json.'));
    writeJson(marker, { resetId: input.resetId });
    return success(undefined);
  } catch (error) { return failure('native', error instanceof Error ? error.message : 'Native context reset failed'); }
}
