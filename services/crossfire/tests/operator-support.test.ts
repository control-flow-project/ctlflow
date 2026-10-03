import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, chmodSync, symlinkSync, lstatSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanup } from '@crossfire/test-support/cleanup';
import { options, inputFile } from '@crossfire/operator-support/command';
import { fingerprint, fingerprintPlan, verifyFingerprints } from '@crossfire/operator-support/files';
import { fetchBytes } from '@crossfire/operator-support/http';
import { verifySource } from '@crossfire/operator-support/process';
import { collectPages } from '@crossfire/operator-support/collections';
import { inspect } from '../tools/main.js';
import { verifyArchive, hostPlan } from '../tools/host.js';
import { success } from '@crossfire/kernel/result';
import { value } from './support/application.js';
import { randomUUID } from 'node:crypto';

test('operator inputs are strict/private and output accepts canonical option syntax', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-operator-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, 'private.json'), plan = join(directory, 'plan.json'), output = join(directory, 'report.json');
  writeFileSync(file, '{}', { mode: 0o600 });
  const hash = value(fingerprint(file));
  writeFileSync(plan, JSON.stringify({ files: [{ path: file, private: true, sha256: hash.sha256 }] }), { mode: 0o600 });
  assert(inputFile(plan, fingerprintPlan).ok);
  value(await inspect(['files', '--plan=' + plan, '--output=' + output], new AbortController().signal));
  assert.equal(lstatSync(output).mode & 0o777, 0o600);
  assert(JSON.parse(readFileSync(output, 'utf8')).files[0].sha256 === hash.sha256);
  assert.equal(options(['--plan', plan, '--plan', plan], ['plan']).ok, false);
  assert.equal(options(['--unknown', 'x'], ['plan']).ok, false);
  assert.equal(options(['--plan', plan, 'positional'], ['plan']).ok, false);
  assert.equal(options([], ['plan']).ok, false);
  const linked = join(directory, 'linked'); symlinkSync(file, linked);
  assert.equal(fingerprint(linked).ok, false);
  assert.equal(inputFile(linked, fingerprintPlan).ok, false);
  chmodSync(plan, 0o644); assert.equal(inputFile(plan, fingerprintPlan).ok, false);
  chmodSync(file, 0o644); assert.equal(fingerprint(file).ok, false);
  assert(fingerprint(file, false).ok);
  writeFileSync(file, 'changed'); chmodSync(file, 0o600);
  assert.equal(verifyFingerprints({ files: [{ path: file, private: true, sha256: hash.sha256 }] }).ok, false);
  assert.equal(hostPlan({ container: '--format=bad', image: 'safe' }).ok, false);
  assert.equal(hostPlan({ container: 'safe', image: '--bad' }).ok, false);
});

test('operator HTTP confines origin, refuses redirects, bounds streams and respects cancellation', async scope => {
  const server = createServer((request, response) => {
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/ok' }); response.end(); }
    else { response.writeHead(200); response.end(request.url === '/large' ? 'x'.repeat(100) : 'ok'); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  cleanup(scope, async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const origin = 'http://127.0.0.1:' + address.port, signal = new AbortController().signal;
  assert.equal(value(await fetchBytes(origin, '/ok', 2, signal)).toString(), 'ok');
  for (const path of ['/redirect', '/large', '//other.test/secret', '/bad\\path']) assert.equal((await fetchBytes(origin, path, 2, signal)).ok, false);
  assert.equal((await fetchBytes('http://example.test', '/ok', 2, signal)).ok, false);
  assert.equal((await fetchBytes(origin, '/ok', 0, signal)).ok, false);
  assert.equal((await fetchBytes(origin, '/ok', 2, AbortSignal.abort())).ok, false);
});

test('operator pagination visits all pages and rejects changing totals, omissions and repeated identities', async () => {
  const items = Array.from({ length: 205 }, (_, index) => index), requested: number[] = [];
  const read = async (query: URLSearchParams) => {
    const page = Number(query.get('page')); requested.push(page);
    return success({ data: items.slice((page - 1) * 100, page * 100), meta: { requestId: randomUUID(), page, pageSize: 100, totalItems: 205, totalPages: 3 } });
  };
  assert.deepEqual(value(await collectPages(read, item => item)), items); assert.deepEqual(requested, [1, 2, 3]);
  assert.equal((await collectPages(async query => { const page = value(await read(query)); return success({ ...page, meta: { ...page.meta, totalItems: page.meta.page === 2 ? 206 : 205 } }); }, item => item)).ok, false);
  assert.equal((await collectPages(async query => { const page = value(await read(query)); return success({ ...page, data: [] }); }, item => item)).ok, false);
  assert.equal((await collectPages(async query => { const page = value(await read(query)); return success({ ...page, data: page.data.map(() => 1) }); }, item => item)).ok, false);
});

test('operator source and archive checks preserve bytes and refuse mismatched identities', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-source-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', directory]);
  writeFileSync(join(directory, 'README.md'), 'fixture');
  execFileSync('git', ['-C', directory, 'add', 'README.md']);
  execFileSync('git', ['-C', directory, '-c', 'user.name=fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
  const checked = value(await verifySource(directory, undefined, undefined, new AbortController().signal));
  assert.equal((await verifySource(directory, '0'.repeat(40), undefined, new AbortController().signal)).ok, false);
  assert.equal((await verifySource(directory, 'short', undefined, new AbortController().signal)).ok, false);
  assert.equal((await verifySource(directory, '0'.repeat(41), undefined, new AbortController().signal)).ok, false);
  value(await verifySource(directory, checked.revision, checked.tree, new AbortController().signal));
  const archive = join(directory, 'backup.tar.gz');
  execFileSync('tar', ['-czf', archive, '-C', directory, 'README.md']); chmodSync(archive, 0o600);
  const bytes = readFileSync(archive), digest = value(fingerprint(archive));
  assert.equal(value(await verifyArchive(archive, digest.sha256, new AbortController().signal)).extracted, false);
  assert.equal((await verifyArchive(archive, '0'.repeat(64), new AbortController().signal)).ok, false);
  assert.deepEqual(readFileSync(archive), bytes);
  assert.equal((await verifySource(directory, undefined, undefined, new AbortController().signal)).ok, false);
});
