import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { contractHttp, contractError } from '@ctlflow/crossfire-test-support/contract-http';
import { record } from '@ctlflow/crossfire-test-support/contract-process';
import { HTTP_LIMITS } from '@ctlflow/crossfire-contracts/rest/limits';
import type { contractStack } from './fixture.js';

export async function ingressContracts(scope: TestContext, fixture: Awaited<ReturnType<typeof contractStack>>): Promise<void> {
  await scope.test('real TLS ingress isolates clients and overwrites spoofed forwarding headers', async () => {
    const request = (address: string, headers: Record<string, string> = {}) => contractHttp(fixture.origin, 'POST', '/api/sessions', {}, { Origin: fixture.origin, ...headers }, undefined, address);
    for (let index = 0; index < HTTP_LIMITS.publicMutationsPerMinute; index++) contractError(await request('127.0.0.2', { 'X-Forwarded-For': '198.51.100.' + index }), 400, 'invalid');
    const refused = await request('127.0.0.2', { 'X-Forwarded-For': '203.0.113.1' }); contractError(refused, 429, 'rate_limit'); assert.equal(refused.headers['retry-after'], '60');
    for (const path of ['/_matrix/client/v3/register', '/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web']) {
      const native = await contractHttp(fixture.origin, 'POST', path, {}, { Origin: fixture.origin }, undefined, '127.0.0.2');
      assert.equal(native.status, 429); assert.equal(record(native.body).errcode, 'M_LIMIT_EXCEEDED');
      assert.equal(native.headers['retry-after'], '60'); assert.equal(native.headers['cache-control'], 'no-store');
      assert.match(String(native.headers['x-request-id']), /^[a-f0-9-]{36}$/u);
    }
    contractError(await request('127.0.0.3'), 400, 'invalid');
    const headers = { Host: new URL(fixture.origin).host, Origin: fixture.origin };
    contractError(await contractHttp(fixture.backendOrigin, 'POST', '/api/sessions', {}, headers), 403, 'forbidden');
    for (const path of ['/_matrix/client/v3/register', '/_matrix/client/v3/auth/org.crossfire.login.registration/fallback/web']) {
      const native = await contractHttp(fixture.backendOrigin, 'POST', path, {}, headers);
      assert.equal(native.status, 403); assert.equal(record(native.body).errcode, 'M_FORBIDDEN');
      assert.equal(native.headers['cache-control'], 'no-store'); assert.equal(native.headers['retry-after'], undefined);
    }
    contractError(await contractHttp(fixture.backendOrigin, 'POST', '/api/sessions', {}, { ...headers, 'X-Forwarded-For': '198.51.100.1, 203.0.113.1' }), 403, 'forbidden');
    for (let index = 0; index < HTTP_LIMITS.publicMutationsPerMinute; index++) contractError(await contractHttp(fixture.backendOrigin, 'POST', '/api/sessions', {}, { ...headers, 'X-Forwarded-For': '198.51.100.' + index }, undefined, '127.0.0.4'), 400, 'invalid');
    contractError(await contractHttp(fixture.backendOrigin, 'POST', '/api/sessions', {}, { ...headers, 'X-Forwarded-For': '203.0.113.2' }, undefined, '127.0.0.4'), 429, 'rate_limit');
    assert.equal((await fixture.raw('/api/health')).status, 200);
  });
}
