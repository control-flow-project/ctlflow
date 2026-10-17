import { execFileSync, spawnSync } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export function verifyPrivateFiles(root) {
  const tracked = execFileSync('git', ['ls-files', '--cached', '-z'], { cwd: root, encoding: 'utf8' }).split('\0');
  const forbidden = tracked.filter(file => /(?:^|\/)\.analysis(?:\/|$)/u.test(file));
  if (forbidden.length) throw new Error('Private .analysis files must never be tracked: ' + forbidden.slice(0, 20).map(file => JSON.stringify(file)).join(', '));
  const probes = ['.analysis/private-note', 'nested/.analysis/private-note'];
  const result = spawnSync('git', ['check-ignore', '--no-index', '-z', '--stdin'], { cwd: root, input: probes.join('\0') + '\0', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0 || probes.some(file => !result.stdout.split('\0').includes(file))) throw new Error('Repository ignore rules must exclude .analysis at every directory level');
  console.log('Private analysis verified: no tracked .analysis paths; root and nested notes are ignored.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length > 3 || process.argv[2] !== undefined && !isAbsolute(process.argv[2])) throw new Error('Use verify-private-files.mjs [/absolute/repository]');
  verifyPrivateFiles(process.argv[2] ?? fileURLToPath(new URL('../', import.meta.url)));
}
