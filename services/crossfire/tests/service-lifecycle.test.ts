import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { conduitFixture } from "../scripts/architecture-proof/conduit-fixture.js";
import { buildRelease } from "../scripts/build-release.js";
import { authority } from "../apps/server/src/native.js";
import { serve } from "../apps/server/src/main.js";
import { secret } from "../apps/server/src/context.js";
import type { Config } from "../apps/server/src/config.js";
import { writeJson } from "../packages/files/src/index.js";

test("native authority shutdown aborts reads and serialized provisioning without replay", { timeout: 10_000 }, async scope => {
  const paths: string[] = [];
  const server = createServer(request => { paths.push(request.url ?? ""); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  scope.after(() => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert(address && typeof address === "object");
  const native = authority({ instance: "shutdown", serverName: "tests.localhost", publicOrigin: "http://127.0.0.1",
    matrixOrigin: "http://127.0.0.1:" + address.port, administrator: "@admin:tests.localhost",
    registrationSecret: secret(), jwtSecret: secret() });
  const reads = [native.identify("bounded-test-credential"), native.asUser("@admin:tests.localhost"),
    native.profileName("@agent:tests.localhost")];
  const provisioning = [native.provision("@agent:tests.localhost", secret()), native.provision("@agent:tests.localhost", secret())];
  const deadline = Date.now() + 5000;
  while (paths.length < 4) {
    assert(Date.now() < deadline, "Native requests were not started");
    await delay(10);
  }
  native.close();
  native.close();
  for (const result of await Promise.all([...reads, ...provisioning])) assert.equal(result.ok, false);
  assert.equal(paths.filter(path => path.endsWith("/register")).length, 1);
  assert.equal((await native.exists("@agent:tests.localhost")).ok, false);
  assert.equal(paths.filter(path => path.endsWith("/displayname")).length, 1);
  assert.equal(paths.length, 4);
});

test("private service starts with real native bootstrap and shuts down idempotently", { timeout: 120_000 }, async scope => {
  const jwtSecret = secret();
  const native = await conduitFixture(scope, { jwtSecret });
  const probe = createServer();
  probe.listen(0, "127.0.0.1");
  await once(probe, "listening");
  const address = probe.address();
  assert(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".temp/service-lifecycle-"));
  const config: Config = { instance: "lifecycle", serverName: "architecture.localhost",
    publicOrigin: "http://127.0.0.1:" + port, matrixOrigin: native.base,
    administrator: "@admin:architecture.localhost", registrationSecret: native.registrationToken, jwtSecret };
  writeJson(join(directory, "config.json"), config);
  writeJson(join(directory, "bootstrap.json"), { servicePassword: secret(), administratorPassword: secret() });
  const output = join(directory, "release");
  const release = await buildRelease(process.cwd(), output);
  const service = await serve(directory, join(output, "onboarding", release.release), port);
  scope.after(service.close);
  const health = await fetch(config.publicOrigin + "/_coord/health", { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  const identity = await health.json() as { startedAt: string; runtime: string };
  assert(Number.isFinite(Date.parse(identity.startedAt)));
  assert.deepEqual(identity, { instance: config.instance, version: release.version, release: release.release,
    runtime: 'node ' + process.versions.node, startedAt: identity.startedAt });
  await service.worker.drain();
  await Promise.all([service.close(), service.close()]);
  assert.equal(service.server.listening, false);
  assert.equal((await service.context.native.identify("closed")).ok, false);
  assert.throws(() => service.context.store.prepare("SELECT 1"), /not open|closed/);
});
