import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { buildRelease } from "../scripts/build-release.js";
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
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const output = mkdtempSync(join(process.cwd(), ".temp/release-fixture-"));
  const manifest = await buildRelease(process.cwd(), output);
  return loadRelease(join(output, "onboarding", manifest.release));
}
