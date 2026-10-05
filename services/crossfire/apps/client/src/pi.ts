import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { artifactHash, loadRelease } from '@crossfire/adapter-filesystem/release';
import { registerPi } from '@crossfire/adapter-pi/extension';
import type { PiApi } from '@crossfire/adapter-pi/native';

export function piExtension(api: PiApi): void {
  loadRelease(dirname(fileURLToPath(import.meta.url)));
  registerPi(api, artifactHash(readFileSync(fileURLToPath(import.meta.url))));
}
