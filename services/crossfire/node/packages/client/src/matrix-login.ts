import { failure, success } from '@ctlflow/crossfire-kernel/result';
export async function login(origin: string, username: string, password: string) {
  try {
    const response = await fetch(origin + '/_matrix/client/v3/login', { method: 'POST', redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(15000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'm.login.password',
        identifier: { type: 'm.id.user', user: username }, password, initial_device_display_name: 'crossfire management' }) });
    const input: unknown = await response.json();
    if (!response.ok) return failure('unauthorized', 'Matrix sign-in failed for this server');
    if (!input || typeof input !== 'object' || !('access_token' in input) || typeof input.access_token !== 'string') return failure('native', 'Invalid Matrix login response');
    return success(input.access_token);
  } catch { return failure('unavailable', 'Cannot reach the Matrix server'); }
}
