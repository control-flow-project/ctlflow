import { main } from "./main.js";
import { reportStartup } from './listener-process.js';
import { dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRelease } from '@ctlflow/crossfire-adapter-filesystem/release';

main(process.argv.slice(2), () => {
  const file = fileURLToPath(import.meta.url);
  if (basename(file) !== 'crossfire-client.mjs') throw new Error('Run the verified crossfire-client.mjs from its complete project-local release directory');
  try { return loadRelease(dirname(file)).manifest; }
  catch (error) { throw new Error('Cannot verify installed client/skills. Download and verify the complete release, including manifest.json. ' + String(error)); }
}, fileURLToPath(import.meta.url)).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Client command failed";
  reportStartup({ error: message.slice(0, 4096) });
  console.error(message);
  process.exitCode = 1;
});
