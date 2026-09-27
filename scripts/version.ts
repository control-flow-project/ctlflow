import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type BuildInfo = { version: string; revision: string; modified: boolean; image: string };
export type RuntimeInfo = { build: BuildInfo; started_at: string; node: string; client_sha256: string };

export function requireNode(version = process.versions.node): void {
  if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/.test(version) || Number(version.split('.')[0]) < 26) {
    throw new Error('Node.js 26+ is required; found ' + version);
  }
}

export function buildInfo(root: string, image: string): BuildInfo {
  const manifest: unknown = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (!manifest || typeof manifest !== 'object' || !('version' in manifest) || typeof manifest.version !== 'string') {
    throw new Error('Crossfire package version is missing');
  }
  const git = (args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  const revision = git(['rev-parse', 'HEAD']);
  if (!/^[0-9a-f]{40,64}$/.test(revision)) throw new Error('Crossfire source revision is invalid');
  return { version: manifest.version, revision, modified: git(['status', '--porcelain', '--untracked-files=normal']) !== '', image };
}
