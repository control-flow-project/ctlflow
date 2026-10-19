import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { descriptorUrl } from '@ctlflow/fleetd-contracts/setup';
import { setupDescriptorSchema } from '@ctlflow/crossfire-contracts/onboarding';
import type { SetupDescriptor } from '@ctlflow/crossfire-domain/onboarding/values';
import { failure, success, type Result } from '@ctlflow/crossfire-kernel/result';

export function installedVersion(): string {
  const value: unknown = JSON.parse(readFileSync(fileURLToPath(import.meta.resolve('@ctlflow/fleet/package.json')), 'utf8'));
  if (!value || typeof value !== 'object' || !('name' in value) || value.name !== '@ctlflow/fleet' || !('version' in value) || typeof value.version !== 'string') throw new Error('Installed Fleet package metadata is invalid');
  return value.version;
}
export async function fetchSetupDescriptor(address: string, version: string, signal: AbortSignal,
  request: typeof fetch = fetch): Promise<Result<SetupDescriptor>> {
  const selected = descriptorUrl(address); if (!selected.ok) return selected;
  try {
    const response = await request(selected.value, { redirect: 'error', credentials: 'omit', signal: AbortSignal.any([signal, AbortSignal.timeout(30000)]),
      headers: { Accept: 'application/json' } });
    if (!response.ok || !response.body || response.headers.get('content-type')?.split(';')[0] !== 'application/json') return failure('unavailable', 'Cannot read the trusted setup descriptor: HTTP ' + response.status);
    const bytes: Uint8Array[] = []; let length = 0;
    for await (const chunk of response.body) {
      length += chunk.byteLength;
      if (length > 256 * 1024) { await response.body.cancel().catch(() => {}); return failure('limit', 'Setup descriptor exceeds 256 KiB'); }
      bytes.push(chunk);
    }
    const parsed = setupDescriptorSchema(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(bytes))));
    if (!parsed.ok) return parsed;
    if (parsed.value.server !== selected.value.origin || parsed.value.ownerBackendUserId !== selected.value.searchParams.get('ownerBackendUserId')) return failure('forbidden', 'Setup descriptor does not match its requested server and owner');
    if (parsed.value.package.version !== version) return failure('conflict', 'Install the exact pinned package @ctlflow/fleet@' + parsed.value.package.version + ' from the setup guide, then rerun setup');
    return success(parsed.value);
  } catch (error) { return failure('unavailable', signal.aborted ? 'Setup cancelled' : error instanceof Error ? error.message : 'Cannot fetch the trusted setup descriptor'); }
}
