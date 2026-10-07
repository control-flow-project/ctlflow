import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';
import { ownedVersion, ownedQuestionCapability } from './owned-options.js';
import { nativeEnvironment } from './prerequisites.js';
import { inspectInstructionCapability } from './capability.js';

export async function startProcess(home: string, workspace: string, stateDirectory: string, profile: string, stop: AbortSignal, binary = 'codex', questions = false) {
  stop.throwIfAborted();
  const environment = nativeEnvironment(realpathSync(home), stateDirectory, profile);
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 4096, env: environment, cwd: workspace }).trim();
  const supported = ownedVersion(version);
  if (!supported.ok) throw new Error(supported.error.message);
  const instructions = await inspectInstructionCapability(binary, home, workspace, environment, stop);
  if (!instructions.ok) throw new Error(instructions.error.message);
  if (questions) {
    const listing = execFileSync(binary, ['features', 'list'], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536, env: environment, cwd: workspace });
    const capability = ownedQuestionCapability(listing);
    if (!capability.ok) throw new Error(capability.error.message);
  }
  stop.throwIfAborted();
  const path = process.env.PATH;
  if (!path || path.length > 4096 || /[\x00-\x1f\x7f]/u.test(path)) throw new Error('Codex requires a bounded native executable search path');
  const token = randomBytes(32).toString('hex'), tokenFile = join(privateDir(home), '.crossfire-token-' + randomBytes(12).toString('hex'));
  writeFileSync(tokenFile, token, { flag: 'wx', mode: 0o600 });
  const child = spawn(binary, ['app-server', '--listen', 'ws://127.0.0.1:0', '--ws-auth', 'capability-token', '--ws-token-file', tokenFile], { cwd: workspace, env: environment, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const lifetime = new AbortController();
  const ended = once(child, 'close').then(() => { lifetime.abort(new Error('Owned Codex process exited')); }, () => { lifetime.abort(new Error('Owned Codex process could not start')); });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      stop.removeEventListener('abort', onAbort);
      function terminate(signal: NodeJS.Signals): void {
        if (child.pid === undefined) return;
        try { process.kill(-child.pid, signal); }
        catch (error) { if (!(error instanceof Error && 'code' in error && error.code === 'ESRCH')) throw error; }
      }
      let rejectEscalation!: (error: unknown) => void;
      const escalation = new Promise<never>((_resolve, reject) => { rejectEscalation = reject; });
      const timer = setTimeout(() => { try { terminate('SIGKILL'); } catch (error) { rejectEscalation(error); } }, 3000);
      try { terminate('SIGTERM'); await Promise.race([ended, escalation]); unlinkSync(tokenFile); }
      finally { clearTimeout(timer); }
    })();
    return closing;
  }
  function onAbort() { void close(); }
  stop.addEventListener('abort', onAbort, { once: true });
  try {
    const endpoint = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => finish(new Error('Codex readiness timed out')), 15000);
      function finish(result: string | Error) { clearTimeout(timer); stop.removeEventListener('abort', abort); result instanceof Error ? reject(result) : resolve(result); }
      function abort() { finish(new Error('Codex startup cancelled')); }
      stop.addEventListener('abort', abort, { once: true });
      function inspect(chunk: Buffer) {
        output = (output + chunk.toString()).slice(-64000);
        const match = /^\s*listening on: (ws:\/\/127\.0\.0\.1:\d+)\s*$/mu.exec(output);
        if (match) finish(match[1]!);
      }
      child.stdout.on('data', inspect); child.stderr.on('data', inspect);
      child.once('error', () => finish(new Error('Could not launch Codex')));
      void ended.then(() => finish(new Error('Codex exited before readiness')));
      if (stop.aborted) abort();
    });
    return { endpoint, token, tokenFile, binary, path, signal: lifetime.signal, close, pid: child.pid! };
  } catch (error) { await close(); throw error; }
}
