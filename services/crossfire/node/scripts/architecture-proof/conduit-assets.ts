import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, lstatSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const conduitImage = 'matrixconduit/matrix-conduit@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642';
const source = '/nix/store/dwpji6cdspyrcfg6sxznxy37fwahmd04-conduit-static-x86_64-unknown-linux-musl-0.10.14/bin/conduit';
const directory = () => join(process.cwd(), 'dist/test-assets/conduit');

export function prepareConduitAssets(): void {
  const root = directory(); mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(root, 'extract-'));
  const container = execFileSync('docker', ['create', '--pull=never', conduitImage], { encoding: 'utf8', timeout: 30000 }).trim();
  assert.match(container, /^[a-f0-9]{64}$/u);
  try {
    execFileSync('docker', ['cp', container + ':' + source, join(staging, 'conduit')], { timeout: 30000 });
    chmodSync(join(staging, 'conduit'), 0o500);
    renameSync(join(staging, 'conduit'), join(root, 'conduit'));
    writeFileSync(join(root, 'image'), conduitImage, { mode: 0o600 });
  } finally {
    try { execFileSync('docker', ['rm', container], { timeout: 30000 }); }
    finally { rmSync(staging, { recursive: true }); }
  }
}

export function conduitBinary(): string {
  const root = directory(), binary = join(root, 'conduit');
  assert.equal(readFileSync(join(root, 'image'), 'utf8'), conduitImage, 'Prepare the canonical pinned Conduit artifact');
  const metadata = lstatSync(binary);
  assert(metadata.isFile() && !metadata.isSymbolicLink() && (metadata.mode & 0o100) !== 0, 'Pinned Conduit artifact must be an executable regular file');
  return binary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) prepareConduitAssets();
