import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRelease } from '@ctlflow/crossfire-adapter-filesystem/release';
import { main } from './main.js';

const file = fileURLToPath(import.meta.url);
if (basename(file) !== 'crossfire-client.mjs') throw new Error('Run the verified crossfire-client.mjs release artifact');
loadRelease(dirname(file));
main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Crossfire tool failed');
  process.exitCode = 1;
});
