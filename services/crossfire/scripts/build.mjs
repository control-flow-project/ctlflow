import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(join(root, 'dist'), { recursive: true, force: true });
execFileSync(process.execPath, [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', 'tsconfig.core.json', '--outDir', 'dist'], { cwd: root, stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'dist/scripts/build-release.js'), '--root', root], { cwd: root, stdio: 'inherit' });
