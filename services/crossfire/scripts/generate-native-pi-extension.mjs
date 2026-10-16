import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { piExtensionSource } from '../node/packages/adapter-pi/src/extension.ts';

const destinations = ['../node/packages/adapter-pi/native/owned-extension.mjs', '../rust/packages/adapter-pi/assets/crossfire-extension.mjs']
  .map(path => fileURLToPath(new URL(path, import.meta.url)));
if (process.argv.length > 3 || process.argv.length === 3 && process.argv[2] !== '--check') throw new Error('Generate the native Pi extension, or verify it with --check');
const source = piExtensionSource();
for (const destination of destinations) {
  if (process.argv.length === 2) { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, source); }
  else if (!existsSync(destination) || readFileSync(destination, 'utf8') !== source) throw new Error('Generated native Pi extension differs from its single typed source owner: ' + destination);
}
console.log('Native Pi extension matches the shared typed implementation');
