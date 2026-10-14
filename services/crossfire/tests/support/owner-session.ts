import assert from 'node:assert/strict';
import { createClient } from '@ctlflow/crossfire-client/client';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { decodeResponse } from '@ctlflow/crossfire-contracts/rest/envelope';
import { value } from './application.js';

export async function ownerSession(origin: string, token: string) {
  const login = await fetch(origin + operations.createSession.path, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ nativeAccessToken: token }) });
  assert.equal(login.status, operations.createSession.status);
  const session = value(decodeResponse(await login.json(), operations.createSession.output, false)).data;
  const cookie = login.headers.get('set-cookie')?.split(';', 1)[0];
  assert(cookie);
  return createClient({ origin, csrf: session.csrfSecret, fetch: (input, options) => fetch(input, {
    ...options, headers: { ...options?.headers, Cookie: cookie, Origin: origin },
  }) });
}
