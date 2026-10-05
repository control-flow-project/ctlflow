import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);

export async function installedFleet(): Promise<string> {
  const installer = process.env.npm_execpath;
  assert(installer, 'Run installed product verification through npm');
  const repository = fileURLToPath(new URL('../../../../../', import.meta.url));
  const directory = mkdtempSync(join(tmpdir(), 'crossfire-public-fleet-'));
  const packages = join(directory, 'packages'), prefix = join(directory, 'installation');
  mkdirSync(packages); mkdirSync(prefix);
  const tarballs: string[] = [];
  for (const product of ['fleetd', 'fleet']) {
    const packed = await execute(process.execPath, [installer, 'pack', '--json', '--ignore-scripts', '--pack-destination', packages], {
      cwd: join(repository, 'services', product), timeout: 30_000, maxBuffer: 512 * 1024,
    });
    const result = JSON.parse(packed.stdout) as { name: string; filename: string }[];
    assert.equal(result.length, 1);
    assert.equal(result[0]!.name, '@ctlflow/' + product);
    tarballs.push(join(packages, result[0]!.filename));
  }
  await execute(process.execPath, [installer, 'install', '--prefix', prefix, '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--save-exact', ...tarballs], { cwd: directory, timeout: 30_000, maxBuffer: 512 * 1024 });
  return join(prefix, 'node_modules/@ctlflow/fleet/dist/bin/fleet.mjs');
}
