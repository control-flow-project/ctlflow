import { once } from 'node:events';
import { resolve, join } from 'node:path';
import { serve } from './main.js';
import { config } from './config.js';
import { publicRouter } from './router.js';
import { readElementPresentation } from './element-configuration.js';
import { readJson } from '@ctlflow/crossfire-adapter-filesystem/index';

export async function standalone(args: string[]): Promise<void> {
  if (args.length < 4 || args.length > 6) throw new Error('Use serve STATE RELEASE WEB ELEMENT [PORT] [CONTENT_PORT]');
  const [state, release, web, element] = args.slice(0, 4).map(value => resolve(value));
  if (!state || !release || !web || !element) throw new Error('Supply all four owned runtime/asset directories');
  const port = Number(args[4] ?? '8080'), contentPort = Number(args[5] ?? '8082');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(contentPort) || contentPort < 1024 || contentPort > 65535 || port === contentPort) throw new Error('Use separate private ports within 1024..65535');
  const configured = config(readJson<unknown>(join(state, 'config.json'))); if (!configured.ok) throw new Error(configured.error.message);
  const application = await serve(state, release, 0, readElementPresentation(element, configured.value.publicOrigin), contentPort);
  const address = application.server.address(); if (!address || typeof address === 'string') { await application.close(); throw new Error('Private API did not bind'); }
  const router = publicRouter({ publicOrigin: configured.value.publicOrigin, matrixOrigin: configured.value.matrixOrigin,
    service: application.server, web, element });
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => { router.closeAllConnections(); if (router.listening) await new Promise<void>(resolveClose => router.close(() => resolveClose())); await application.close(); })();
  const stopped = new Promise<void>(resolveStop => {
    const stop = () => { void close().then(resolveStop, error => { console.error(error instanceof Error ? error.message : 'Server shutdown failed'); process.exitCode = 1; resolveStop(); }); };
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.once(signal, stop);
    router.once('close', () => { for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.removeListener(signal, stop); resolveStop(); });
  });
  try { router.listen(port, '127.0.0.1'); await once(router, 'listening'); console.log(JSON.stringify({ status: 'ready', publicOrigin: configured.value.publicOrigin })); await stopped; }
  finally { await close(); }
}
