import { createClient, type Client } from '@ctlflow/crossfire-client/client';
import type { MessagingInspection } from '@ctlflow/crossfire-domain/port/messaging-inspection';
import { inspectBackend } from './backend.js';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import type { SessionView } from '@ctlflow/crossfire-contracts/schema/response';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { endpoint } from '@ctlflow/crossfire-contracts/origin';
import { failure, type Result } from '@ctlflow/crossfire-kernel/result';
import type { ClientOptions } from '@ctlflow/crossfire-client/client';

export function operatorClient(options: ClientOptions): Client {
  const client = createClient(options);
  return { call: async (operation, params, input, query, signal) => {
    const result = await client.call(operation, params, input, query, signal);
    return result.ok ? result : failure(result.error.code, operation.method + ' ' + operation.path + ' failed (' + result.error.code + '); private response data is not printed');
  } };
}

export const credentials = check.object({ backendUserId: check.backendUserId, password: check.text(8192) });
export type Credentials = check.Parsed<typeof credentials>;
export type Human = { client: Client; viewer: SessionView; nativeAccessToken: string; messaging: MessagingInspection; inspectToken(token: string): MessagingInspection };

export async function withHuman<Value>(origin: string, account: Credentials, signal: AbortSignal,
  work: (human: Human) => Promise<Result<Value>>): Promise<Result<Value>> {
  const checked = endpoint(origin); if (!checked.ok) return checked;
  const base = checked.value;
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
  const publicClient = operatorClient({ origin: base, signal, fetch: transport });
  const description = await publicClient.call(operations.messagingBackend, {}, {}); if (!description.ok) return description;
  const login = await publicClient.call(operations.authenticateBackend, {}, { username: account.backendUserId, password: account.password });
  if (!login.ok) return login;
  const nativeAccessToken = login.value.data.accessToken;
  const inspectToken = (token: string) => inspectBackend(description.value.data.configuration, token);
  const messaging = inspectToken(nativeAccessToken);
  try {
    const created = await operatorClient({ origin: base, signal, fetch: transport }).call(operations.createSession, {}, { nativeAccessToken });
    if (!created.ok) result = created;
    else {
      csrf = created.value.data.csrfSecret;
      if (!cookie || created.value.data.member.backendUserId !== account.backendUserId) result = failure('unauthorized', 'Crossfire session identity does not match the requested human');
      else {
        const client = operatorClient({ origin: base, signal, csrf, fetch: transport });
        const current = await client.call(operations.currentSession, {}, {});
        result = !current.ok ? current : current.value.data.member.backendUserId !== account.backendUserId
          ? failure('unauthorized', 'Crossfire current session has a different owner')
          : await work({ client, viewer: current.value.data, nativeAccessToken, messaging, inspectToken });
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
    const ended = await messaging.close();
    if (!ended.ok) result = ended;
  }
  return result;
}
