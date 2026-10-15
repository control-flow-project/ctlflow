import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { implementationApplications, implementationPackages, verifyImplementationLayout } from './verify-implementation-layout.mjs';

function fixture(scope) {
  const root = mkdtempSync(join(tmpdir(), 'crossfire-layout-'));
  scope.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [service, applications] of Object.entries(implementationApplications)) {
    const directory = join(root, 'services', service);
    for (const [language, application] of Object.entries(applications)) {
      mkdirSync(join(directory, language, 'apps', application), { recursive: true });
      mkdirSync(join(directory, language, 'packages'));
    }
    for (const [node, csharp] of Object.entries(implementationPackages[service])) {
      mkdirSync(join(directory, 'node/packages', node)); mkdirSync(join(directory, 'csharp/packages', csharp));
    }
    mkdirSync(join(directory, 'tests/contracts'), { recursive: true });
  }
  mkdirSync(join(root, 'services/crossfire/apps/web'), { recursive: true });
  return root;
}

test('Node and C# use matching service boundaries while the UI and external assertions stay common', scope => {
  verifyImplementationLayout(fixture(scope));
});

for (const path of ['fleet/packages', 'fleetd/apps/daemon', 'crossfire/tests/alternate-contracts', 'crossfire/csharp/apps/Duplicate', 'fleetd/node/apps/daemon/src/execution.ts']) {
  test('superseded or competing source ownership is rejected: ' + path, scope => {
    const root = fixture(scope);
    mkdirSync(join(root, 'services', path), { recursive: true });
    assert.throws(() => verifyImplementationLayout(root));
  });
}

for (const path of ['fleetd/node/packages/adapter-execution', 'crossfire/csharp/packages/Crossfire.AdapterMatrix']) {
  test('a missing semantic package owner is rejected: ' + path, scope => {
    const root = fixture(scope); rmSync(join(root, 'services', path), { recursive: true });
    assert.throws(() => verifyImplementationLayout(root), /Matching semantic package ownership/u);
  });
}
