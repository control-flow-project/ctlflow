import { spawn } from 'node:child_process';
import { join } from 'node:path';

export async function buildWeb(root: string, output = join(root, 'dist/web')): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'apps/web/scripts/build.mjs'), output], { cwd: root, stdio: 'inherit' });
    child.once('error', reject);
    child.once('close', (code, signal) => code === 0 ? resolve() : reject(new Error('Shared UI build failed: ' + String(signal ?? code))));
  });
}
