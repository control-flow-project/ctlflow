import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, lstatSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const conduitImage = 'matrixconduit/matrix-conduit@sha256:f13263ad11be1f41cc4d89d8ee0f4ccbcc846efacf51abab2d859e073faef642';
const source = '/nix/store/dwpji6cdspyrcfg6sxznxy37fwahmd04-conduit-static-x86_64-unknown-linux-musl-0.10.14/bin/conduit';
const directory = () => join(process.cwd(), 'dist/test-assets/conduit');

export function prepareConduitAssets(): void {
  const root = directory(); mkdirSync(root, { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(root, 'extract-'));
  try {
    const archive = join(staging, 'image.tar');
    execFileSync('docker', ['image', 'save', '--output', archive, conduitImage], { timeout: 120000 });
    assert(lstatSync(archive).size <= 256 * 1024 * 1024, 'Pinned image exceeds its finite fixture budget');
    const manifest: unknown = JSON.parse(execFileSync('tar', ['-xOf', archive, 'manifest.json'], { encoding: 'utf8', maxBuffer: 1048576, timeout: 30000 }));
    assert(Array.isArray(manifest) && manifest.length === 1, 'Pinned fixture must contain one immutable image');
    const entries: readonly unknown[] = manifest;
    const image = entries[0];
    assert(image && typeof image === 'object' && !Array.isArray(image) && 'Layers' in image && Array.isArray(image.Layers) && image.Layers.length === 1, 'Pinned Conduit image must retain its reviewed single layer');
    const layers: readonly unknown[] = image.Layers;
    const layer = layers[0];
    assert(typeof layer === 'string' && /^blobs\/sha256\/[a-f0-9]{64}$/u.test(layer), 'Pinned image layer must be an exact content-addressed blob');
    const layerFile = join(staging, 'layer.tar');
    extract(archive, layer, layerFile);
    assert.equal(digest(layerFile), layer.slice('blobs/sha256/'.length), 'Docker image layer integrity must match its immutable address');
    extract(layerFile, source.slice(1), join(staging, 'conduit'));
    chmodSync(join(staging, 'conduit'), 0o500);
    renameSync(join(staging, 'conduit'), join(root, 'conduit'));
    writeFileSync(join(root, 'image'), conduitImage, { mode: 0o600 });
  } finally {
    rmSync(staging, { recursive: true });
  }
}

function extract(archive: string, entry: string, output: string): void {
  const descriptor = openSync(output, 'wx', 0o600);
  try { execFileSync('tar', ['-xOf', archive, '--', entry], { stdio: ['ignore', descriptor, 'pipe'], timeout: 30000 }); }
  finally { closeSync(descriptor); }
}

function digest(file: string): string {
  const descriptor = openSync(file, 'r'), hash = createHash('sha256'), buffer = Buffer.allocUnsafe(65536);
  try { for (;;) { const count = readSync(descriptor, buffer); if (!count) return hash.digest('hex'); hash.update(buffer.subarray(0, count)); } }
  finally { closeSync(descriptor); }
}

export function conduitBinary(): string {
  const root = directory(), binary = join(root, 'conduit');
  assert.equal(readFileSync(join(root, 'image'), 'utf8'), conduitImage, 'Prepare the canonical pinned Conduit artifact');
  const metadata = lstatSync(binary);
  assert(metadata.isFile() && !metadata.isSymbolicLink() && (metadata.mode & 0o100) !== 0, 'Pinned Conduit artifact must be an executable regular file');
  return binary;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) prepareConduitAssets();
