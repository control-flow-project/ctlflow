import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import type { MatrixConfiguration } from './config.js';

export const matrixReadinessPath = '/_matrix/client/versions';

export function startMatrix(configuration: MatrixConfiguration, log: (message: string) => void) {
  if (configuration.matrixOrigin !== 'http://127.0.0.1:6167') throw new Error('Container Matrix origin must use its private loopback port');
  mkdirSync('/runtime/matrix', { recursive: true, mode: 0o700 });
  const toml = '[global]\n' + Object.entries({ server_name: configuration.serverName, database_path: '/runtime/matrix',
    database_backend: 'rocksdb', address: '127.0.0.1', port: 6167, max_request_size: 20_971_520,
    allow_registration: true, registration_token: configuration.registrationSecret, jwt_secret: configuration.jwtSecret,
    allow_room_creation: true, allow_federation: false, allow_encryption: false, allow_check_for_updates: false,
    trusted_servers: [], log: 'warn' }).map(([key, value]) => key + ' = ' + JSON.stringify(value)).join('\n') + '\n';
  writeFileSync('/tmp/conduit.toml', toml, { mode: 0o600 });
  const conduit = spawn('/usr/local/bin/conduit', [], { env: { ...process.env, CONDUIT_CONFIG: '/tmp/conduit.toml' }, stdio: ['ignore', 'pipe', 'pipe'] });
  for (const stream of [conduit.stdout, conduit.stderr]) { stream.setEncoding('utf8'); stream.on('data', (message: string) => log('Matrix: ' + message)); }
  const closed = once(conduit, 'close').then(() => undefined);
  let closing: Promise<void> | undefined;
  return {
    closed,
    async ready(signal: AbortSignal) {
      const deadline = Date.now() + 60_000;
      for (;;) {
        signal.throwIfAborted();
        if (conduit.exitCode !== null || conduit.signalCode !== null) throw new Error('Homeserver stopped before readiness');
        try { const response = await fetch(configuration.matrixOrigin + matrixReadinessPath, { signal: AbortSignal.any([signal, AbortSignal.timeout(1000)]) }); if (response.ok) return; }
        catch { signal.throwIfAborted(); }
        if (Date.now() >= deadline) throw new Error('Homeserver readiness timed out');
        await delay(100, undefined, { signal });
      }
    },
    close(): Promise<void> {
      return closing ??= (async () => {
        conduit.kill('SIGTERM'); const timer = setTimeout(() => conduit.kill('SIGKILL'), 5000);
        try { await closed; } finally { clearTimeout(timer); }
      })();
    },
  };
}
