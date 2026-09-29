import { manifest, updateNotice, type Manifest } from '../../contracts/src/release.js';
import { failure, success, type Result } from '../../contracts/src/result.js';
import { nativeOk, type Native } from '../../matrix/src/http.js';

export async function requireCurrentRelease(client: Native, installed: Manifest): Promise<Result<Manifest>> {
  const response = await nativeOk(client, 'GET', '/_coord/release');
  if (!response.ok) return failure(response.error.code, 'Cannot check the current Crossfire release: ' + response.error.message);
  const current = manifest(response.value);
  if (!current.ok) return failure('native', 'Invalid current Crossfire release; no connection started');
  return current.value.release === installed.release ? success(current.value)
    : failure('conflict', updateNotice(client.base, installed.release, current.value, installed.artifacts['SKILL.md'].sha256));
}
