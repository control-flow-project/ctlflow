import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { piExtensionSource } from '../packages/adapter-pi/src/extension.ts';

const destination = fileURLToPath(new URL('../packages/adapter-pi/native/owned-extension.mjs', import.meta.url));
if (process.argv.length > 3 || process.argv.length === 3 && process.argv[2] !== '--check') throw new Error('Generate the native Pi extension, or verify it with --check');
if (process.argv.length === 2) { mkdirSync(dirname(destination), { recursive: true }); writeFileSync(destination, piExtensionSource()); }
else if (!existsSync(destination) || readFileSync(destination, 'utf8') !== piExtensionSource()) throw new Error('Generated native Pi extension differs from its single typed source owner');
console.log('Native Pi extension matches the shared typed implementation');
