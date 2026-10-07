import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ARTIFACTS, type ArtifactName, type Manifest } from '@ctlflow/crossfire-contracts/release';
import { artifactHash, releaseHash, loadRelease, type Release } from '@ctlflow/crossfire-adapter-filesystem/release';

export async function buildAgentClient(destination: string): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Crossfire requires Node.js 26+');
  await build({ absWorkingDir: join(dirname(fileURLToPath(import.meta.url)), '..'),
    entryPoints: [fileURLToPath(import.meta.resolve('@ctlflow/crossfire-agent-tools/entry'))], outfile: destination,
    bundle: true, platform: 'node', format: 'esm', target: 'node26',
    banner: { js: "/*! Copyright (c) 2026 Jeswin P Kumar. All rights reserved. Proprietary; see README.md. Contact: jeswinpk@agilehead.com. */\nimport { createRequire as crossfireCreateRequire } from 'node:module'; const require = crossfireCreateRequire(import.meta.url);" } });
}

export async function buildAgentArtifacts(outputDirectory: string, version: string): Promise<Release> {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) throw new Error('Invalid agent artifact version');
  mkdirSync(outputDirectory, { recursive: true });
  if (existsSync(join(outputDirectory, 'manifest.json'))) throw new Error('An immutable agent artifact directory already exists');
  await buildAgentClient(join(outputDirectory, 'crossfire-client.mjs'));
  const assets = join(dirname(fileURLToPath(import.meta.url)), '../assets');
  const files: Record<ArtifactName, Buffer> = {
    'README.md': Buffer.from(readFileSync(join(assets, 'README.md'), 'utf8') + '\n## License\n\n' + readFileSync(join(assets, '..', 'LICENSE'), 'utf8')),
    'SKILL.md': readFileSync(join(assets, 'SKILL.md')),
    'crossfire-client.mjs': readFileSync(join(outputDirectory, 'crossfire-client.mjs')),
    'matrix-spec-LICENSE.txt': readFileSync(join(assets, 'matrix-spec-LICENSE.txt')),
  };
  const manifest: Manifest = { version, release: version + '-' + releaseHash(files),
    artifacts: Object.fromEntries(ARTIFACTS.map(name => [name, { bytes: files[name].length, sha256: artifactHash(files[name]) }])) as Manifest['artifacts'] };
  for (const name of ARTIFACTS) if (name !== 'crossfire-client.mjs') writeFileSync(join(outputDirectory, name), files[name], { flag: 'wx' });
  writeFileSync(join(outputDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return loadRelease(outputDirectory);
}
