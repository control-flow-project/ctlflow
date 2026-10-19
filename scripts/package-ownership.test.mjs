import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { testOptions } from './test-options.mjs';
import { PACKAGE_AUTHOR, PACKAGE_LICENSE, verifyPackageManifest, verifyPackageOwnership, verifyWorkspaceLock } from './verify-packages.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

function sourceFiles(directory, filename) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'bin', 'obj', 'target', 'dist'].includes(entry.name)) return [];
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path, filename) :
      (entry.name === filename || (filename.startsWith('.') && entry.name.endsWith(filename))) ? [path] : [];
  });
}

test('all packages use their service-owned ctlflow namespace and only the two products are public', () => {
  verifyPackageOwnership(fileURLToPath(new URL('../', import.meta.url)));
});

test('the lock rejects removed workspaces, missing links, alternate owners and stale coordinated versions', () => {
  const workspace = { name: '@ctlflow/workspace', version: '0.1.0', license: PACKAGE_LICENSE };
  const product = { name: '@ctlflow/fleet', version: '0.1.0', license: PACKAGE_LICENSE };
  const manifests = { '': workspace, 'services/fleet': product };
  const packages = { '': workspace, 'services/fleet': product,
    'node_modules/@ctlflow/fleet': { resolved: 'services/fleet', link: true } };
  verifyWorkspaceLock({ lockfileVersion: 3, packages }, manifests);
  for (const changed of [
    { ...packages, 'services/removed': { name: '@ctlflow/removed', version: '0.1.0', extraneous: true } },
    { '': workspace, 'services/fleet': product },
    { ...packages, 'node_modules/@ctlflow/fleet': { resolved: 'services/removed', link: true } },
    { ...packages, 'services/fleet': { ...product, version: '0.2.0' } },
    { ...packages, 'services/fleet': { ...product, license: 'SEE LICENSE IN LICENSE' } },
    { ...packages, 'services/fleet': { ...product, dependencies: { '@ctlflow/removed': '0.1.0' } } },
  ]) assert.throws(() => verifyWorkspaceLock({ lockfileVersion: 3, packages: changed }, manifests));
});

test('publication rejects internal exposure, source files, private dependencies, ranged public dependencies and install hooks', () => {
  const valid = { name: '@ctlflow/fleet', private: false, type: 'module', license: PACKAGE_LICENSE, author: PACKAGE_AUTHOR, publishConfig: { access: 'public' }, files: ['dist/bin', 'docs', 'README.md', 'LICENSE'], bin: { fleet: './dist/bin/fleet.mjs' }, dependencies: { '@ctlflow/fleetd': '0.1.0' } };
  verifyPackageManifest(valid, valid.name, true);
  for (const changed of [ { private: true }, { files: ['src'] }, { files: ['dist/*'] }, { files: ['dist/src'] }, { files: ['dist/tests'] }, { files: ['dist/assets'] }, { files: ['docs/*'] }, { dependencies: { '@ctlflow/fleetd-app': '0.1.0' } },
    { dependencies: { '@ctlflow/fleetd': '^0.1.0' } }, { scripts: { postinstall: 'fleet start' } }, { publishConfig: { access: 'restricted' } },
    { license: 'SEE LICENSE IN LICENSE' }, { author: 'another owner' }, { files: ['dist/bin', 'docs', 'README.md'] } ]) {
    assert.throws(() => verifyPackageManifest({ ...valid, ...changed }, valid.name, true));
  }
  assert.throws(() => verifyPackageManifest({ name: '@ctlflow/crossfire-domain', private: false, type: 'module' }, '@ctlflow/crossfire-domain', false));
  assert.throws(() => verifyPackageManifest({ name: '@other/fleet', private: false, type: 'module' }, valid.name, true));
});

test('private packages require the same MIT license and author as public products', () => {
  const valid = { name: '@ctlflow/crossfire-domain', private: true, type: 'module', license: PACKAGE_LICENSE, author: PACKAGE_AUTHOR };
  verifyPackageManifest(valid, valid.name, false);
  for (const changed of [{ license: 'SEE LICENSE IN LICENSE' }, { license: undefined }, { author: 'another owner' }, { author: undefined }]) {
    assert.throws(() => verifyPackageManifest({ ...valid, ...changed }, valid.name, false));
  }
});

test('there is no optional runtime test path or hidden flag', () => {
  assert.equal(testOptions([]), undefined);
  for (const options of [['--all-runtimes'], ['--runtime', 'pi'], ['--runtime', 'claude'], ['--unknown']]) assert.throws(() => testOptions(options), /verify all implemented runtimes/u);
});

test('every first-party license copy matches the complete root MIT license', () => {
  const license = readFileSync(join(root, 'LICENSE'), 'utf8');
  const copies = sourceFiles(join(root, 'services'), 'LICENSE');
  assert.equal(PACKAGE_LICENSE, 'MIT');
  assert(copies.length > 0, 'First-party service license copies exist');
  for (const path of copies) assert.equal(readFileSync(path, 'utf8'), license, 'Identical first-party license: ' + path);
});

test('C# and Rust products inherit MIT metadata without changing publication permissions', () => {
  const props = readFileSync(join(root, 'Directory.Build.props'), 'utf8');
  assert(props.includes('<PackageLicenseExpression>MIT</PackageLicenseExpression>'), 'C# inherits the MIT expression');
  assert(!props.includes('<PackageLicenseFile>'), 'C# has no competing file license metadata');
  const cargo = readFileSync(join(root, 'Cargo.toml'), 'utf8');
  assert.match(cargo, /^license = "MIT"$/m);
  assert.match(cargo, /^publish = false$/m);
  const manifests = sourceFiles(join(root, 'services'), 'Cargo.toml');
  assert(manifests.length > 0, 'Rust product manifests exist');
  for (const path of manifests) {
    const manifest = readFileSync(path, 'utf8');
    assert.match(manifest, /^license\.workspace = true$/m, 'Inherited Rust license: ' + path);
    assert.match(manifest, /^publish\.workspace = true$/m, 'Unchanged Rust publication policy: ' + path);
    assert(!manifest.includes('license-file'), 'No competing Rust license file metadata: ' + path);
  }
  const projects = sourceFiles(join(root, 'services'), '.csproj');
  assert(projects.length > 0, 'C# product projects exist');
  for (const path of projects) assert(!/<PackageLicense(?:File|Expression)>/u.test(readFileSync(path, 'utf8')), 'Inherited C# license: ' + path);
});

test('the upstream Matrix specification license is retained unchanged', () => {
  const notice = readFileSync(join(root, 'services/crossfire/node/packages/agent-tools/assets/messaging-LICENSE.txt'));
  assert.equal(createHash('sha256').update(notice).digest('hex'), '0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594');
});
