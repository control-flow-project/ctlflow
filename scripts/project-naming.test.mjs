import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { documentationFiles, documentationLinks } from './verify-documentation.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('the parent is ctlflow and product guides retain their lowercase constituent names', () => {
  assert.match(readFileSync(join(root, 'README.md'), 'utf8'), /^# ctlflow\n/u);
  assert.match(readFileSync(join(root, 'AGENTS.md'), 'utf8'), /^# ctlflow monorepo instructions\n/u);
  assert.match(readFileSync(join(root, 'docs/specification.md'), 'utf8'), /^# ctlflow specification\n/u);
  for (const product of ['crossfire', 'fleetd', 'fleet']) {
    assert(readFileSync(join(root, 'services', product, 'README.md'), 'utf8').startsWith('# ' + product + ' '), product);
  }
});

test('current guides link to the canonical repository rather than relying on a GitHub rename redirect', () => {
  for (const file of documentationFiles(root)) for (const { target, line } of documentationLinks(readFileSync(file, 'utf8'))) {
    assert(!target.startsWith('https://github.com/control-flow-project/crossfire/'), file + ':' + line);
  }
});

test('the ctlflow umbrella solution retains native product project names without an old solution alias', () => {
  assert(!existsSync(join(root, 'Crossfire.CSharp.slnx')));
  const solution = readFileSync(join(root, 'Ctlflow.CSharp.slnx'), 'utf8');
  for (const product of ['Crossfire.Server', 'Fleetd.Daemon', 'Fleet.Cli']) assert(solution.includes('/' + product + '/' + product + '.csproj'), product);
});
