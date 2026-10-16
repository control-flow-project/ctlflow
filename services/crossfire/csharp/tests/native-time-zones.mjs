import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function prepareTimeZones(directory) {
  const output = join(directory, 'zoneinfo');
  execFileSync(process.execPath, [fileURLToPath(new URL('../../node/scripts/time-zones.ts', import.meta.url)), output], { timeout: 120000, maxBuffer: 65536 });
  return output;
}
