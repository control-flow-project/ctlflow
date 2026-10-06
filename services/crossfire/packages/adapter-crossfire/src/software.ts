import { existsSync, lstatSync, mkdtempSync, realpathSync, readlinkSync, renameSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ARTIFACTS, MAX_ARTIFACT_BYTES } from '@ctlflow/crossfire-contracts/release';
import { loadRelease, artifactHash } from '@ctlflow/crossfire-adapter-filesystem/release';
import { privateDir, writeJson, readPrivateBytes } from '@ctlflow/crossfire-adapter-filesystem/index';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';

function installedClient(root: string): string | null {
  const entry = join(root, 'client.mjs');
  let information;
  try { information = lstatSync(entry); }
  catch (error) { if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null; throw error; }
  if (!information.isSymbolicLink() || information.uid !== process.getuid!()
    || !/^software\/\d+\.\d+\.\d+-[a-f0-9]{24}\/crossfire-client\.mjs$/u.test(readlinkSync(entry))) throw new Error('The project client entry is not a managed Crossfire installation');
  const client = realpathSync(entry);
  if (client !== join(root, readlinkSync(entry))) throw new Error('Installed software cannot traverse symlink directories');
  privateDir(dirname(client));
  return client;
}

export function installedSoftware(root: string) {
  const client = installedClient(root);
  if (!client) throw new Error('Automatic recovery requires the previously approved controller-installed software');
  const directory = dirname(client), release = loadRelease(directory);
  return { manifest: release.manifest, file: client, activate: () => {},
    skill: { path: join(directory, 'SKILL.md'), changed: false } };
}

export async function installSoftware(root: string, releaseDirectory: string) {
  const release = await acquireProcessLock(join(root, 'software-install'), 35);
  try { return prepareSoftware(root, releaseDirectory); }
  finally { await release(); }
}

function prepareSoftware(root: string, releaseDirectory: string) {
  if (!isAbsolute(releaseDirectory) || resolve(releaseDirectory) !== realpathSync(releaseDirectory)
    || !lstatSync(releaseDirectory).isDirectory()) throw new Error('Controller software must come from the exact installed package release directory');
  const local = loadRelease(releaseDirectory), current = local.manifest;
  const previous = installedClient(root);
  if (previous) loadRelease(dirname(previous));
  const previousSkillHash = previous ? artifactHash(readPrivateBytes(join(dirname(previous), 'SKILL.md'), MAX_ARTIFACT_BYTES)) : null;
  const software = privateDir(join(root, 'software'));
  const directory = join(software, current.release);
  if (!existsSync(directory)) {
    const staging = mkdtempSync(join(software, '.install-'));
    try {
      for (const name of ARTIFACTS) {
        writeFileSync(join(staging, name), local.files[name], { flag: 'wx', mode: 0o600 });
      }
      writeJson(join(staging, 'manifest.json'), current);
      loadRelease(staging);
      renameSync(staging, directory);
    } finally { if (existsSync(staging)) rmSync(staging, { recursive: true }); }
  }
  if (loadRelease(directory).manifest.release !== current.release) throw new Error('Installed release differs from the current manifest');
  const activate = () => {
    installedClient(root);
    const temporary = join(root, '.client-' + randomUUID());
    symlinkSync('software/' + current.release + '/crossfire-client.mjs', temporary);
    try { renameSync(temporary, join(root, 'client.mjs')); }
    finally { if (existsSync(temporary)) rmSync(temporary); }
  };
  return { manifest: current, file: join(directory, 'crossfire-client.mjs'), activate,
    skill: { path: join(directory, 'SKILL.md'), changed: previousSkillHash !== current.artifacts['SKILL.md'].sha256 } };
}
