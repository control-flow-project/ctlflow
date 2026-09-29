import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const action = process.argv[2];
if (!['typecheck', 'build', 'test'].includes(action)) throw new Error('Expected typecheck, build or test');
const root = fileURLToPath(new URL('../', import.meta.url));
for (const workspace of ['@crossfire/service', '@fleetd/service', '@fleet/service']) {
  execFileSync('npm', ['run', action, '--workspace=' + workspace], { cwd: root, stdio: 'inherit' });
}
