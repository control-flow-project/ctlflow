import { build } from 'esbuild';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export async function buildClient(root: string, destination = join(root, 'dist/crossfire-client.mjs')): Promise<void> {
  if (Number(process.versions.node.split('.')[0]) < 26) throw new Error('Crossfire requires Node.js 26+');
  await build({ entryPoints: [join(root, 'apps/client/src/entry.ts')], outfile: destination,
    bundle: true, platform: 'node', format: 'esm', target: 'node26',
    banner: { js: "import { createRequire as crossfireCreateRequire } from 'node:module'; const require = crossfireCreateRequire(import.meta.url);" },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { root: { type: 'string' } } });
  if (!values.root) throw new Error('Supply the exact source --root directory');
  await buildClient(resolve(values.root));
  console.log('Built the standalone project-local agent client.');
}
