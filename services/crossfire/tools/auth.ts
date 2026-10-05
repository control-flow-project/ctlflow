import { createClient, type Client } from '@ctlflow/crossfire-adapter-crossfire/client';
import { nativeJson } from '@ctlflow/crossfire-adapter-matrix/http';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { SessionView } from '@ctlflow/crossfire-contracts/schema/response';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { failure, type Result } from '@ctlflow/crossfire-kernel/result';
import type { ClientOptions } from '@ctlflow/crossfire-adapter-crossfire/client';

export function operatorClient(options: ClientOptions): Client {
  const client = createClient(options);
  return { call: async (operation, params, input, query, signal) => {
    const result = await client.call(operation, params, input, query, signal);
    return result.ok ? result : failure(result.error.code, operation.method + ' ' + operation.path + ' failed (' + result.error.code + '); private response data is not printed');
  } };
}

export const credentials = check.object({ matrixUserId: check.matrixUserId, password: check.text(8192) });
export type Credentials = check.Parsed<typeof credentials>;
export type Human = { client: Client; viewer: SessionView; nativeAccessToken: string };

export async function withHuman<Value>(origin: string, account: Credentials, signal: AbortSignal,
  work: (human: Human) => Promise<Result<Value>>): Promise<Result<Value>> {
  const checked = endpoint(origin); if (!checked.ok) return checked;
  const base = checked.value;
  const login = await nativeJson({ base, signal }, 'POST', '/_matrix/client/v3/login', {
    type: 'm.login.password', identifier: { type: 'm.id.user', user: account.matrixUserId }, password: account.password,
    initial_device_display_name: 'Crossfire operator verification',
  });
  if (!login.ok) return login;
  const body = login.value.body;
  if (login.value.status !== 200 || !body || typeof body !== 'object' || Array.isArray(body) || typeof body.access_token !== 'string') return failure('unauthorized', 'Native login failed');
  const nativeAccessToken = body.access_token;
  let cookie: string | undefined, csrf: string | undefined;
  let result: Result<Value> = failure('unavailable', 'Authenticated verification did not complete');
  const transport: typeof fetch = async (url, init) => {
    const destination = url instanceof Request ? new URL(url.url) : new URL(String(url));
    if (destination.origin !== base || !destination.pathname.startsWith('/api/')) throw new Error('Human credentials must remain on this Crossfire API origin');
    const headers = new Headers(init?.headers);
    headers.set('Origin', base);
    if (cookie) headers.set('Cookie', cookie);
    const response = await fetch(url, { ...init, headers });
    if (destination.pathname === '/api/sessions' && init?.method === 'POST') {
      const session = response.headers.getSetCookie().find(value => value.startsWith('__Host-crossfire='));
      if (session) cookie = session.split(';')[0];
    }
    return response;
  };
  try {
    if (body.user_id !== account.matrixUserId) return failure('unauthorized', 'Native login returned a different account');
    const created = await operatorClient({ origin: base, signal, fetch: transport }).call(operations.createSession, {}, { nativeAccessToken });
    if (!created.ok) result = created;
    else {
      csrf = created.value.data.csrfSecret;
      if (!cookie || created.value.data.member.matrixUserId !== account.matrixUserId) result = failure('unauthorized', 'Crossfire session identity does not match the requested human');
      else {
        const client = operatorClient({ origin: base, signal, csrf, fetch: transport });
        const current = await client.call(operations.currentSession, {}, {});
        result = !current.ok ? current : current.value.data.member.matrixUserId !== account.matrixUserId
          ? failure('unauthorized', 'Crossfire current session has a different owner')
          : await work({ client, viewer: current.value.data, nativeAccessToken });
      }
    }
  } catch { result = failure('unavailable', 'Authenticated verification failed; private responses are not printed'); }
  finally {
    try {
      if (cookie && csrf) {
        const ended = await operatorClient({ origin: base, csrf, fetch: transport, timeoutMs: 15000 }).call(operations.endSession, {}, {});
        if (!ended.ok) result = failure('unavailable', 'Crossfire verification session cleanup failed');
      }
    } catch { result = failure('unavailable', 'Crossfire verification session cleanup failed'); }
    const ended = await nativeJson({ base, token: nativeAccessToken }, 'POST', '/_matrix/client/v3/logout', {});
    if (!ended.ok || ended.value.status !== 200) result = failure('unavailable', 'Native verification device logout failed');
  }
  return result;
}
