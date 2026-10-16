import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

type CommandOutput = { code: number | null; output: string; errors: string };
function command(args: string[], capture: boolean, signal?: AbortSignal): Promise<CommandOutput> {
  signal?.throwIfAborted();
  return new Promise((resolveCommand, reject) => {
    const child = spawn('docker', args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '', outputBytes = 0, errorBytes = 0, failed: Error | undefined, escalation: NodeJS.Timeout | undefined;
    const stdout = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }), stderr = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
    const kill = (value: NodeJS.Signals) => { if (child.pid !== undefined) try { process.kill(-child.pid, value); } catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; } };
    const stop = () => { kill('SIGTERM'); escalation ??= setTimeout(() => kill('SIGKILL'), 3000); };
    const append = (previous: string, bytes: Buffer, decoder: TextDecoder, total: number) => {
      if (capture && total > 65536) { failed ??= new Error('Docker response exceeds its output bound'); stop(); return previous; }
      try {
        const next = previous + decoder.decode(bytes, { stream: true }), start = Math.max(0, next.length - 65536), first = next.charCodeAt(start);
        return next.slice(first >= 0xdc00 && first <= 0xdfff ? start + 1 : start);
      } catch (error) { failed ??= new Error('Docker response is not valid UTF-8', { cause: error }); stop(); return previous; }
    };
    child.stdout.on('data', (bytes: Buffer) => { if (capture) outputBytes += bytes.length; output = append(output, bytes, stdout, outputBytes); });
    child.stderr.on('data', (bytes: Buffer) => { if (capture) errorBytes += bytes.length; errors = append(errors, bytes, stderr, errorBytes); });
    if (!capture) { child.stdout.pipe(process.stderr, { end: false }); child.stderr.pipe(process.stderr, { end: false }); }
    child.once('error', error => { failed ??= error; });
    child.once('close', code => {
      clearTimeout(escalation); signal?.removeEventListener('abort', stop);
      if (!failed) try { output += stdout.decode(); errors += stderr.decode(); } catch (error) { failed = new Error('Docker response is not valid UTF-8', { cause: error }); }
      if (failed) reject(failed); else if (signal?.aborted) reject(signal.reason as unknown); else resolveCommand({ code, output, errors });
    });
    signal?.addEventListener('abort', stop, { once: true }); if (signal?.aborted) stop();
  });
}
export function dockerCaptureTimeout(args: readonly string[]): number {
  return args[0] === 'create' || args[0] === 'stop' || args[0] === 'rm' ? 120000 : 30000;
}
export async function captureDocker(args: string[], signal?: AbortSignal): Promise<CommandOutput> {
  const deadline = AbortSignal.timeout(dockerCaptureTimeout(args));
  try { return await command(args, true, signal ? AbortSignal.any([signal, deadline]) : deadline); }
  catch (error) { if (signal?.aborted) throw error; throw new Error('Docker ' + args[0] + ' failed: ' + (error instanceof Error ? error.message : String(error)), { cause: error }); }
}
export async function runDocker(args: string[], signal?: AbortSignal): Promise<void> {
  const result = await command(args, false, signal);
  if (result.code !== 0) throw new Error('Docker command failed with exit ' + result.code + '\n' + result.errors + '\n' + result.output);
}
export function cgroupArguments(parent?: string): string[] {
  if (parent === undefined) return [];
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}\.slice$/u.test(parent)) throw new Error('Cgroup parent must be an existing systemd slice unit name');
  return ['--cgroup-parent', parent];
}
export function containerNames(directory: string): { runtime: string; migration: string } {
  const digest = createHash('sha256').update(directory).digest('hex').slice(0, 16);
  return { runtime: 'crossfire-' + digest, migration: 'crossfire-migration-' + digest };
}
export function runArguments(directory: string, image: string, port: number, contentPort: number, cgroupParent?: string): string[] {
  const name = containerNames(directory).runtime;
  return ['run', '--name', name, '--label', 'org.crossfire.directory=' + directory,
    '--publish', '127.0.0.1:' + port + ':8080', '--publish', '127.0.0.1:' + contentPort + ':8082', '--mount', 'type=bind,"source=' + directory.replaceAll('"', '""') + '",target=/runtime',
    ...cgroupArguments(cgroupParent), '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', image];
}
export function migrationArguments(directory: string, image: string, cgroupParent?: string): string[] {
  const name = containerNames(directory).migration;
  return ['run', '--name', name, '--label', 'org.crossfire.directory=' + directory, '--mount', 'type=bind,"source=' + directory.replaceAll('"', '""') + '",target=/runtime',
    ...cgroupArguments(cgroupParent), '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,nosuid,nodev,size=128m',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', image];
}
