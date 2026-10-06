import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const PUBLIC_PACKAGES = ['@ctlflow/fleet', '@ctlflow/fleetd'];

export function verifyPackageManifest(manifest, expectedName, isPublic) {
  assert.equal(manifest.name, expectedName, 'Package namespace/ownership');
  assert.equal(manifest.private, !isPublic, 'Only the explicit public products may be published');
  assert.equal(manifest.type, 'module', 'Every package is ESM');
  if (!isPublic) return;
  assert.deepEqual(manifest.publishConfig, { access: 'public' }, 'Public scope requires explicit public access');
  assert(Array.isArray(manifest.files) && manifest.files.length > 0, 'Public packages need a finite file allowlist');
  for (const file of manifest.files) assert(typeof file === 'string' && ['dist/bin', 'dist/assets', 'docs', 'README.md'].includes(file), 'Public package files must be explicit executable, release assets or product documentation directories');
  assert(!manifest.files.includes('dist/assets') || expectedName === '@ctlflow/fleetd', 'Only fleetd owns bundled listener release assets');
  assert(manifest.bin && Object.keys(manifest.bin).length === 1 && manifest.bin[expectedName.slice('@ctlflow/'.length)], 'Public product needs its named executable');
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (name.startsWith('@ctlflow/')) {
      assert(PUBLIC_PACKAGES.includes(name), 'Internal modules must be bundled, not registry dependencies');
      assert(/^\d+\.\d+\.\d+$/u.test(version), 'Public dependencies use exact versions');
    }
  }
  for (const script of ['preinstall', 'install', 'postinstall']) assert(!manifest.scripts?.[script], 'Installation must not run controller/agent lifecycle scripts');
}

export function verifyWorkspaceLock(lock, manifests) {
  assert.equal(lock.lockfileVersion, 3, 'Workspace lock format');
  const entries = lock.packages;
  assert.deepEqual(Object.keys(entries).filter(path => path === '' || path.startsWith('services/')).sort(),
    Object.keys(manifests).sort(), 'The lock contains exactly the current owned workspaces');
  const expectedLinks = Object.entries(manifests).filter(([path]) => path !== '')
    .map(([path, manifest]) => ['node_modules/' + manifest.name, path]).sort();
  const actualLinks = Object.entries(entries).filter(([, entry]) => entry.link)
    .map(([path, entry]) => [path, entry.resolved]).sort();
  assert.deepEqual(actualLinks, expectedLinks, 'Workspace links have exactly one current owner');
  for (const [path, manifest] of Object.entries(manifests)) {
    const entry = entries[path];
    assert.equal(entry.name, manifest.name, 'Locked workspace name: ' + path);
    assert.equal(entry.version, manifests[''].version, 'Locked coordinated version: ' + path);
    for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'engines']) {
      assert.deepEqual(entry[field] ?? {}, manifest[field] ?? {}, 'Locked workspace ' + field + ': ' + path);
    }
  }
}

export function verifyPackageOwnership(root) {
  const workspace = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  verifyPackageManifest(workspace, '@ctlflow/workspace', false);
  const manifests = { '': workspace };
  const published = [];
  for (const service of ['crossfire', 'fleetd', 'fleet']) {
    const directory = join(root, 'services', service);
    const product = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
    manifests['services/' + service] = product;
    const isPublic = PUBLIC_PACKAGES.includes(product.name);
    verifyPackageManifest(product, '@ctlflow/' + service, isPublic);
    assert.equal(product.version, workspace.version, 'Server setup descriptors and public controller products share one release version');
    for (const [name, version] of Object.entries(product.dependencies ?? {})) {
      if (PUBLIC_PACKAGES.includes(name)) assert.equal(version, workspace.version, 'Public controller dependencies match the exact coordinated release');
    }
    if (isPublic) published.push(product.name);
    for (const kind of ['apps', 'packages']) {
      const parent = join(directory, kind);
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = join(parent, entry.name, 'package.json');
        assert(existsSync(file), 'Every owned module must declare its package: ' + file);
        const manifest = JSON.parse(readFileSync(file, 'utf8'));
        verifyPackageManifest(manifest, '@ctlflow/' + service + '-' + entry.name, false);
        assert.equal(manifest.version, workspace.version, 'Every owned module shares the coordinated release');
        manifests['services/' + service + '/' + kind + '/' + entry.name] = manifest;
      }
    }
  }
  assert.deepEqual(published.sort(), [...PUBLIC_PACKAGES].sort(), 'Both and only fleet products are public');
  verifyWorkspaceLock(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')), manifests);
}
