import { once } from "node:events";
import { join } from "node:path";
import { config } from "./config.js";
import { bootstrap, bootstrapSecrets } from "./bootstrap.js";
import { createApplication } from './composition.js';
import { createHttpServer } from './http/create-server.js';
import { createWorker } from './worker.js';
import { readJson } from "../../../packages/files/src/index.js";
import { loadRelease } from "../../../packages/files/src/release.js";

export async function serve(directory: string, releaseDirectory: string, port = 8080) {
  if (process.platform !== "linux" || Number(process.versions.node.split(".")[0]) < 26) throw new Error("Crossfire requires Linux and Node.js 26+");
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid private service port");
  const release = loadRelease(releaseDirectory);
  const configuration = config(readJson<unknown>(join(directory, "config.json")));
  const secrets = bootstrapSecrets(readJson<unknown>(join(directory, "bootstrap.json")));
  if (!configuration.ok) throw new Error(configuration.error.message);
  if (!secrets.ok) throw new Error(secrets.error.message);
  const initialized = await bootstrap(configuration.value, secrets.value);
  if (!initialized.ok) throw new Error(initialized.error.message);
  const application = createApplication(join(directory, 'management.sqlite'), configuration.value);
  const worker = createWorker(application.services);
  const server = createHttpServer(application, worker, release);
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    worker.wake();
  } catch (error) { application.services.matrix.close(); await worker.stop(); application.close(); throw error; }
  let closing: Promise<void> | undefined;
  function close(): Promise<void> {
    closing ??= (async () => {
      application.services.matrix.close();
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      await worker.stop();
      application.close();
    })();
    return closing;
  }
  return { close, application, server, worker };
}
