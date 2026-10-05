import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';
import { setupDescriptorSchema } from '@ctlflow/crossfire-contracts/onboarding';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';

export const setupInput = check.object({ descriptor: setupDescriptorSchema, workspace: check.text(4096), configuration: check.optional(check.text(4096)) });
export type SetupInput = check.Parsed<typeof setupInput>;
export function descriptorUrl(value: string): Result<URL> {
  try {
    const url = new URL(value), trusted = endpoint(url.origin), owner = check.matrixUserId(url.searchParams.get('ownerMatrixId'));
    if (!trusted.ok) return trusted;
    if (!owner.ok) return owner;
    if (url.pathname !== '/onboarding/setup.json' || url.username || url.password || url.hash || [...url.searchParams.keys()].length !== 1
      || url.searchParams.getAll('ownerMatrixId').length !== 1) return failure('invalid', 'Use the personalized Crossfire setup descriptor URL');
    return success(url);
  } catch { return failure('invalid', 'Invalid Crossfire setup descriptor URL'); }
}
