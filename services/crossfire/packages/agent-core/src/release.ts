import { updateNotice, type Manifest } from '@crossfire/contracts/release';
import { failure, success, type Result } from '@crossfire/kernel/result';
import type { Coordination } from './coordination.js';

export async function requireCurrentRelease(client: Coordination, installed: Manifest, signal?: AbortSignal): Promise<Result<Manifest>> {
  const current = await client.release(signal);
  if (!current.ok) return failure(current.error.code, 'Cannot check the current Crossfire release: ' + current.error.message);
  return current.value.release === installed.release ? success(current.value)
    : failure('conflict', updateNotice(client.origin, installed.release, current.value, installed.artifacts['SKILL.md'].sha256));
}
