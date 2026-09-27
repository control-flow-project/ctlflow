import { build } from 'esbuild';
import { join } from 'node:path';
import { ROOT } from './instance.ts';

await build({ entryPoints: [join(ROOT, 'skills/conduit-chat/scripts/chat.ts')],
  outfile: join(ROOT, 'dist/chat.mjs'), bundle: true, platform: 'node',
  format: 'esm', target: 'node22', banner: { js: "import { createRequire as crossfireCreateRequire } from 'node:module'; const require = crossfireCreateRequire(import.meta.url);" },
});
await build({ entryPoints: [join(ROOT, 'scripts/install-client.ts')],
  outfile: join(ROOT, 'dist/install.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node22',
});
console.log('Built the standalone agent client and installer.');
