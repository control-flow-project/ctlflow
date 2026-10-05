import { build } from 'esbuild';
import { mkdirSync, chmodSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url)), output = join(root, 'dist', 'bin', 'fleet.mjs');
mkdirSync(join(root, 'dist', 'bin'), { recursive: true });
await build({ entryPoints: [join(root, 'apps', 'cli', 'src', 'main.ts')], outfile: output,
  bundle: true, platform: 'node', format: 'esm', target: 'node26', conditions: ['source'],
  external: ['@ctlflow/fleetd/*'], banner: { js: 'import { createRequire as ctlflowCreateRequire } from "node:module";const require=ctlflowCreateRequire(import.meta.url);' } });
chmodSync(output, 0o755);
