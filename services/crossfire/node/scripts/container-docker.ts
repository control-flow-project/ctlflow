import { spawn } from 'node:child_process';

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
export async function captureDocker(args: string[], signal?: AbortSignal): Promise<CommandOutput> {
  const deadline = AbortSignal.timeout(30000);
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
