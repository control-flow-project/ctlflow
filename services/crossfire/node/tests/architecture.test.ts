import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { auditSource, imports, type PackageManifest } from './support/architecture.js';

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => ['node_modules', 'dist', 'bin', 'obj', 'target', '.temp'].includes(entry.name) ? []
    : entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

function workspaceManifests(root: string): Map<string, PackageManifest> {
  const owners = ['crossfire', 'fleetd', 'fleet'].flatMap(service => ['apps', 'node/apps', 'node/packages'].flatMap(folder =>
    !existsSync(join(root, 'services', service, folder)) ? [] :
    readdirSync(join(root, 'services', service, folder)).map(name => join('services', service, folder, name))
      .filter(owner => existsSync(join(root, owner, 'package.json')))));
  return new Map(owners.map(owner => [owner, JSON.parse(readFileSync(join(root, owner, 'package.json'), 'utf8')) as PackageManifest]));
}

test('all services have one strict implementation and declared package-export boundaries', () => {
  const root = resolve(process.cwd(), '../..');
  const manifests = workspaceManifests(root), owners = [...manifests.keys()];
  for (const owner of owners) {
    for (const file of files(join(root, owner, 'src')).filter(file => /\.tsx?$/u.test(file))) {
      const failures = auditSource(root, owner, file, readFileSync(file, 'utf8'), manifests);
      assert.equal(failures.length === 0, true, relative(root, file) + ': ' + failures.join('; '));
    }
    if (owner.includes('/packages/')) assert(manifests.get(owner)!.exports, 'Package must expose its supported entry points: ' + owner);
  }
  const dependencies = (service: string, name: string) => Object.keys(manifests.get('services/' + service + '/node/packages/' + name)!.dependencies ?? {});
  assert.deepEqual(dependencies('crossfire', 'domain'), ['@ctlflow/crossfire-kernel']);
  assert.deepEqual(dependencies('crossfire', 'agent-core').sort(), ['@ctlflow/crossfire-contracts', '@ctlflow/crossfire-domain', '@ctlflow/crossfire-kernel']);
  assert.deepEqual(dependencies('crossfire', 'contracts').sort(), ['@ctlflow/crossfire-domain', '@ctlflow/crossfire-kernel', 'smol-toml']);
  for (const name of ['files', 'matrix']) assert.equal(files(join(root, 'services/crossfire/node/packages', name, 'src')).length, 0);
  for (const manifest of manifests.values()) if (manifest.name.startsWith('@ctlflow/crossfire-')) {
    assert(!Object.keys(manifest.dependencies ?? {}).some(name => /^@ctlflow\/(?:fleet|fleetd)(?:-|$)/u.test(name)));
  }
});

