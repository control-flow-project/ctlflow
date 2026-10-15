import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildAgentArtifacts } from '@ctlflow/crossfire-agent-tools/build';
import { loadRelease } from '@ctlflow/crossfire-adapter-filesystem/release';
import type { Manifest } from '@ctlflow/crossfire-contracts/release';

export async function buildRelease(root: string, webDirectory: string, output = join(root, 'dist')): Promise<Manifest> {
  const package_: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!package_ || typeof package_ !== 'object' || !('version' in package_) || typeof package_.version !== 'string') throw new Error('Invalid package version');
  const staging = join(output, 'agent-artifacts');
  const release = await buildAgentArtifacts(staging, package_.version);
  const parent = join(output, 'onboarding');
  const directory = join(parent, release.manifest.release);
  mkdirSync(parent, { recursive: true });
  if (existsSync(directory)) {
    if (loadRelease(directory).manifest.release !== release.manifest.release) throw new Error('Existing immutable release does not match');
    rmSync(staging, { recursive: true });
  } else renameSync(staging, directory);
  mkdirSync(join(output, 'web'), { recursive: true });
  cpSync(join(webDirectory, 'index.html'), join(output, 'web/index.html'));
  cpSync(join(webDirectory, 'assets'), join(output, 'web/assets'), { recursive: true });
  return release.manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' }, 'web-directory': { type: 'string' } } });
  if (!values.root || !values['web-directory']) throw new Error('Supply the exact source --root and prepared --web-directory');
  console.log(JSON.stringify(await buildRelease(resolve(values.root), resolve(values['web-directory']))));
}
