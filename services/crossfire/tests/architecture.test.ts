import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { auditSource, imports, type PackageManifest } from './support/architecture.js';

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => ['node_modules', 'dist'].includes(entry.name) ? []
    : entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test('all services have one strict implementation and declared package-export boundaries', () => {
  const root = resolve(process.cwd(), '../..');
  const owners = ['crossfire', 'fleetd', 'fleet'].flatMap(service => ['apps', 'packages'].flatMap(folder =>
    readdirSync(join(root, 'services', service, folder)).map(name => join('services', service, folder, name))
      .filter(owner => existsSync(join(root, owner, 'package.json')))));
  const manifests = new Map(owners.map(owner => [owner, JSON.parse(readFileSync(join(root, owner, 'package.json'), 'utf8')) as PackageManifest]));
  for (const owner of owners) {
    for (const file of files(join(root, owner, 'src')).filter(file => /\.tsx?$/u.test(file))) {
      const failures = auditSource(root, owner, file, readFileSync(file, 'utf8'), manifests);
      assert.equal(failures.length === 0, true, relative(root, file) + ': ' + failures.join('; '));
    }
    if (owner.includes('/packages/')) assert(manifests.get(owner)!.exports, 'Package must expose its supported entry points: ' + owner);
  }
  const dependencies = (service: string, name: string) => Object.keys(manifests.get('services/' + service + '/packages/' + name)!.dependencies ?? {});
  assert.deepEqual(dependencies('crossfire', 'domain'), ['@crossfire/kernel']);
  assert.deepEqual(dependencies('crossfire', 'agent-core').sort(), ['@crossfire/contracts', '@crossfire/kernel']);
  assert.deepEqual(dependencies('crossfire', 'contracts').sort(), ['@crossfire/domain', '@crossfire/kernel', 'smol-toml']);
  for (const name of ['files', 'matrix']) assert.equal(files(join(root, 'services/crossfire/packages', name, 'src')).length, 0);
  for (const manifest of manifests.values()) if (manifest.name.startsWith('@crossfire/')) {
    assert(!Object.keys(manifest.dependencies ?? {}).some(name => name.startsWith('@fleet')));
  }
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

test('declared dependencies cannot bypass semantic domain direction or package-export ownership', () => {
  const root = resolve(process.cwd(), '../..'), owner = 'services/fleetd/packages/domain';
  const manifests = new Map<string, PackageManifest>([
    [owner, { name: '@fleetd/domain', dependencies: { '@crossfire/contracts': '0.1.0', '@crossfire/domain': '0.1.0', '@crossfire/adapter-sqlite': '0.1.0' } }],
    ['services/crossfire/packages/contracts', { name: '@crossfire/contracts', exports: { './*': { source: './src/*.ts' } } }],
    ['services/crossfire/packages/domain', { name: '@crossfire/domain', exports: { './*': { source: './src/*.ts' } } }],
    ['services/crossfire/packages/adapter-sqlite', { name: '@crossfire/adapter-sqlite', exports: { './*': { source: './src/*.ts' } } }],
  ]);
  const file = join(root, owner, 'src/negative.ts');
  for (const text of ["type Value = import('@crossfire/contracts/runtime').ListenerOptions;",
    "import { createStore } from '@crossfire/adapter-sqlite/store';",
    "import { introduceEnrollment } from '@crossfire/domain/enrollment/introduce';",
    "type Value = import('@crossfire/domain/not-a-real-export').Value;",
    "type Value = import('@missing/package').Value;",
    "import { value } from '../../../crossfire/packages/domain/src/identity/types.js';"])
    assert.equal(auditSource(root, owner, file, text, manifests).length > 0, true, text);
  assert.equal(auditSource(root, owner, file, "import type { CoordinationPolicy } from '@crossfire/domain/coordination/values';", manifests).length === 0, true);
});

test('domain imports pure core ports but rejects executable helpers even when those helpers import nothing', scope => {
  const root = mkdtempSync(join(tmpdir(), 'architecture-direction-')); scope.after(() => rmSync(root, { recursive: true }));
  const owner = 'services/fleetd/packages/domain', core = 'services/crossfire/packages/agent-core';
  const source = join(root, core, 'src'); mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'helper.ts'), "export function helper() { return new Error('effect'); }");
  writeFileSync(join(source, 'computed.ts'), "export const values = { [Date.now()]: 1 };");
  writeFileSync(join(source, 'destructured.ts'), "export const { value = Date.now() } = {};");
  writeFileSync(join(source, 'runtime.ts'), "export type NativeSessionState = { context: string; state: 'idle' | 'working' };\n");
  const manifests = new Map<string, PackageManifest>([
    [owner, { name: '@fleetd/domain', dependencies: { '@crossfire/agent-core': '0.1.0' } }],
    [core, { name: '@crossfire/agent-core', exports: { './*': { source: './src/*.ts' } } }],
  ]);
  const file = join(root, owner, 'src/negative.ts');
  for (const text of ["import { helper } from '@crossfire/agent-core/helper';", "type Helper = typeof import('@crossfire/agent-core/helper');",
    "export * from '@crossfire/agent-core/helper';", "import('@crossfire/agent-core/helper');",
    "import { values } from '@crossfire/agent-core/computed';", "import { value } from '@crossfire/agent-core/destructured';"])
    assert.equal(auditSource(root, owner, file, text, manifests).some(failure => failure.includes('pure core ports')), true, text);
  for (const text of ["import type { NativeSessionState } from '@crossfire/agent-core/runtime';", "type State = import('@crossfire/agent-core/runtime').NativeSessionState;"])
    assert.equal(auditSource(root, owner, file, text, manifests).length === 0, true, text);
  const contracts = 'services/crossfire/packages/contracts';
  manifests.set(contracts, { name: '@crossfire/contracts', dependencies: { '@crossfire/agent-core': '0.1.0' } });
  assert.equal(auditSource(root, contracts, join(root, contracts, 'src/negative.ts'),
    "type State = import('@crossfire/agent-core/runtime').NativeSessionState;", manifests)
    .some(failure => failure.includes('Wire contracts cannot depend on runtime ports')), true);
});
