import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { secureRouter } from '@ctlflow/crossfire-test-support/tls';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { performanceTransport } from './transport.js';

test('performance cancellation closes an actual pending HTTPS request', { timeout: 10000 }, async scope => {
  const controller = new AbortController();
  const { origin } = await secureRouter(scope, createServer(() => controller.abort()));
  const client = performanceTransport(origin, controller.signal);
  try {
    const response = await client.call({ ...operations.policy, path: '/api/instance-policy', headers: {} });
    assert.match(response.failure ?? '', /abort/iu);
    assert(Number.isFinite(response.elapsedMs) && response.elapsedMs >= 0);
  } finally { client.close(); }
});
