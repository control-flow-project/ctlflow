import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import ts from 'typescript';

function files(directory: string): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.name === 'node_modules' ? []
    : entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]);
}

test('workspaces have one strict implementation and only declared dependency directions', () => {
  const root = process.cwd();
  const owners = ['apps', 'packages'].flatMap(folder => readdirSync(join(root, folder)).map(name => folder + '/' + name));
  const manifests = new Map(owners.map(owner => [owner, JSON.parse(readFileSync(join(root, owner, 'package.json'), 'utf8')) as {
    name: string; dependencies?: Record<string, string>;
  }]));
  for (const owner of owners) {
    const allowed = manifests.get(owner)!.dependencies ?? {};
    for (const file of files(join(root, owner, 'src')).filter(file => /\.tsx?$/u.test(file))) {
      const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, 'No any in ' + relative(root, file));
        assert(!ts.isClassDeclaration(node), 'Functional module required: ' + relative(root, file));
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
          const name = node.moduleSpecifier.text;
          if (name.startsWith('.')) {
            assert(/\.(js|json|css)$/u.test(name), 'Explicit runtime import: ' + name);
            const target = relative(root, resolve(dirname(file), name)).split('/').slice(0, 2).join('/');
            assert(manifests.has(target), 'Production import escapes workspace ownership: ' + name);
            if (target !== owner) assert(Object.hasOwn(allowed, manifests.get(target)!.name), owner + ' cannot import ' + target);
          } else if (!name.startsWith('node:')) {
            const dependency = name.startsWith('@') ? name.split('/').slice(0, 2).join('/') : name.split('/')[0]!;
            assert(Object.hasOwn(allowed, dependency), owner + ' must declare ' + dependency);
          }
        }
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  for (const path of ['src', 'skills/conduit-chat/scripts']) assert.deepEqual(files(join(root, path)), [], 'Superseded implementation: ' + path);
  assert(!Object.keys(manifests.get('packages/agent-core')!.dependencies ?? {}).some(name => name.includes('adapter')));
  assert.deepEqual(manifests.get('packages/contracts')!.dependencies ?? {}, {});
});
