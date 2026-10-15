import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function pinnedImage(): string {
  const image = /^FROM (vectorim\/element-web:\S+) AS element$/mu.exec(readFileSync(join(process.cwd(), 'node/Dockerfile'), 'utf8'))?.[1];
  if (!image) throw new Error('Pinned Element image is missing');
  return image;
}
export function prepareElementAssets(): void {
  const image = pinnedImage(), root = join(process.cwd(), 'dist/test-assets');
  mkdirSync(root, { recursive: true });
  const container = execFileSync('docker', ['create', image], { encoding: 'utf8', timeout: 60000 }).trim();
  const destination = join(root, 'element');
  try {
    mkdirSync(destination, { mode: 0o700 });
    execFileSync('docker', ['cp', container + ':/app/.', destination], { timeout: 60000 });
  }
  finally { execFileSync('docker', ['rm', container], { timeout: 30000 }); }
  writeFileSync(join(root, 'element-image'), image);
}
export function elementAssets(): string {
  const root = join(process.cwd(), 'dist/test-assets'), destination = join(root, 'element');
  if (!existsSync(join(destination, 'index.html')) || readFileSync(join(root, 'element-image'), 'utf8') !== pinnedImage()) {
    throw new Error('Run the canonical test command to prepare the pinned Element assets');
  }
  return destination;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) prepareElementAssets();
