import { once } from 'node:events';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from './main.js';
import { config } from './config.js';
import { publicRouter } from './router.js';
import { readElementPresentation } from '@ctlflow/crossfire-adapter-matrix/web/element-configuration';
import { matrixConfiguration } from '@ctlflow/crossfire-adapter-matrix/config';
import { matrixPublicRoutes } from '@ctlflow/crossfire-adapter-matrix/web/router';
import { startMatrix } from '@ctlflow/crossfire-adapter-matrix/container';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';
import { createDiagnosticLog } from '@ctlflow/crossfire-adapter-filesystem/logging';
import { loggingRetentionDays } from '@ctlflow/crossfire-kernel/logging';

process.umask(0o077);
const directory = '/runtime';
const artifacts = fileURLToPath(new URL('../../../', import.meta.url));
const parsed = config(readJson(join(directory, 'config.json')));
if (!parsed.ok) throw new Error(parsed.error.message);
const retention = loggingRetentionDays(parsed.value.loggingRetentionDays);
if (!retention.ok) throw new Error(retention.error.message);
const diagnostics = createDiagnosticLog('/runtime/management.sqlite.logs', retention.value);
const fatal = (error: Error) => diagnostics.write('Crossfire process failed: ' + error.message);
process.on('uncaughtExceptionMonitor', fatal);
const messaging = matrixConfiguration(parsed.value.messaging); if (!messaging.ok) throw new Error(messaging.error.message);
const backend = startMatrix(messaging.value, message => diagnostics.write(message));
const stop = new AbortController();
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.once(signal, () => stop.abort());
void backend.closed.then(() => {
  if (!stop.signal.aborted) { diagnostics.write('Homeserver stopped unexpectedly'); process.exitCode = 1; stop.abort(); }
}).catch(error => { diagnostics.write(String(error)); process.exitCode = 1; stop.abort(); });
let service: Awaited<ReturnType<typeof serve>> | undefined;
let router: ReturnType<typeof publicRouter> | undefined;
try {
  await backend.ready(stop.signal);
  const releases = readdirSync(join(artifacts, 'onboarding'));
  if (releases.length !== 1) throw new Error('Image must contain exactly one onboarding release');
  service = await serve(directory, join(artifacts, 'onboarding', releases[0]!), 8081, readElementPresentation('/app/element', parsed.value.publicOrigin), 8082, '0.0.0.0', diagnostics);
  router = publicRouter({ publicOrigin: parsed.value.publicOrigin, service: service.server, web: join(artifacts, 'web'),
    backend: matrixPublicRoutes({ publicOrigin: parsed.value.publicOrigin, matrixOrigin: messaging.value.matrixOrigin, service: service.server, element: '/app/element' }) });
  router.listen(8080, '0.0.0.0');
  await once(router, 'listening');
  diagnostics.write('Crossfire ready: ' + parsed.value.publicOrigin + '/ | Management: ' + parsed.value.publicOrigin + '/manage/');
  if (!stop.signal.aborted) await once(stop.signal, 'abort');
} catch (error) {
  if (!stop.signal.aborted) { diagnostics.write(error instanceof Error ? error.message : 'Stack failed'); process.exitCode = 1; }
} finally {
  if (router) { router.closeAllConnections(); await new Promise<void>(resolve => router!.close(() => resolve())); }
  await service?.close();
  await backend.close();
  process.removeListener('uncaughtExceptionMonitor', fatal);
  diagnostics.close();
}
