import { endpoint } from '@crossfire/contracts/origin';
import { failure, success, type Result } from '@crossfire/kernel/result';

export async function fetchBytes(origin: string, path: string, maximum: number, signal: AbortSignal, transport: typeof fetch = fetch): Promise<Result<Buffer>> {
  const base = endpoint(origin);
  if (!base.ok) return base;
  if (!path.startsWith('/') || path.startsWith('//') || /[\\#\s\u0000-\u001f\u007f]/u.test(path)
    || !Number.isSafeInteger(maximum) || maximum < 1 || maximum > 32 * 1024 * 1024) return failure('invalid', 'Invalid bounded verification request');
  const url = new URL(path, base.value);
  if (url.origin !== base.value) return failure('invalid', 'Verification must remain on its configured origin');
  try {
    const response = await transport(url, { redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
    if (response.status !== 200 || !response.body) { await response.body?.cancel(); return failure('native', 'Verification GET failed: ' + path + ' (HTTP ' + response.status + ')'); }
    const reader = response.body.getReader(), parts: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.byteLength;
        if (length > maximum) { await reader.cancel(); return failure('limit', 'Verification response exceeds its byte limit'); }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    return success(Buffer.concat(parts, length));
  } catch { return failure('unavailable', 'Verification HTTP request failed or was cancelled'); }
}
