import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate as yieldLoop } from 'node:timers/promises';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import type { Binding } from '@ctlflow/fleetd-storage/binding';
import { failureReporter } from '@ctlflow/fleetd-adapter-execution/failures';

async function until(predicate: () => boolean): Promise<void> {
  const deadline = performance.now() + 5000;
  while (!predicate()) { assert(performance.now() < deadline); await yieldLoop(); }
}
test('controller failure reporting survives outage and restart with the original scoped episode and no owner credential', async scope => {
  mkdirSync(join(process.cwd(), '.temp'), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), '.temp/failure-report-'));
  const fleetId = randomUUID(), agentId = randomUUID(), reports: unknown[] = [];
  let available = false;
  const server = createServer(async (request, response) => {
    assert.equal(request.url, '/api/fleets/' + fleetId + '/runtime-incidents');
    assert.equal(request.headers.authorization, 'Bearer controller-only');
    let text = ''; for await (const chunk of request) text += String(chunk);
    reports.push(JSON.parse(text)); response.setHeader('Content-Type', 'application/json');
    response.statusCode = available ? 201 : 503;
    response.end(JSON.stringify(available ? { data: { accepted: true }, meta: { requestId: randomUUID() } }
      : { error: { code: 'unavailable', message: 'Temporary coordination outage' }, meta: { requestId: randomUUID() } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup(scope, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address(); assert(address && typeof address === 'object');
  const binding: Binding = { server: 'http://127.0.0.1:' + address.port, owner: '@owner:example.test', fleetKey: 'agreements',
    fleetId, controllerCredential: 'controller-only', request: null, identities: [] };
  const stop = new AbortController();
  let reporter = failureReporter(directory, binding, stop.signal);
  const detail = '🚀'.repeat(2000);
  assert(reporter.record(agentId, 'original-session', new Error(detail)).ok);
  await until(() => reports.length === 1 && reporter.error() !== null);
  await reporter.close();
  const file = join(directory, '.fleet/failures.json'), pending = readJson<unknown[]>(file);
  assert.deepEqual(pending, reports);
  assert.equal((pending[0] as { message: string }).message, '🚀'.repeat(1000));
  available = true; reporter = failureReporter(directory, binding, stop.signal);
  cleanup(scope, async () => { stop.abort(); await reporter.close(); });
  await until(() => reports.length === 2 && readJson<unknown[]>(file).length === 0);
  assert.deepEqual(reports[1], reports[0]);
  assert.equal(reporter.error(), null);
});
