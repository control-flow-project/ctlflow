import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

function pinnedImage(): string {
  const image = /^FROM (vectorim\/element-web:\S+) AS element$/mu.exec(readFileSync(join(process.cwd(), 'node/Dockerfile'), 'utf8'))?.[1];
  if (!image) throw new Error('Pinned Element image is missing');
  return image;
}
type DockerCommand = (arguments_: string[], timeout: number) => string;
const command: DockerCommand = (arguments_, timeout) => execFileSync('docker', arguments_, { encoding: 'utf8', timeout });
export function prepareElementAssets(run: DockerCommand = command): void {
  const image = pinnedImage(), root = join(process.cwd(), 'dist/test-assets');
  mkdirSync(root, { recursive: true });
  const container = run(['create', image], 60000).trim();
  if (!/^[a-f0-9]{64}$/u.test(container)) throw new Error('Docker returned an invalid Element fixture identity');
  const destination = join(root, 'element');
  let primary: { error: unknown } | undefined;
  try {
    mkdirSync(destination, { mode: 0o700 });
    run(['cp', container + ':/app/.', destination], 60000);
  } catch (error) { primary = { error }; }
  try { run(['rm', container], 120000); }
  catch (error) {
    if (primary) throw new AggregateError([primary.error, error], 'Element fixture extraction and cleanup failed');
    throw error;
  }
  if (primary) throw primary.error;
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
