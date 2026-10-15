import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

type CommandOutput = { code: number | null; output: string; errors: string };
function command(args: string[], capture: boolean, signal?: AbortSignal): Promise<CommandOutput> {
  signal?.throwIfAborted();
  return new Promise((resolveCommand, reject) => {
    const child = spawn('docker', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', failed: Error | undefined, escalation: NodeJS.Timeout | undefined;
    const kill = (value: NodeJS.Signals) => { if (child.pid !== undefined) try { process.kill(-child.pid, value); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; } };
    const stop = () => { kill('SIGTERM'); escalation ??= setTimeout(() => kill('SIGKILL'), 3000); };
    const append = (previous: string, bytes: Buffer) => {
      const next = previous + bytes.toString('utf8');
      if (capture && Buffer.byteLength(next) > 65536) { failed ??= new Error('Docker response exceeds its output bound'); stop(); }
      return next.slice(-65536);
    };
    child.stdout.on('data', (bytes: Buffer) => { output = append(output, bytes); });
    child.stderr.on('data', (bytes: Buffer) => { errors = append(errors, bytes); });
    if (!capture) { child.stdout.pipe(process.stdout, { end: false }); child.stderr.pipe(process.stderr, { end: false }); }
    child.once('error', error => { failed ??= error; });
    child.once('close', code => {
      clearTimeout(escalation); signal?.removeEventListener('abort', stop);
      if (failed) reject(failed); else if (signal?.aborted) reject(signal.reason as unknown); else resolveCommand({ code, output, errors });
    });
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
  });
}
export function captureDocker(args: string[], signal?: AbortSignal): Promise<CommandOutput> {
  const deadline = AbortSignal.timeout(30000); return command(args, true, signal ? AbortSignal.any([signal, deadline]) : deadline);
}
export async function runDocker(args: string[], signal?: AbortSignal): Promise<void> {
  const result = await command(args, false, signal);
  if (result.code !== 0) throw new Error('Docker command failed with exit ' + result.code + '\n' + result.errors + '\n' + result.output);
}
export async function ownedDocker(args: string[], signal: AbortSignal): Promise<void> {
  if (args[0] !== 'run' || !args.includes('--name') || args.some(value => value === '--rm' || value.startsWith('--rm='))) throw new Error('Use the explicit owned-container command without automatic removal');
  signal.throwIfAborted();
  const created = await captureDocker(['create', ...args.slice(1)]);
  if (created.code !== 0) throw new Error('Cannot create the owned container: ' + created.errors);
  const identity = created.output.trim(); if (!/^[a-f0-9]{64}$/u.test(identity)) throw new Error('Docker did not return an exact container identity');
  const attachment = new AbortController(); let running: Promise<void> | undefined, failure: unknown;
  let cancelled: (() => void) | undefined;
  try {
    signal.throwIfAborted(); running = runDocker(['start', '--attach', identity], attachment.signal);
    const stopped = new Promise<boolean>(resolveStop => { cancelled = () => resolveStop(true); signal.addEventListener('abort', cancelled, { once: true }); if (signal.aborted) cancelled(); });
    if (await Promise.race([running.then(() => false), stopped])) {
      try { await runDocker(['stop', '--timeout', '15', identity], AbortSignal.timeout(30000)); }
      finally { attachment.abort(); }
    }
    await running;
  } catch (error) { failure = error; }
  finally {
    if (cancelled) signal.removeEventListener('abort', cancelled); attachment.abort();
    if (running) try { await running; } catch (error) { failure ??= error; }
    const removed = await captureDocker(['rm', '--force', identity]);
    if (removed.code !== 0) {
      const remaining = await captureDocker(['container', 'ls', '--all', '--no-trunc', '--filter', 'id=' + identity, '--format', '{{.ID}}']);
      if (remaining.code !== 0 || remaining.output.trim()) failure = new Error('Owned container cleanup is not confirmed', { cause: failure });
    }
  }
  if (failure !== undefined && !(signal.aborted && failure instanceof Error && failure.name === 'AbortError')) throw failure;
}
export function cgroupArguments(parent?: string): string[] {
  if (parent === undefined) return [];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.slice$/u.test(parent)) throw new Error('Cgroup parent must be an existing systemd slice unit name');
  return ['--cgroup-parent', parent];
}
export function runArguments(directory: string, image: string, port: number, contentPort: number, cgroupParent?: string): string[] {
  const name = 'crossfire-' + createHash('sha256').update(directory).digest('hex').slice(0, 16);
  return ['run', '--name', name, '--label', 'org.crossfire.directory=' + directory,
    '--publish', '127.0.0.1:' + port + ':8080', '--publish', '127.0.0.1:' + contentPort + ':8082', '--mount', 'type=bind,"source=' + directory.replaceAll('"', '""') + '",target=/runtime',
    ...cgroupArguments(cgroupParent), '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', image];
}
export function migrationArguments(directory: string, image: string, cgroupParent?: string): string[] {
  const name = 'crossfire-migration-' + createHash('sha256').update(directory).digest('hex').slice(0, 16);
  return ['run', '--name', name, '--mount', 'type=bind,"source=' + directory.replaceAll('"', '""') + '",target=/runtime',
    ...cgroupArguments(cgroupParent), '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', image];
}
