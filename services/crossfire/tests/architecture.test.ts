import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

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
  const manifests = new Map(owners.map(owner => [owner, JSON.parse(readFileSync(join(root, owner, 'package.json'), 'utf8')) as {
    name: string; dependencies?: Record<string, string>; exports?: Record<string, unknown>;
  }]));
  for (const owner of owners) {
    const allowed = manifests.get(owner)!.dependencies ?? {};
    for (const file of files(join(root, owner, 'src')).filter(file => /\.tsx?$/u.test(file))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function dependency(name: string) {
        if (name.startsWith('.')) {
          assert(/\.(js|json|css)$/u.test(name), 'Explicit runtime import: ' + name);
          const target = relative(root, resolve(dirname(file), name)).split('/').slice(0, 4).join('/');
          assert.equal(target, owner, 'Use package exports instead of source reach-through: ' + file + ' → ' + name);
        } else if (!name.startsWith('node:')) {
          const packageName = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!;
          assert(Object.hasOwn(allowed, packageName), owner + ' must declare ' + packageName);
        }
      }
      function visit(node: ts.Node): void {
        assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, 'No any in ' + relative(root, file));
        assert(!ts.isClassDeclaration(node), 'Functional module required: ' + relative(root, file));
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) dependency(node.moduleSpecifier.text);
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) dependency(node.arguments[0].text);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
    if (owner.includes('/packages/')) assert(manifests.get(owner)!.exports, 'Package must expose its supported entry points: ' + owner);
  }
  const dependencies = (service: string, name: string) => Object.keys(manifests.get('services/' + service + '/packages/' + name)!.dependencies ?? {});
  assert.deepEqual(dependencies('crossfire', 'domain'), ['@crossfire/kernel']);
  assert.deepEqual(dependencies('crossfire', 'agent-core').sort(), ['@crossfire/contracts', '@crossfire/kernel']);
  assert.deepEqual(dependencies('crossfire', 'contracts').sort(), ['@crossfire/kernel', 'smol-toml']);
  for (const name of ['files', 'matrix']) assert.equal(files(join(root, 'services/crossfire/packages', name, 'src')).length, 0);
  for (const manifest of manifests.values()) if (manifest.name.startsWith('@crossfire/')) {
    assert(!Object.keys(manifest.dependencies ?? {}).some(name => name.startsWith('@fleet')));
  }
});
