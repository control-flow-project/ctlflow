import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { realpathSync, openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs';
import { fields } from '@ctlflow/crossfire-contracts/validation';
import { UUID } from '@ctlflow/crossfire-contracts/client';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { connectCodex } from './connection.js';
import { localEndpoint } from './protocol.js';
import type { RuntimeAdapter } from '@ctlflow/crossfire-agent-core/runtime';

export function discoverCodex(workspace: string, environment: NodeJS.ProcessEnv = process.env) {
  const file = environment.RUNCODEX_CONNECTION_FILE;
  const session = environment.CODEX_THREAD_ID;
  if (!session || !UUID.test(session)) throw new Error('Run connection inside the Codex session you want to connect. Its native thread identity is required; do not guess one.');
  const connection = file ? launcherConnection(file) : nativeConnection(environment);
  const binding = createHash('sha256').update(JSON.stringify([connection.endpoint, session, realpathSync(workspace), connection.token])).digest('hex');
  const receiptFile = join(workspace, '.crossfire', 'runtime', session + '.receipt');
  const runtime: RuntimeAdapter = (stop, pollMs, hooks) => connectCodex({ workspace, session, ...connection, receiptFile, pollMs, timeoutMs: 30_000, hooks }, stop);
  return { name: 'codex', session, binding, runtime };
}
function nativeConnection(environment: NodeJS.ProcessEnv) {
  const socket = join(resolve(environment.CODEX_HOME ?? join(homedir(), '.codex')), 'app-server-control', 'app-server-control.sock');
  try { return { endpoint: localEndpoint('unix://' + socket), token: '' }; }
  catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') throw new Error('This session has no native app-server socket. Embedded / --no-daemon sessions cannot attach a listener. Ask the human to reopen/resume this saved session in normal app-server-backed Codex; runcodex.sh is optional. Native daemon startup: codex app-server daemon start.', { cause: error });
    throw error;
  }
}

function launcherConnection(file: string): { endpoint: string; token: string } {
  const parsed = fields(readJson<unknown>(file), ['version', 'endpoint', 'tokenFile']);
  if (!parsed.ok || parsed.value.version !== 1 || typeof parsed.value.endpoint !== 'string'
    || !/^ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(parsed.value.endpoint) || parsed.value.tokenFile !== 'token') {
    throw new Error('Invalid optional launcher connection descriptor');
  }
  const endpoint = parsed.value.endpoint;
  if (Number(new URL(endpoint).port) > 65535) throw new Error('Invalid launcher port');
  const descriptor = openSync(join(dirname(file), 'token'), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  let token: string;
  try {
    const info = fstatSync(descriptor);
    if (!info.isFile() || info.uid !== process.getuid!() || info.size < 1 || info.size > 4096 || (info.mode & 0o077) !== 0) throw new Error('Launcher credential must be a private owned regular file');
    token = readFileSync(descriptor, 'utf8').trim();
    if (!token || /\s/u.test(token)) throw new Error('Invalid launcher credential');
  } finally { closeSync(descriptor); }
  return { endpoint, token };
}
