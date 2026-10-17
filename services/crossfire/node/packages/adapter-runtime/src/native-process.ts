import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function guardedProcess(binary: string, arguments_: string[], input: {
  workspace: string; environment: NodeJS.ProcessEnv; directory: string; identity: string;
}) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./native-guard.js', import.meta.url)),
    String(process.pid), input.directory, input.identity, binary, ...arguments_], {
    cwd: input.workspace, env: input.environment, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
  });
  if (!child.stdin || !child.stdout || !child.stderr) throw new Error('The native process guard requires private protocol streams');
  return child as ChildProcessWithoutNullStreams;
}
