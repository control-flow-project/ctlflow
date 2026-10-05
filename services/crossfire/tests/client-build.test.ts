import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { buildClient } from '../scripts/build-client.js';

test('the native Pi artifact exposes its required factory without a default product-source export', async scope => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-client-build-'));
  scope.after(() => rmSync(directory, { recursive: true }));
  await buildClient(process.cwd(), join(directory, 'crossfire-client.mjs'));
  const native = await import(pathToFileURL(join(directory, 'crossfire-pi.mjs')).href) as Record<string, unknown>;
  assert.deepEqual(Object.keys(native), ['default']);
  assert.equal(typeof native.default, 'function');
  assert.equal(typeof native.default === 'function' && native.default.name, 'piExtension');
});
