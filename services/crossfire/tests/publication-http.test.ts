import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { createClient } from '@crossfire/adapter-crossfire/client';
import { binaryBytes } from '@crossfire/kernel/bytes';
import { operations } from '@crossfire/contracts/rest/operations';
import { deletePublication } from '@crossfire/domain/publication/delete';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';
import { contentFixture, publishFixture, publicationHeaders } from './support/publication.js';

function probe(url: string, method: string, headers: Record<string, string>, body?: Uint8Array): Promise<number> {
  return new Promise((resolve, reject) => {
    const connection = request(url, { method, headers, signal: AbortSignal.timeout(5000) }, response => {
      response.resume(); response.once('end', () => resolve(response.statusCode!)); response.once('error', reject);
    });
    connection.once('error', reject); connection.end(body);
  });
}

test('typed streamed binary REST publishes only committed static bytes on the separate content listener', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher');
  const api = await httpFixture(scope, fixture.application); await contentFixture(scope, fixture.application);
  const report = await publishFixture(api.origin, agent.token, { 'index.html': '<!doctype html><p>Report</p>', 'assets/main.mjs': 'export const answer = 42;', 'data.json': '{"value":42}' });
  const publicResponse = await fetch(report.url!); assert.equal(publicResponse.status, 200); assert.match(await publicResponse.text(), /Report/u);
  assert.equal(publicResponse.headers.get('Access-Control-Allow-Origin'), '*'); assert.equal(publicResponse.headers.get('Access-Control-Allow-Credentials'), null);
  assert.equal(publicResponse.headers.get('Set-Cookie'), null); assert.equal(publicResponse.headers.get('Cache-Control'), 'no-store');
  assert.match(publicResponse.headers.get('Content-Security-Policy')!, /sandbox allow-scripts;/u); assert(!publicResponse.headers.get('Content-Security-Policy')!.includes('allow-same-origin'));
  const asset = await fetch(report.url!.replace('index.html', 'assets/main.mjs')); assert.equal(asset.headers.get('Content-Type'), 'text/javascript');
  const listing = await api.request('/api/publications?pageSize=1', 'GET', undefined, publicationHeaders(api.origin, fixture.admin));
  assert.equal(listing.status, 200); assert.equal((await listing.json() as { meta: { totalItems: number } }).meta.totalItems, 1);
  const deleted = await api.request('/api/publications/' + report.id, 'DELETE', { expectedRevision: report.revision }, publicationHeaders(api.origin, fixture.admin));
  assert.equal(deleted.status, 200); assert.equal((await fetch(report.url!)).status, 404);
});

test('binary uploads reject JSON, omitted length, unbounded declarations and foreign agents on the canonical operation', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher'), other = await fixture.agent(fixture.admin.actor, 'other');
  const api = await httpFixture(scope, fixture.application), client = createClient({ origin: api.origin, token: agent.token }), data = Buffer.from('hello');
  const report = value(await client.call(operations.createPublication, {}, { title: 'Report', files: [{ path: 'index.html', mediaType: 'text/html', bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') }] })).data;
  const path = '/api/publications/' + report.id + '/files/' + report.files[0]!.id;
  assert.equal((await api.request(path, 'PUT', {}, { Authorization: 'Bearer ' + agent.token })).status, 400);
  assert.equal(await probe(api.origin + path, 'PUT', { Authorization: 'Bearer ' + agent.token,
    'Content-Type': 'application/octet-stream', 'Transfer-Encoding': 'chunked' }, data), 400);
  assert.equal(await probe(api.origin + path, 'PUT', { Authorization: 'Bearer ' + agent.token,
    'Content-Type': 'application/octet-stream', 'Content-Length': String(8 * 1024 * 1024 + 1) }), 413);
  const otherClient = createClient({ origin: api.origin, token: other.token });
  assert.equal((await otherClient.call(operations.uploadPublicationFile, { publicationId: report.id, fileId: report.files[0]!.id }, binaryBytes(data))).ok, false);
  assert.equal((await client.call(operations.uploadPublicationFile, { publicationId: report.id, fileId: report.files[0]!.id }, { byteLength: 8 * 1024 * 1024 + 1, chunks: binaryBytes(data).chunks })).ok, false);
  value(await client.call(operations.uploadPublicationFile, { publicationId: report.id, fileId: report.files[0]!.id }, binaryBytes(data)));
});

test('the content service has no APIs, enrollment, credentials, path aliases or arbitrary-host routing', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher'), api = await httpFixture(scope, fixture.application);
  const content = await contentFixture(scope, fixture.application), report = await publishFixture(api.origin, agent.token, { 'index.html': '<p>Public</p>', 'diagram.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>' });
  for (const path of ['/api/health', '/api/publications', '/_matrix/client/v3/sync', '/onboarding/setup', '/config.json']) assert.equal((await fetch(content.origin + path)).status, 404, path);
  assert.equal((await fetch(report.url!, { method: 'POST', body: 'not allowed' })).status, 405);
  assert.equal((await fetch(report.url!, { method: 'HEAD' })).status, 200);
  const svg = await fetch(report.url!.replace('index.html', 'diagram.svg')); assert.equal(svg.status, 200); assert.match(svg.headers.get('Content-Security-Policy')!, /sandbox allow-scripts;/u);
  assert.equal(await probe(report.url!, 'GET', { Host: 'unrelated.example' }), 421);
  const bad = new URL(report.url!); bad.pathname = bad.pathname.replace('index.html', '%2findex.html');
  assert.equal((await fetch(bad)).status, 404);
  assert.equal((await api.request('/api/publications', 'GET', undefined, { ...publicationHeaders(api.origin, fixture.admin), Origin: 'null' })).status, 403);
  assert.equal((await api.request('/api/publications', 'GET', undefined, { ...publicationHeaders(api.origin, fixture.admin), Origin: content.origin })).status, 403);
});

test('owner deletion fences a public read even after its private file descriptor has opened', async scope => {
  const fixture = await applicationFixture(scope), agent = await fixture.agent(fixture.admin.actor, 'publisher');
  const api = await httpFixture(scope, fixture.application); await contentFixture(scope, fixture.application);
  const report = await publishFixture(api.origin, agent.token, { 'index.html': '<p>Public report</p>' });
  const store = fixture.services.publication.store, original = store.read;
  let opened!: () => void, proceed!: () => void;
  const started = new Promise<void>(resolve => { opened = resolve; }), gate = new Promise<void>(resolve => { proceed = resolve; });
  store.read = async (id, file) => { const result = await original(id, file); opened(); await gate; return result; };
  const reading = fetch(report.url!);
  try { await started; value(await deletePublication(fixture.services, fixture.admin.actor, report.id, report.revision, 'fenced-public-read')); }
  finally { proceed(); }
  assert.equal((await reading).status, 404); store.read = original;
});
