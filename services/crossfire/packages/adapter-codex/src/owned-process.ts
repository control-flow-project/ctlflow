import { spawn, execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { writeFileSync, unlinkSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { privateDir } from '@ctlflow/crossfire-adapter-filesystem/index';
import { ownedVersion, ownedQuestionCapability } from './owned-options.js';

export async function startProcess(home: string, workspace: string, stop: AbortSignal, binary = 'codex', questions = false) {
  stop.throwIfAborted();
  const environment: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: realpathSync(home) };
  for (const name of Object.keys(environment)) if (name === 'CODEX_THREAD_ID' || name.startsWith('RUNCODEX_')) delete environment[name];
  const version = execFileSync(binary, ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 4096, env: environment, cwd: workspace }).trim();
  const supported = ownedVersion(version);
  if (!supported.ok) throw new Error(supported.error.message);
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
  const child = spawn(binary, ['app-server', '--listen', 'ws://127.0.0.1:0', '--ws-auth', 'capability-token', '--ws-token-file', tokenFile], { cwd: workspace, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  const lifetime = new AbortController();
  const ended = once(child, 'close').then(() => { lifetime.abort(new Error('Owned Codex process exited')); }, () => { lifetime.abort(new Error('Owned Codex process could not start')); });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      stop.removeEventListener('abort', onAbort);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }, 3000);
      try { await ended; } finally { clearTimeout(timer); unlinkSync(tokenFile); }
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
