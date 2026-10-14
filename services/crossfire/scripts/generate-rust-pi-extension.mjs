import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { piExtensionSource } from '@ctlflow/crossfire-adapter-pi/extension';

const path = fileURLToPath(new URL('../rust/packages/adapter-pi/assets/crossfire-extension.mjs', import.meta.url));
if (process.argv.length !== 2) throw new Error('This read-only generator check accepts no arguments');
if (readFileSync(path, 'utf8') !== piExtensionSource()) throw new Error('Native Pi extension drifted from its single native API owner');
process.stdout.write('Native Pi extension matches the canonical owned runtime extension\n');
