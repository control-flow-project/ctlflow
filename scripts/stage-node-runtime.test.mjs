import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { runtimePackages, stageNodeRuntime } from './stage-node-runtime.mjs';

test('runtime staging retains only the declared production closure and built assets', context => {
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-stage-')), root = join(directory, 'source'), output = join(directory, 'runtime');
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(root, 'node_modules/@ctlflow'), { recursive: true });
  for (const file of ['package.json', '.npmrc', 'LICENSE']) writeFileSync(join(root, file), file === 'package.json' ? '{"type":"module"}' : 'fixture');
  const declarations = [
    ['crossfire/node/apps/server', 'crossfire-server', { '@ctlflow/crossfire-domain': '0.1.0', '@ctlflow/crossfire-data': '0.1.0' }],
    ['crossfire/node/packages/domain', 'crossfire-domain', {}],
    ['crossfire/node/packages/test-support', 'crossfire-test-support', {}],
    ['crossfire/apps/web', 'crossfire-web', {}],
    ['crossfire/database', 'crossfire-data', {}],
  ];
  for (const [path, name, dependencies] of declarations) {
    const destination = join(root, 'services', path); mkdirSync(join(destination, 'src'), { recursive: true }); mkdirSync(join(destination, 'dist'));
    writeFileSync(join(destination, 'package.json'), JSON.stringify({ name: '@ctlflow/' + name, dependencies, devDependencies: { '@ctlflow/crossfire-test-support': '0.1.0' } }));
    writeFileSync(join(destination, 'LICENSE'), 'fixture'); writeFileSync(join(destination, 'src/source.ts'), 'authored'); writeFileSync(join(destination, 'dist/module.js'), 'compiled');
    symlinkSync(relative(join(root, 'node_modules/@ctlflow'), destination), join(root, 'node_modules/@ctlflow', name));
  }
  mkdirSync(join(root, 'services/crossfire/database/management'), { recursive: true }); writeFileSync(join(root, 'services/crossfire/database/management/schema.json'), '{}');
  for (const path of ['apps/server', 'web', 'onboarding', 'tests']) { mkdirSync(join(root, 'services/crossfire/dist', path), { recursive: true }); writeFileSync(join(root, 'services/crossfire/dist', path, 'fixture'), 'fixture'); }
  assert.deepEqual(runtimePackages(root).map(owner => owner.manifest.name).sort(), ['@ctlflow/crossfire-data', '@ctlflow/crossfire-domain', '@ctlflow/crossfire-server']);
  stageNodeRuntime(root, output);
  for (const path of ['node_modules/@ctlflow/crossfire-domain/dist/module.js', 'services/crossfire/database/management/schema.json', 'services/crossfire/dist/apps/server/fixture', 'services/crossfire/dist/web/fixture']) assert(existsSync(join(output, path)), path);
  for (const path of ['services/crossfire/node/packages/domain/src', 'services/crossfire/apps/web', 'services/crossfire/dist/tests', 'node_modules/@ctlflow/crossfire-test-support', 'node_modules/@ctlflow/crossfire-web', 'services/crossfire/csharp']) assert(!existsSync(join(output, path)), path);
  assert.throws(() => stageNodeRuntime(root, output), /new absolute/u);
  writeFileSync(join(root, 'services/crossfire/node/packages/domain/package.json'), '{"name":"@ctlflow/crossfire-domain","dependencies":{"@ctlflow/missing":"0.1.0"}}');
  assert.throws(() => runtimePackages(root), /Missing runtime package owner/u);
});
