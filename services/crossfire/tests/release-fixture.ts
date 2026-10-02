import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from "node:path";
import { artifactHash, releaseHash, loadRelease, type Release } from "@crossfire/adapter-filesystem/release";
import { ARTIFACTS, type ArtifactName, type Manifest } from '@crossfire/contracts/release';

export function updatedRelease(release: Release, name: ArtifactName, content: string): Release {
  const files = { ...release.files, [name]: Buffer.from(content) };
  const manifest: Manifest = { version: release.manifest.version,
    release: release.manifest.version + '-' + releaseHash(files),
    artifacts: Object.fromEntries(ARTIFACTS.map(artifact => [artifact, { bytes: files[artifact].length, sha256: artifactHash(files[artifact]) }])) as Manifest['artifacts'] };
  return { files, manifest };
}

export async function releaseFixture() {
  const directory = join(process.cwd(), 'dist/onboarding'), releases = readdirSync(directory);
  assert.equal(releases.length, 1, 'Build one immutable current release before running tests');
  return loadRelease(join(directory, releases[0]!));
}
