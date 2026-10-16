import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { fileOwner, inventory } from './native-file-inventory.mjs';

test('per-file inventory names every language owner without pretending shared assets are ports', () => {
  const value = inventory();
  assert.deepEqual(Object.keys(value.totals).sort(), ['crossfire/csharp', 'crossfire/node', 'fleet/csharp', 'fleet/node', 'fleetd/csharp', 'fleetd/node']);
  assert.equal(new Set(value.files.map(row => row.file)).size, value.files.length);
  assert.equal(Object.values(value.totals).reduce((sum, total) => sum + total, 0), value.files.length);
  for (const row of value.files) {
    assert(row.bytes > 0 && row.lines > 0);
    assert.match(row.sha256, /^[a-f0-9]{64}$/u);
    assert(row.disposition && row.counterpart);
    assert(Array.isArray(row.symbols));
  }
  assert(value.rustFiles > 0);
  assert.match(value.basis, /not behavioral certification/u);
  const map = ['file\tcounterpart\tdisposition', ...value.files.map(row => [row.file, row.counterpart, row.disposition].join('\t'))].join('\n') + '\n';
  assert.equal(readFileSync(new URL('../docs/architecture/native-file-map.tsv', import.meta.url), 'utf8'), map, 'The reviewed per-file map must cover the complete current source set');
});

test('file associations reject new unreviewed owners and retain concrete framework boundaries', () => {
  assert.equal(fileOwner('services/crossfire/csharp/packages/Crossfire.AdapterProcess/NativeProcess.cs')[1], 'services/crossfire/rust/packages/adapter-process');
  assert.equal(fileOwner('services/fleetd/node/packages/adapter-execution/src/execution.ts')[1], 'services/fleetd/rust/packages/adapter-execution');
  assert.equal(fileOwner('services/fleet/node/apps/cli/src/main.ts')[1], 'services/fleet/rust/apps/cli');
  assert.equal(fileOwner('services/crossfire/node/packages/agent-tools/src/message-envelope.ts')[1], 'services/crossfire/node/packages/agent-tools');
  assert.equal(fileOwner('services/crossfire/csharp/build/Crossfire.EfCompiler/Program.cs')[1], 'services/crossfire/scripts/generate-rust-schema.mjs');
  assert.throws(() => fileOwner('services/crossfire/node/packages/hidden-fallback/src/main.ts'), /explicit semantic owner/u);
  assert.throws(() => fileOwner('services/crossfire/csharp/legacy/Server.cs'), /Unclassified file/u);
});
