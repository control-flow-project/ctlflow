import { spawn } from 'node:child_process';
import { join, isAbsolute } from 'node:path';
import { acquireProcessLock } from '@ctlflow/crossfire-adapter-filesystem/lock';

const [parent, directory, identity, binary, ...arguments_] = process.argv.slice(2);
if (!process.connected || !parent || process.ppid !== Number(parent) || !directory || !isAbsolute(directory)
  || !identity || !/^[a-zA-Z0-9_-]{1,64}$/u.test(identity) || !binary
  || process.argv.slice(2).reduce((size, value) => size + Buffer.byteLength(value), 0) > 2 * 1024 * 1024) {
  throw new Error('Invalid owned native process guard');
}

let disconnected = false;
let terminate: (() => void) | undefined;
process.once('disconnect', () => { disconnected = true; terminate?.(); });
const release = await acquireProcessLock(join(directory, 'crossfire-native-process-' + identity), 400, 25);
try {
  if (disconnected || !process.connected || process.ppid !== Number(parent)) throw new Error('Native parent exited before ownership was established');
  const child = spawn(binary, arguments_, { stdio: 'inherit' });
  const signal = (value: NodeJS.Signals) => {
    try { process.kill(-process.pid, value); }
    catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
  };
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const stop = () => { if (escalation) return; escalation = setTimeout(() => signal('SIGKILL'), 3000); signal('SIGTERM'); };
  terminate = () => signal('SIGKILL');
  for (const name of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(name, stop);
  child.once('exit', () => signal('SIGKILL'));
  const code = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  }).finally(() => clearTimeout(escalation));
  process.exitCode = code ?? 1;
} finally {
  await release();
  if (process.connected && process.disconnect) process.disconnect();
}
