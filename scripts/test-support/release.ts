import { copyFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACTS } from '../../packages/contracts/src/release.js';
import { loadRelease, type Release } from '../../packages/files/src/release.js';

let cached: { directory: string; release: Release } | undefined;
export function builtRelease() {
  if (!cached) {
    const root = join(process.cwd(), 'dist/onboarding');
    const names = readdirSync(root);
    if (names.length !== 1) throw new Error('Tests require one freshly built canonical release');
    const directory = join(root, names[0]!);
    cached = { directory, release: loadRelease(directory) };
  }
  return cached;
}

export function builtClient(): string { return join(builtRelease().directory, 'crossfire-client.mjs'); }

export function installTestRelease(directory: string): string {
  for (const name of ['manifest.json', ...ARTIFACTS]) copyFileSync(join(builtRelease().directory, name), join(directory, name));
  return join(directory, 'crossfire-client.mjs');
}
