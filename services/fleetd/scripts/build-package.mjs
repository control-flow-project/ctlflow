import { build } from 'esbuild';
import { mkdirSync, chmodSync, readFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { buildAgentArtifacts } from '@ctlflow/crossfire-agent-tools/build';

const root = fileURLToPath(new URL('../', import.meta.url)), output = join(root, 'dist', 'bin', 'fleetd.mjs');
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
mkdirSync(join(root, 'dist', 'bin'), { recursive: true });
await build({ entryPoints: [join(root, 'apps', 'daemon', 'src', 'main.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', target: 'node26', conditions: ['source'],
  banner: { js: 'import { createRequire as ctlflowCreateRequire } from "node:module";const require=ctlflowCreateRequire(import.meta.url);' } });
rmSync(join(root, 'dist', 'assets'), { recursive: true, force: true });
await buildAgentArtifacts(join(root, 'dist', 'assets'), version);
chmodSync(output, 0o755);
