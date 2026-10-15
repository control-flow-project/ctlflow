import { createHash } from 'node:crypto';
import { readFileSync, lstatSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { operatorClient } from './auth.js';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { ARTIFACTS, manifest, MAX_ARTIFACT_BYTES } from '@ctlflow/crossfire-contracts/release';
import { loadRelease } from '@ctlflow/crossfire-adapter-filesystem/release';
import { fetchBytes } from '@ctlflow/crossfire-operator-support/http';
import { failure, success } from '@ctlflow/crossfire-kernel/result';

export async function verifyRelease(origin: string, releaseDirectory: string, webDirectory: string | undefined, signal: AbortSignal) {
  try {
    const expected = loadRelease(releaseDirectory).manifest;
    const health = await operatorClient({ origin, signal }).call(operations.health, {}, {});
    if (!health.ok) return health;
    if (health.value.data.release !== expected.release) return failure('conflict', 'Deployed release differs from the selected manifest');
    const published = await fetchBytes(origin, '/onboarding/' + expected.release + '/manifest.json', 65536, signal);
    if (!published.ok) return published;
    const parsed = manifest(JSON.parse(published.value.toString('utf8')));
    if (!parsed.ok) return parsed;
    if (JSON.stringify(parsed.value) !== JSON.stringify(expected)) return failure('conflict', 'Published manifest differs from selected release');
    const artifacts = [];
    for (const name of ARTIFACTS) {
      const item = expected.artifacts[name];
      const actual = await fetchBytes(origin, '/onboarding/' + expected.release + '/' + name, MAX_ARTIFACT_BYTES, signal);
      if (!actual.ok) return actual;
      const sha256 = createHash('sha256').update(actual.value).digest('hex');
      if (actual.value.length !== item.bytes || sha256 !== item.sha256) return failure('conflict', 'Published artifact hash/size differs: ' + name);
      artifacts.push({ name, ...item });
    }
    let webAssets = 0;
    if (webDirectory) {
      const index = await fetchBytes(origin, '/manage/', 1024 * 1024, signal); if (!index.ok) return index;
      if (!index.value.equals(localAsset(join(webDirectory, 'index.html'), 1024 * 1024))) return failure('conflict', 'Deployed management entry differs from selected build');
      const paths = [...index.value.toString('utf8').matchAll(/(?:src|href)="(\/manage\/assets\/[^"/]+\.(?:js|css))"/gu)].map(match => match[1]!);
      if (!paths.length) return failure('native', 'Management build exposes no verifiable assets');
      for (const path of new Set(paths)) {
        const file = join(webDirectory, path.slice('/manage/'.length));
        const local = localAsset(file, 32 * 1024 * 1024), size = local.length;
        const actual = await fetchBytes(origin, path, size, signal); if (!actual.ok) return actual;
        if (!actual.value.equals(local)) return failure('conflict', 'Deployed management asset differs from selected build');
        webAssets++;
      }
    }
    return success({ origin, release: expected.release, artifacts, webAssets, checkedAt: new Date().toISOString() });
  } catch { return failure('invalid', 'Cannot verify the selected release/build inputs'); }
}

function localAsset(file: string, maximum: number): Buffer {
  const info = lstatSync(file);
  if (!info.isFile() || realpathSync(file) !== file || info.size > maximum || info.uid !== process.getuid!()) throw new Error('Invalid local build asset');
  return readFileSync(file);
}