test('generic messaging owners in every target contain no Matrix protocol or historical schema fields', () => {
  const root = resolve(process.cwd(), '../..');
  const owners = [
    ...['kernel', 'domain', 'agent-core', 'contracts', 'client'].map(owner => 'services/crossfire/node/packages/' + owner + '/src'),
    ...['Crossfire.Kernel', 'Crossfire.Domain', 'Crossfire.AgentCore', 'Crossfire.Contracts', 'Crossfire.AdapterHttp'].map(owner => 'services/crossfire/csharp/packages/' + owner),
    ...['kernel', 'domain', 'agent-core', 'contracts', 'adapter-http'].map(owner => 'services/crossfire/rust/packages/' + owner + '/src'),
    ...['domain', 'contracts'].map(owner => 'services/fleetd/node/packages/' + owner + '/src'),
    ...['Fleetd.Domain', 'Fleetd.Contracts'].map(owner => 'services/fleetd/csharp/packages/' + owner),
    ...['domain', 'contracts'].map(owner => 'services/fleetd/rust/packages/' + owner + '/src'),
    'services/fleet/node/packages/daemon-client/src',
    'services/fleet/csharp/packages/Fleet.DaemonClient',
    'services/fleet/rust/packages/daemon-client/src',
    'services/crossfire/node/apps/server/src/http',
    'services/crossfire/csharp/apps/Crossfire.Server/Http',
    'services/crossfire/rust/apps/server/src/http',
    'services/crossfire/apps/web/src',
  ];
  const forbidden = ['/_matrix', '"m.room.', "'m.room.", '"m.mentions', "'m.mentions", 'matrix_user_id', 'sender_matrix_id', 'claim_matrix_user_id', 'power_level', 'powerLevel', 'PowerLevel', '^@'];
  for (const owner of owners) {
    assert(existsSync(join(root, owner)), 'Architecture verification requires its declared owner: ' + owner);
    for (const file of files(join(root, owner)).filter(file => /\.(tsx?|cs|rs)$/u.test(file))) {
      const source = readFileSync(file, 'utf8');
      for (const literal of forbidden) assert.equal(source.includes(literal), false, relative(root, file) + ': native or historical field ' + literal);
      assert.equal(/\b(?:Matrix[A-Za-z_]*|matrix|matrixId)\b/u.test(source), false, relative(root, file) + ': use neutral messaging names');
    }
  }
  const schema = readFileSync(join(root, 'services/crossfire/database/management/sqlite/schema.json'), 'utf8');
  for (const field of ['matrix_user_id', 'sender_matrix_id', 'claim_matrix_user_id', 'power_level']) assert.equal(schema.includes(field), false, field);
  for (const file of ['services/crossfire/node/packages/adapter-codex/src/context-migration.ts',
    'services/crossfire/csharp/packages/Crossfire.AdapterCodex/ContextMigration.cs',
    'services/crossfire/rust/packages/adapter-codex/src/context_migration.rs',
    'services/fleetd/node/tools/observation-migration.ts']) assert.equal(existsSync(join(root, file)), false, 'No historical converter: ' + file);
});

test('all TOML dependency owners lock one patched parser', () => {
  const root = resolve(process.cwd(), '../..');
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string; dependencies?: Record<string, string> }>;
  };
  for (const owner of ['crossfire/node/packages/contracts', 'crossfire/node/packages/adapter-codex',
    'fleetd/node/packages/contracts', 'fleetd/node/packages/storage']) {
    const path = 'services/' + owner;
    const manifest = JSON.parse(readFileSync(join(root, path, 'package.json'), 'utf8')) as PackageManifest;
    assert.equal(manifest.dependencies?.['smol-toml'], '1.9.0', path);
    assert.equal(lock.packages[path]?.dependencies?.['smol-toml'], '1.9.0', path + ' lock');
  }
  assert.deepEqual(Object.keys(lock.packages).filter(path => path.endsWith('node_modules/smol-toml')),
    ['node_modules/smol-toml']);
  assert.equal(lock.packages['node_modules/smol-toml']?.version, '1.9.0');
  const installed = JSON.parse(readFileSync(join(root, 'node_modules/smol-toml/package.json'), 'utf8')) as { version: string };
  assert.equal(installed.version, lock.packages['node_modules/smol-toml']?.version, 'Installed parser matches the lock');
});

