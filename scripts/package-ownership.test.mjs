import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { testOptions } from './test-options.mjs';
import { verifyPackageManifest, verifyPackageOwnership } from './verify-packages.mjs';

test('all packages use their service-owned ctlflow namespace and only the two products are public', () => {
  verifyPackageOwnership(fileURLToPath(new URL('../', import.meta.url)));
});

test('publication rejects internal exposure, source files, private dependencies, ranged public dependencies and install hooks', () => {
  const valid = { name: '@ctlflow/fleet', private: false, type: 'module', publishConfig: { access: 'public' }, files: ['dist/bin', 'docs', 'README.md'], bin: { fleet: './dist/bin/fleet.mjs' }, dependencies: { '@ctlflow/fleetd': '0.1.0' } };
  verifyPackageManifest(valid, valid.name, true);
  for (const changed of [ { private: true }, { files: ['src'] }, { files: ['dist/*'] }, { files: ['dist/src'] }, { files: ['dist/tests'] }, { files: ['dist/assets'] }, { files: ['docs/*'] }, { dependencies: { '@ctlflow/fleetd-app': '0.1.0' } },
    { dependencies: { '@ctlflow/fleetd': '^0.1.0' } }, { scripts: { postinstall: 'fleet start' } }, { publishConfig: { access: 'restricted' } } ]) {
    assert.throws(() => verifyPackageManifest({ ...valid, ...changed }, valid.name, true));
  }
  assert.throws(() => verifyPackageManifest({ name: '@ctlflow/crossfire-domain', private: false, type: 'module' }, '@ctlflow/crossfire-domain', false));
  assert.throws(() => verifyPackageManifest({ name: '@other/fleet', private: false, type: 'module' }, valid.name, true));
});

test('there is no optional runtime test path or hidden flag', () => {
  assert.equal(testOptions([]), undefined);
  for (const options of [['--all-runtimes'], ['--runtime', 'pi'], ['--runtime', 'claude'], ['--unknown']]) assert.throws(() => testOptions(options), /only implemented runtime/u);
});
