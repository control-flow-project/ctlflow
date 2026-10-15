import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { stageRustLicenses } from './rust-licenses.mjs';

test('native products retain actual dependency licenses and notices, not development-only dependencies', scope => {
  const root = mkdtempSync(join(tmpdir(), 'rust-licenses-'));
  scope.after(() => rmSync(root, { recursive: true, force: true }));
  const dependency = join(root, 'dependency'); mkdirSync(dependency);
  writeFileSync(join(dependency, 'LICENSE-MIT'), 'upstream grant\n');
  writeFileSync(join(dependency, 'NOTICE'), 'upstream notice\n');
  const packages = ['crossfire-server', 'fleetd-daemon', 'fleet-cli', 'crossfire-adapter-process'].map(name => ({ id: name, name, source: null }));
  const upstream = { id: 'upstream', name: 'upstream', version: '1.2.3', source: 'registry+https://example.invalid/index', license: 'MIT', manifest_path: join(dependency, 'Cargo.toml'), license_file: null };
  const metadata = { packages: [...packages, upstream], resolve: { nodes: packages.map(value => ({ id: value.id, deps: [{ pkg: upstream.id, dep_kinds: [{ kind: value.name === 'crossfire-server' ? null : 'dev' }] }] })) } };
  const destination = join(root, 'distribution');
  assert.equal(stageRustLicenses(metadata, destination), 1);
  assert.equal(readFileSync(join(destination, 'upstream-1.2.3/LICENSE-MIT'), 'utf8'), 'upstream grant\n');
  assert.equal(readFileSync(join(destination, 'upstream-1.2.3/NOTICE'), 'utf8'), 'upstream notice\n');
  assert.equal(JSON.parse(readFileSync(join(destination, 'index.json'), 'utf8')).length, 1);
  metadata.resolve.nodes[0].deps[0].dep_kinds[0].kind = 'dev';
  assert.equal(stageRustLicenses(metadata, join(root, 'development-only')), 0);
  metadata.resolve.nodes[0].deps[0].dep_kinds[0].kind = null;
  rmSync(join(dependency, 'LICENSE-MIT')); rmSync(join(dependency, 'NOTICE'));
  assert.throws(() => stageRustLicenses(metadata, join(root, 'missing-license')), /actual upstream license/u);
});
