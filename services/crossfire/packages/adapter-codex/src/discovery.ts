import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { realpathSync, openSync, closeSync, fstatSync, readFileSync, constants } from 'node:fs';
import { fields } from '../../contracts/src/management.js';
import { UUID } from '../../contracts/src/client.js';
import { readJson } from '../../files/src/index.js';
import { connectCodex } from './connection.js';
import type { RuntimeAdapter } from '../../agent-core/src/runtime.js';

export function discoverCodex(workspace: string, environment: NodeJS.ProcessEnv = process.env) {
  const file = environment.RUNCODEX_CONNECTION_FILE;
  const session = environment.CODEX_THREAD_ID;
  if (!file || !session || !UUID.test(session)) throw new Error('Open this project with the current runcodex.sh and run connect inside that Codex session. Runtime connection details are supplied automatically; do not copy ports or secrets.');
  const parsed = fields(readJson<unknown>(file), ['version', 'endpoint', 'tokenFile']);
  if (!parsed.ok || parsed.value.version !== 1 || typeof parsed.value.endpoint !== 'string'
    || !/^ws:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/u.test(parsed.value.endpoint) || parsed.value.tokenFile !== 'token') {
    throw new Error('Invalid launcher connection descriptor; restart through the current runcodex.sh');
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
  const binding = createHash('sha256').update(JSON.stringify([realpathSync(file), endpoint, session, realpathSync(workspace), token])).digest('hex');
  const runtime: RuntimeAdapter = (stop, pollMs, hooks) => connectCodex({ workspace, session, endpoint, token, pollMs, timeoutMs: 30_000, hooks }, stop);
  return { name: 'codex', session, binding, runtime };
}
