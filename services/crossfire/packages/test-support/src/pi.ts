import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lstatSync, mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync, renameSync } from 'node:fs';
import assert from 'node:assert/strict';

const version = '1.0.0';
const integrity = '/FtbxoSQU/mEv1QnichJjRjqteqaIaMWxmhB4G367+MwZfX7/DI5B9YAg5lqbN7nztFskBEtUSZ+FlmMBECtMw==';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const asset = join(root, '.temp/native-pi-' + version);
export function preparePi(): void {
  if (lstatSync(join(asset, 'ready'), { throwIfNoEntry: false })) { piBinary(); return; }
  mkdirSync(join(root, '.temp'), { recursive: true, mode: 0o700 });
  const staging = mkdtempSync(join(root, '.temp/pi-install-'));
  try {
    const output: unknown = JSON.parse(execFileSync('npm', ['pack', '@earendil-works/pi-coding-agent@' + version, '--ignore-scripts', '--json', '--pack-destination', staging],
      { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 }));
    assert(Array.isArray(output) && output.length === 1 && typeof output[0]?.filename === 'string');
    const archive = join(staging, output[0].filename);
    assert.equal(createHash('sha512').update(readFileSync(archive)).digest('base64'), integrity, 'Canonical released Pi tarball integrity');
    execFileSync('tar', ['-xzf', archive, '-C', staging], { timeout: 30000 });
    execFileSync('npm', ['--prefix', join(staging, 'package'), '--userconfig', join(root, '.npmrc'), 'install', '--omit=dev', '--ignore-scripts', '--package-lock=false'],
      { cwd: root, timeout: 180000, maxBuffer: 2 * 1024 * 1024 });
    writeFileSync(join(staging, 'ready'), version, { mode: 0o600 });
    renameSync(staging, asset); piBinary();
  } finally { rmSync(staging, { recursive: true, force: true }); }
}
export function piBinary(): string {
  assert.equal(readFileSync(join(asset, 'ready'), 'utf8'), version, 'Prepare the canonical native Pi prerequisite once before test workers');
  const binary = join(asset, 'package/dist/bundle/cli.js'), info = lstatSync(binary);
  assert(info.isFile() && !info.isSymbolicLink() && info.mode & 0o100);
  return binary;
}
