import { existsSync, lstatSync, mkdtempSync, realpathSync, readlinkSync, renameSync, symlinkSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ARTIFACTS, MAX_ARTIFACT_BYTES } from '@crossfire/contracts/release';
import { loadRelease, artifactHash } from '@crossfire/adapter-filesystem/release';
import { privateDir, writeJson, readPrivateBytes } from '@crossfire/adapter-filesystem/index';
import { createCoordination } from './coordination.js';
import { acquireProcessLock } from '@crossfire/adapter-filesystem/lock';

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
  if (!client) throw new Error('Automatic recovery requires the previously approved project software');
  const directory = dirname(client), release = loadRelease(directory);
  return { manifest: release.manifest, file: client, activate: () => {},
    skill: { path: join(directory, 'SKILL.md'), changed: false } };
}

export async function installSoftware(root: string, origin: string) {
  const release = await acquireProcessLock(join(root, 'software-install'), 35);
  try { return await prepareSoftware(root, origin); }
  finally { await release(); }
}

async function prepareSoftware(root: string, origin: string) {
  const response = await createCoordination({ origin }).release();
  if (!response.ok) throw new Error(response.error.message);
  const current = response.value;
  const previous = installedClient(root);
  const previousSkillHash = previous ? artifactHash(readPrivateBytes(join(dirname(previous), 'SKILL.md'), MAX_ARTIFACT_BYTES)) : null;
  const software = privateDir(join(root, 'software'));
  const directory = join(software, current.release);
  if (!existsSync(directory)) {
    const staging = mkdtempSync(join(software, '.install-'));
    try {
      for (const name of ARTIFACTS) {
        const expected = current.artifacts[name];
        const result = await fetch(origin + '/onboarding/' + current.release + '/' + name, { redirect: 'error', signal: AbortSignal.timeout(30_000) });
        if (!result.ok || !result.body) throw new Error('Cannot download current ' + name + ': HTTP ' + result.status);
        const buffers: Uint8Array[] = [];
        let size = 0;
        for await (const bytes of result.body) {
          size += bytes.byteLength;
          if (size > expected.bytes) throw new Error('Downloaded artifact exceeds its published size');
          buffers.push(bytes);
        }
        const content = Buffer.concat(buffers);
        if (size !== expected.bytes || artifactHash(content) !== expected.sha256) throw new Error('Downloaded artifact failed verification: ' + name);
        writeFileSync(join(staging, name), content, { flag: 'wx', mode: 0o600 });
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
