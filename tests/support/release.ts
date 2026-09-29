import { ARTIFACTS, type Manifest, type ArtifactName } from '../../packages/contracts/src/release.js';
import { artifactHash, releaseHash, type Release } from '../../packages/files/src/release.js';
export function contractRelease(): Release {
  const files = Object.fromEntries(ARTIFACTS.map(name => [name, Buffer.from('contract-fixture:' + name)])) as Record<ArtifactName, Buffer>;
  const manifest: Manifest = { version: '0.1.0', release: '0.1.0-' + releaseHash(files),
    artifacts: Object.fromEntries(ARTIFACTS.map(name => [name, { bytes: files[name].length, sha256: artifactHash(files[name]) }])) as Manifest['artifacts'] };
  return { manifest, files };
}
