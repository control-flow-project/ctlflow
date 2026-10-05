import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, symlinkSync, linkSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { binaryBytes } from '@ctlflow/crossfire-kernel/bytes';
import { createPublicationStore } from '@ctlflow/crossfire-adapter-filesystem/publication/store';
import { publicationSource } from '@ctlflow/crossfire-adapter-filesystem/publication/source';
import { value } from './support/application.js';

test('private staging resists symlinks, hash drift, partial writes and competing store ownership', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-publication-storage-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const store = createPublicationStore(join(directory, 'store'), 1); cleanup(scope, store.close);
  assert.throws(() => createPublicationStore(join(directory, 'store'), 1), /already owns/u);
  const id = randomUUID(), data = Buffer.from('<p>Report</p>'), file = { id: randomUUID(), publicationId: id, path: 'index.html', mediaType: 'text/html',
    bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), uploaded: true };
  value(await store.upload(id, file, binaryBytes(data), new AbortController().signal)); value(await store.verify(id, [file]));
  const pending = join(directory, 'store', id, '.pending-' + randomUUID()); writeFileSync(pending, 'interrupted private upload', { mode: 0o600 });
  value(await store.verify(id, [file])); assert.equal(readdirSync(join(directory, 'store', id)).some(path => path.startsWith('.pending-')), false);
  const saved = join(directory, 'store', id, file.id), outside = join(directory, 'outside.html'); writeFileSync(outside, data, { mode: 0o600 });
  rmSync(saved); symlinkSync(outside, saved);
  assert.equal((await store.read(id, file)).ok, false); assert.equal((await store.verify(id, [file])).ok, false);
  value(await store.remove(id)); assert.deepEqual(readFileSync(outside), data);
  value(await store.upload(id, file, binaryBytes(data), new AbortController().signal));
  writeFileSync(saved, Buffer.alloc(data.length, 65)); assert.equal((await store.verify(id, [file])).ok, false);
  const partial = { byteLength: data.length, chunks: { async *[Symbol.asyncIterator]() { yield data.subarray(0, 3); throw new Error('disconnected'); } } };
  assert.equal((await store.upload(id, file, partial, new AbortController().signal)).ok, false);
  assert.equal(readdirSync(join(directory, 'store', id)).some(path => path.startsWith('.pending-')), false);
  value(await store.remove(id)); store.close(); const reopened = createPublicationStore(join(directory, 'store'), 1); reopened.close();
});

test('report source streams bounded static files and rejects symlinks, hardlinks, special extensions and change during upload', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-report-source-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, 'index.html'), '<p>Public report</p>'); mkdirSync(join(directory, 'assets'));
  writeFileSync(join(directory, 'assets', 'main.mjs'), 'export const answer = 42;');
  const source = value(await publicationSource(directory)); assert.equal(source.files.length, 2);
  const index = source.files.find(file => file.path === 'index.html')!;
  const received: Uint8Array[] = []; for await (const chunk of source.read(index).chunks) received.push(chunk);
  assert.deepEqual(Buffer.concat(received), readFileSync(join(directory, 'index.html')));
  writeFileSync(join(directory, 'index.html'), 'changed length');
  await assert.rejects(async () => { for await (const chunk of source.read(index).chunks) assert(chunk); }, /changed/u);
  symlinkSync(join(directory, 'index.html'), join(directory, 'link.html')); assert.equal((await publicationSource(directory)).ok, false); rmSync(join(directory, 'link.html'));
  linkSync(join(directory, 'index.html'), join(directory, 'hard.html')); assert.equal((await publicationSource(directory)).ok, false); rmSync(join(directory, 'hard.html'));
  writeFileSync(join(directory, 'archive.zip'), 'not a supported asset'); assert.equal((await publicationSource(directory)).ok, false);
});

test('serialized upload copies stay within twice the reservation and abandoned copies are removed before retry', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-report-budget-'));
  cleanup(scope, () => rmSync(directory, { recursive: true, force: true }));
  const store = createPublicationStore(join(directory, 'store'), 1); cleanup(scope, store.close);
  const id = randomUUID(), data = Buffer.alloc(32768, 65), file = { id: randomUUID(), publicationId: id, path: 'index.html', mediaType: 'text/html',
    bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'), uploaded: true };
  value(await store.upload(id, file, binaryBytes(data), new AbortController().signal));
  const path = join(directory, 'store', id), abandoned = join(path, '.pending-' + randomUUID()); writeFileSync(abandoned, data, { mode: 0o600 });
  let entered!: () => void, proceed!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { proceed = resolve; });
  const input = { byteLength: data.length, chunks: { async *[Symbol.asyncIterator]() { yield data; entered(); await gate; } } };
  const upload = store.exclusive(id, () => store.upload(id, file, input, new AbortController().signal));
  try {
    await started;
    const names = readdirSync(path);
    assert.equal(names.includes(abandoned.slice(path.length + 1)), false);
    assert.equal(names.filter(name => name.startsWith('.pending-')).length, 1);
    assert.equal(names.reduce((bytes, name) => bytes + statSync(join(path, name)).size, 0), 2 * file.bytes);
    const busy = await store.upload(randomUUID(), file, binaryBytes(data), new AbortController().signal);
    assert.equal(busy.ok, false); if (!busy.ok) assert.equal(busy.error.code, 'rate_limit');
  } finally { proceed(); }
  value(await upload); value(await store.verify(id, [file]));
  assert.equal(readdirSync(path).reduce((bytes, name) => bytes + statSync(join(path, name)).size, 0), file.bytes);
});
