import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { mkdtempSync, lstatSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { validateHost } from './host.js';
import { quote } from './terminal.js';
import { decodeAuthentication } from '@ctlflow/fleetd-storage/authentication';
import remoteAuthentication from '../assets/authentication.json' with { type: 'json' };

async function readRemoteAuthentication(host: string, signal: AbortSignal): Promise<string> {
  try {
    const result = await promisify(execFile)('ssh', ['-T', '-o', 'StrictHostKeyChecking=yes', host, 'sh -c ' + quote(remoteAuthentication.script)],
      { signal, timeout: 15000, maxBuffer: 4096, encoding: 'buffer', killSignal: 'SIGKILL' });
    const key = decodeAuthentication(result.stdout).authenticationKey;
    if (!key) throw new Error('Remote fleetd authentication key is missing; start its controller first');
    return key;
  } catch { throw new Error('Cannot read remote fleetd authentication through trusted SSH'); }
}

export async function openTunnel(host: string, root: string, signal: AbortSignal) {
  signal.throwIfAborted();
  validateHost(host);
  if (!root.startsWith('/') || /[:\x00-\x1f\x7f]/u.test(root)) throw new Error('Remote root must be an absolute Unix path without colon or control characters');
  const authenticationKey = await readRemoteAuthentication(host, signal);
  const directory = mkdtempSync(join(tmpdir(), 'fleet-ssh-')), socketPath = join(directory, 'daemon.sock');
  const child = spawn('ssh', ['-N', '-T', '-o', 'ExitOnForwardFailure=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'StreamLocalBindUnlink=no',
    '-L', socketPath + ':' + join(root, 'fleetd.sock'), host], { stdio: ['inherit', 'ignore', 'inherit'] });
  let failure: Error | undefined;
  const ended = once(child, 'close').then(() => { failure = new Error('SSH tunnel closed'); }, () => { failure = new Error('SSH could not start'); });
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => { signal.removeEventListener('abort', abort); child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      try { await ended; } finally { clearTimeout(timer); rmSync(directory, { recursive: true, force: true }); } })();
    return closing;
  }
  function abort() { void close(); }
  signal.addEventListener('abort', abort, { once: true });
  try {
    const deadline = Date.now() + 120000;
    while (!existsSync(socketPath)) {
      signal.throwIfAborted(); if (failure) throw failure;
      if (Date.now() > deadline) throw new Error('SSH forwarding timed out');
      await delay(50, undefined, { signal });
    }
    if (!lstatSync(socketPath).isSocket()) throw new Error('SSH did not create its private Unix socket');
    return { socketPath, authenticationKey, close };
  } catch (error) { await close(); throw error; }
}
