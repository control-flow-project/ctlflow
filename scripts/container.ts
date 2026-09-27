import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { INSTANCES, load } from './instance.ts';
import { accounts } from './bootstrap.ts';
import { Lease, type Heartbeat } from './lease.ts';
import { Matrix, name, readJson, type Settings } from '../skills/conduit-chat/scripts/lib.ts';

process.umask(0o077);
const { values } = parseArgs({ options: { instance: { type: 'string' } } });
const instance = name(values.instance ?? '');
const config = load(instance);
const privatePath = join(INSTANCES, instance, 'private');
const settings = readJson<Settings>(join(privatePath, 'settings.json'));
const runId = process.env.CROSSFIRE_RUN_ID;
if (!runId) throw new Error('Start this container through the Crossfire CLI');
const lease = new Lease(runId);
let stopping = false;
const conduit = spawn('/usr/local/bin/conduit', [], {
  stdio: 'inherit', env: { ...process.env, CONDUIT_CONFIG: join(privatePath, 'conduit.toml') },
});
function shutdown(code: number): void {
  if (stopping) return;
  stopping = true;
  conduit.kill('SIGTERM');
  if (conduit.exitCode !== null || conduit.signalCode !== null) process.exit(code);
  conduit.once('exit', () => process.exit(code));
  setTimeout(() => { conduit.kill('SIGKILL'); process.exit(code); }, 8000).unref();
}
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => shutdown(0));
conduit.on('error', error => { console.error(error.message); shutdown(1); });
conduit.on('exit', () => { if (!stopping) { console.error('Conduit stopped; closing the instance.'); process.exit(1); } });
setInterval(() => {
  try { lease.observe(readJson<Heartbeat>(join(privatePath, 'lease.json'))); } catch { /* tolerate an in-progress heartbeat */ }
  if (lease.expired()) { console.log('Controlling terminal stopped; shutting down.'); shutdown(0); }
}, 1000).unref();

try {
  for (let attempt = 0; ; attempt++) {
    try { await new Matrix(settings.homeserver).get('/_matrix/client/versions'); break; }
    catch (error) { if (attempt >= 149) throw error; await delay(200); }
  }
  await accounts(config, privatePath, settings);
  await import('./room-service.ts');
} catch (error) { console.error(error instanceof Error ? error.message : 'Instance startup failed'); shutdown(1); }
