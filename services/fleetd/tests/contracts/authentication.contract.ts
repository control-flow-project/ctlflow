import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import type { TestContext } from 'node:test';
import { contractHttp, contractError } from '@ctlflow/crossfire-test-support/contract-http';
import { operations } from '@ctlflow/fleetd-contracts/api';
import { readAuthentication } from '@ctlflow/fleetd-storage/authentication';

export async function authenticationContracts(scope: TestContext, socket: string, file: string): Promise<void> {
  await scope.test('all daemon operations require private configuration-backed authentication before routing or effects', async () => {
    const key = readAuthentication(file), original = readFileSync(file);
    assert.match(key, /^[a-f0-9]{64}$/u);
    assert.equal(statSync(file).mode & 0o777, 0o600); assert.equal(statSync(dirname(file)).mode & 0o777, 0o700);
    for (const operation of Object.values(operations)) {
      assert.equal(operation.auth, 'controller');
      const path = operation.path.replace(/\{[^}]+\}/gu, '00000000-0000-4000-8000-000000000000');
      for (const headers of [{}, { Authorization: 'Bearer ' + 'f'.repeat(64) }]) {
        contractError(await contractHttp('http://localhost', operation.method, path, operation.method === 'GET' ? undefined : {}, headers, socket), 401, 'unauthorized');
      }
    }
    for (const authorization of ['', key, 'bearer ' + key, 'Bearer guessed', 'Bearer ' + key + ', Bearer ' + key, ['Bearer ' + key, 'Bearer ' + key]]) {
      const reply = await contractHttp('http://localhost', 'GET', '/api/status', undefined, { Authorization: authorization }, socket);
      contractError(reply, 401, 'unauthorized'); assert(!JSON.stringify(reply.body).includes(key), 'Authentication failures do not disclose credentials');
    }
    for (const headers of [{ Origin: '' }, { Cookie: '' }, { Origin: 'https://foreign.invalid' }, { Cookie: 'session=not-trusted' }, { Host: 'foreign.invalid' }]) {
      contractError(await contractHttp('http://localhost', 'GET', '/api/status', undefined, { Authorization: 'Bearer ' + key, ...headers }, socket), 403, 'forbidden');
    }
    const reply = await contractHttp('http://localhost', 'GET', '/api/status', undefined, { Authorization: 'Bearer ' + key }, socket);
    assert.equal(reply.status, 200); assert(!JSON.stringify(reply.body).includes(key), 'Status does not expose authentication');
    assert.deepEqual(readFileSync(file), original, 'Client operations never rewrite authentication configuration');
  });
}
