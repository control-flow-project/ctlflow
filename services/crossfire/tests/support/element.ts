import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
export function elementAssets(directory: string): string {
  const image = /^FROM (vectorim\/element-web:\S+) AS element$/mu.exec(readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8'))?.[1];
  if (!image) throw new Error('Pinned Element image is missing');
  const container = execFileSync('docker', ['create', image], { encoding: 'utf8', timeout: 60000 }).trim();
  const destination = join(directory, 'element');
  mkdirSync(destination, { mode: 0o700 });
  try { execFileSync('docker', ['cp', container + ':/app/.', destination], { timeout: 60000 }); }
  finally { execFileSync('docker', ['rm', container], { timeout: 30000 }); }
  return destination;
}
