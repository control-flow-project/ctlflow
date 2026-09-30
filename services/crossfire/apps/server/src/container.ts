import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { serve } from './main.js';
import { config } from './config.js';
import { publicRouter } from './router.js';
import { readElementPresentation } from './element-configuration.js';
import { readJson, privateDir } from '@crossfire/adapter-filesystem/index';

process.umask(0o077);
const directory = '/runtime';
const artifacts = fileURLToPath(new URL('../../../', import.meta.url));
const parsed = config(readJson(join(directory, 'config.json')));
if (!parsed.ok) throw new Error(parsed.error.message);
if (parsed.value.matrixOrigin !== 'http://127.0.0.1:6167') throw new Error('Container Matrix origin must use its private loopback port');
privateDir(join(directory, 'matrix'));
const toml = '[global]\n' + Object.entries({ server_name: parsed.value.serverName, database_path: '/runtime/matrix',
  database_backend: 'rocksdb', address: '127.0.0.1', port: 6167, max_request_size: 20_971_520,
  allow_registration: true, registration_token: parsed.value.registrationSecret, jwt_secret: parsed.value.jwtSecret,
  allow_room_creation: true, allow_federation: false, allow_encryption: false, allow_check_for_updates: false,
  trusted_servers: [], log: 'warn' }).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join('\n') + '\n';
writeFileSync('/tmp/conduit.toml', toml, { mode: 0o600 });
const conduit = spawn('/usr/local/bin/conduit', [], { env: { ...process.env, CONDUIT_CONFIG: '/tmp/conduit.toml' }, stdio: 'inherit' });
const ended = once(conduit, 'close');
const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, () => stop.abort());
void ended.then(() => {
  if (!stop.signal.aborted) { console.error('Homeserver stopped unexpectedly'); process.exitCode = 1; stop.abort(); }
}).catch(error => { console.error(String(error)); process.exitCode = 1; stop.abort(); });
let service: Awaited<ReturnType<typeof serve>> | undefined;
let router: ReturnType<typeof publicRouter> | undefined;
try {
  const deadline = Date.now() + 60_000;
  for (;;) {
    stop.signal.throwIfAborted();
    try {
      const ready = await fetch(parsed.value.matrixOrigin + '/_matrix/client/versions', { signal: AbortSignal.any([stop.signal, AbortSignal.timeout(1000)]) });
      if (ready.ok) break;
    } catch { stop.signal.throwIfAborted(); }
    if (Date.now() >= deadline) throw new Error('Homeserver readiness timed out');
    await delay(100, undefined, { signal: stop.signal });
  }
  const releases = readdirSync(join(artifacts, 'onboarding'));
  if (releases.length !== 1) throw new Error('Image must contain exactly one onboarding release');
  service = await serve(directory, join(artifacts, 'onboarding', releases[0]!), 8081, readElementPresentation('/app/element', parsed.value.publicOrigin));
  router = publicRouter({ publicOrigin: parsed.value.publicOrigin, matrixOrigin: parsed.value.matrixOrigin,
    serviceOrigin: 'http://127.0.0.1:8081', web: join(artifacts, 'web'), element: '/app/element' });
  router.listen(8080, '0.0.0.0');
  await once(router, 'listening');
  console.log('Crossfire ready: ' + parsed.value.publicOrigin + '/ | Management: ' + parsed.value.publicOrigin + '/manage/');
  if (!stop.signal.aborted) await once(stop.signal, 'abort');
} catch (error) {
  if (!stop.signal.aborted) { console.error(error instanceof Error ? error.message : 'Stack failed'); process.exitCode = 1; }
} finally {
  if (router) { router.closeAllConnections(); await new Promise<void>(resolve => router!.close(() => resolve())); }
  await service?.close();
  conduit.kill('SIGTERM');
  const timer = setTimeout(() => conduit.kill('SIGKILL'), 5000);
  try { await ended; } finally { clearTimeout(timer); }
}
