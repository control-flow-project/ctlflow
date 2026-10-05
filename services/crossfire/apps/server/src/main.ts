import { once } from "node:events";
import type { Server } from 'node:http';
import { join } from "node:path";
import { config } from "./config.js";
import { bootstrap, bootstrapSecrets } from "./bootstrap.js";
import { createApplication } from './composition.js';
import { createHttpServer } from './http/create-server.js';
import { createWorker } from './worker.js';
import { createContentServer } from './content-server.js';
import { readJson } from "@crossfire/adapter-filesystem/index";
import { loadRelease } from "@crossfire/adapter-filesystem/release";
import type { ElementPresentation } from './element-configuration.js';

async function closeHttp(server: Server): Promise<void> {
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

export async function serve(directory: string, releaseDirectory: string, port = 8080, presentation: ElementPresentation = {}, contentPort = port + 1, contentAddress = '127.0.0.1') {
  if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) < 26) throw new Error("Crossfire requires Linux and Node.js 26+");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid private service port");
  if (!Number.isSafeInteger(contentPort) || contentPort < 1024 || contentPort > 65535 || contentPort === port) throw new Error('Invalid separate content port');
  const release = loadRelease(releaseDirectory);
  const configuration = config(readJson<unknown>(join(directory, "config.json")));
  const secrets = bootstrapSecrets(readJson<unknown>(join(directory, "bootstrap.json")));
  if (!configuration.ok) throw new Error(configuration.error.message);
  if (!secrets.ok) throw new Error(secrets.error.message);
  const initialized = await bootstrap(configuration.value, secrets.value);
  if (!initialized.ok) throw new Error(initialized.error.message);
  const application = createApplication(join(directory, 'management.sqlite'), configuration.value);
  const worker = createWorker(application.services);
  const server = createHttpServer(application, worker, release, presentation);
  const contentServer = createContentServer(application);
  async function shutdown(): Promise<void> {
    try { application.services.matrix.close(); }
    finally {
      try { await Promise.all([closeHttp(contentServer), closeHttp(server)]); }
      finally { try { await worker.stop(); } finally { application.close(); } }
    }
  }
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    contentServer.listen(contentPort, contentAddress);
    await once(contentServer, 'listening');
    worker.wake();
  } catch (error) { await shutdown(); throw error; }
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= shutdown();
    return closing;
  }
  return { close, application, server, contentServer, worker };
}
