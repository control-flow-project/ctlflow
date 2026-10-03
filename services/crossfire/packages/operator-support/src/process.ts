import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { failure, success, type Result } from '@crossfire/kernel/result';

const execute = promisify(execFile);
export async function command(binary: string, arguments_: string[], signal: AbortSignal): Promise<Result<string>> {
  try {
    const result = await execute(binary, arguments_, { encoding: 'utf8', signal, timeout: 30000, maxBuffer: 16 * 1024 * 1024 });
    return success(result.stdout);
  } catch { return failure('native', 'Read-only ' + binary + ' inspection failed or timed out'); }
}
export async function verifySource(directory: string, revision: string | undefined, tree: string | undefined, signal: AbortSignal) {
  if ([revision, tree].some(value => value !== undefined && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(value))) return failure('invalid', 'Supply complete Git object identities');
  try {
    if (!directory.startsWith('/') || resolve(directory) !== realpathSync(directory)) return failure('invalid', 'Use an absolute canonical Git directory');
  } catch { return failure('invalid', 'Git directory is unavailable'); }
  const root = await command('git', ['-C', directory, 'rev-parse', '--show-toplevel'], signal);
  const head = await command('git', ['-C', directory, 'rev-parse', 'HEAD'], signal);
  const actualTree = await command('git', ['-C', directory, 'rev-parse', 'HEAD^{tree}'], signal);
  const status = await command('git', ['-C', directory, 'status', '--porcelain', '--untracked-files=all'], signal);
  if (!root.ok) return root; if (!head.ok) return head; if (!actualTree.ok) return actualTree; if (!status.ok) return status;
  if (root.value.trim() !== directory) return failure('invalid', 'Select the Git checkout root, not a nested directory');
  if (status.value.trim()) return failure('conflict', 'Git source contains uncommitted or untracked work');
  if (revision && revision !== head.value.trim() || tree && tree !== actualTree.value.trim()) return failure('conflict', 'Git source does not match the expected exact revision/tree');
  return success({ projectRoot: root.value.trim(), revision: head.value.trim(), tree: actualTree.value.trim(), clean: true });
}