test('the locked source-map dependency rejects unsafe indexed offsets without blocking its caller', () => {
  const root = resolve(process.cwd(), '../..');
  const lock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')) as {
    packages: Record<string, { version?: string }>;
  };
  assert.deepEqual(Object.keys(lock.packages).filter(path => path.endsWith('node_modules/source-map-js')),
    ['node_modules/source-map-js']);
  assert.equal(lock.packages['node_modules/source-map-js']?.version, '1.2.2');
  const installed = JSON.parse(readFileSync(join(root, 'node_modules/source-map-js/package.json'), 'utf8')) as { version: string };
  assert.equal(installed.version, lock.packages['node_modules/source-map-js']?.version, 'Installed source-map parser matches the lock');
  const probe = spawnSync(process.execPath, ['--input-type=commonjs', '--eval', `
    const assert = require('node:assert/strict');
    const { SourceMapConsumer } = require('node:module').createRequire(require.resolve('postcss'))('source-map-js');
    const basic = { version: 3, sources: ['input.js'], names: [], mappings: 'AAAA' };
    const indexed = (line, map = basic) => ({ version: 3, sections: [{ offset: { line, column: 0 }, map }] });
    for (const line of [Infinity, -1, 0.5, '1', 10000001])
      assert.throws(() => new SourceMapConsumer(indexed(line)), /Section offset/);
    assert.throws(() => new SourceMapConsumer(indexed(6000000, indexed(6000000))), /including offsets of nested sections/);
    const consumer = new SourceMapConsumer(indexed(2));
    assert.deepEqual(consumer.generatedPositionFor({ source: 'input.js', line: 1, column: 0 }),
      { line: 3, column: 0 });
  `], { cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
  assert.equal(probe.status, 0, probe.error?.message ?? probe.stderr);
});

test('every import form is inspected, including erased types, exports and current ESM literals', () => {
  const forms = ["import type { Value } from '@missing/value';", "export type { Value } from '@missing/value';",
    "export * from '@missing/value';", "const value = import('@missing/value');",
    "type Value = import('@missing/value').Value;", "type Value = typeof import('@missing/value');",
    "import value = require('@missing/value');", "const value = require('@missing/value');",
    "const value = import(`@missing/value`);"];
  for (const text of forms) {
    const source = ts.createSourceFile('negative.ts', text, ts.ScriptTarget.Latest, true);
    assert.equal(imports(source).dependencies.some(dependency => dependency.name === '@missing/value'), true, text);
  }
  for (const text of ['import(variable);', 'type Value = any;', 'const Value = class {};', 'export default function value() {}', 'export { value as default };']) {
    assert.equal(imports(ts.createSourceFile('negative.ts', text, ts.ScriptTarget.Latest, true)).failures.length > 0, true, text);
  }
});

test('the common UI and HTTP client reject backend and native-platform dependencies', () => {
  const root = resolve(process.cwd(), '../..');
  const manifests = workspaceManifests(root);
  for (const owner of ['services/crossfire/apps/web', 'services/crossfire/node/packages/client']) {
    const file = join(root, owner, 'src/negative.ts');
    for (const [text, violation] of [
      ["import { value } from 'node:fs';", 'Pure domain/value/contracts and browser layers cannot import native platform APIs: node:fs'],
      ["type Value = import('@ctlflow/crossfire-adapter-matrix/http').Native;", 'Shared browser/client code cannot depend on backend implementations: @ctlflow/crossfire-adapter-matrix/http'],
      ["import { openStore } from '@ctlflow/crossfire-adapter-sqlite/open-store';", 'Shared browser/client code cannot depend on backend implementations: @ctlflow/crossfire-adapter-sqlite/open-store'],
    ] as const)
      assert.equal(auditSource(root, owner, file, text, manifests).includes(violation), true, owner + ':' + violation);
  }
  for (const file of ['src/client.ts', 'src/binary-request.ts']) {
    const owner = 'services/crossfire/node/packages/client', path = join(root, owner, file);
    assert.deepEqual(auditSource(root, owner, path, readFileSync(path, 'utf8'), manifests), []);
  }
  for (const file of ['client.ts', 'binary-request.ts']) assert.equal(existsSync(join(root, 'services/crossfire/node/packages/adapter-crossfire/src', file)), false);
  assert.equal(existsSync(join(root, 'services/crossfire/node/packages/client/src/matrix-login.ts')), false);
  assert.equal(existsSync(join(root, 'services/crossfire/node/packages/adapter-matrix/src/browser-session.ts')), false);
});

test('declared dependencies cannot bypass semantic domain direction or package-export ownership', () => {
  const root = resolve(process.cwd(), '../..'), owner = 'services/fleetd/node/packages/domain';
  const manifests = new Map<string, PackageManifest>([
    [owner, { name: '@ctlflow/fleetd-domain', dependencies: { '@ctlflow/crossfire-contracts': '0.1.0', '@ctlflow/crossfire-domain': '0.1.0', '@ctlflow/crossfire-adapter-sqlite': '0.1.0' } }],
    ['services/crossfire/node/packages/contracts', { name: '@ctlflow/crossfire-contracts', exports: { './*': { source: './src/*.ts' } } }],
    ['services/crossfire/node/packages/domain', { name: '@ctlflow/crossfire-domain', exports: { './*': { source: './src/*.ts' } } }],
    ['services/crossfire/node/packages/adapter-sqlite', { name: '@ctlflow/crossfire-adapter-sqlite', exports: { './*': { source: './src/*.ts' } } }],
  ]);
  const file = join(root, owner, 'src/negative.ts');
  for (const text of ["type Value = import('@ctlflow/crossfire-contracts/runtime').ListenerOptions;",
    "import { createStore } from '@ctlflow/crossfire-adapter-sqlite/store';",
    "import { introduceEnrollment } from '@ctlflow/crossfire-domain/enrollment/introduce';",
    "type Value = import('@ctlflow/crossfire-domain/not-a-real-export').Value;",
    "type Value = import('@missing/package').Value;",
    "import { value } from '../../../../crossfire/packages/domain/src/identity/types.js';"])
    assert.equal(auditSource(root, owner, file, text, manifests).length > 0, true, text);
  assert.equal(auditSource(root, owner, file, "import type { CoordinationPolicy } from '@ctlflow/crossfire-domain/coordination/values';", manifests).length === 0, true);
});

test('domain imports pure core ports but rejects executable helpers even when those helpers import nothing', scope => {
  const root = mkdtempSync(join(tmpdir(), 'architecture-direction-')); scope.after(() => rmSync(root, { recursive: true }));
  const owner = 'services/fleetd/node/packages/domain', core = 'services/crossfire/node/packages/agent-core';
  const source = join(root, core, 'src'); mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'helper.ts'), "export function helper() { return new Error('effect'); }");
  writeFileSync(join(source, 'computed.ts'), "export const values = { [Date.now()]: 1 };");
  writeFileSync(join(source, 'destructured.ts'), "export const { value = Date.now() } = {};");
  writeFileSync(join(source, 'runtime.ts'), "export type NativeSessionState = { context: string; state: 'idle' | 'working' };\n");
  const manifests = new Map<string, PackageManifest>([
    [owner, { name: '@ctlflow/fleetd-domain', dependencies: { '@ctlflow/crossfire-agent-core': '0.1.0' } }],
    [core, { name: '@ctlflow/crossfire-agent-core', exports: { './*': { source: './src/*.ts' } } }],
  ]);
  const file = join(root, owner, 'src/negative.ts');
  for (const text of ["import { helper } from '@ctlflow/crossfire-agent-core/helper';", "type Helper = typeof import('@ctlflow/crossfire-agent-core/helper');",
    "export * from '@ctlflow/crossfire-agent-core/helper';", "import('@ctlflow/crossfire-agent-core/helper');",
    "import { values } from '@ctlflow/crossfire-agent-core/computed';", "import { value } from '@ctlflow/crossfire-agent-core/destructured';"])
    assert.equal(auditSource(root, owner, file, text, manifests).some(failure => failure.includes('pure core ports')), true, text);
  for (const text of ["import type { NativeSessionState } from '@ctlflow/crossfire-agent-core/runtime';", "type State = import('@ctlflow/crossfire-agent-core/runtime').NativeSessionState;"])
    assert.equal(auditSource(root, owner, file, text, manifests).length === 0, true, text);
  const contracts = 'services/crossfire/node/packages/contracts';
  manifests.set(contracts, { name: '@ctlflow/crossfire-contracts', dependencies: { '@ctlflow/crossfire-agent-core': '0.1.0' } });
  assert.equal(auditSource(root, contracts, join(root, contracts, 'src/negative.ts'),
    "type State = import('@ctlflow/crossfire-agent-core/runtime').NativeSessionState;", manifests)
    .some(failure => failure.includes('Wire contracts cannot depend on runtime ports')), true);
});
