import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { migrateDatabase } from '@ctlflow/crossfire-data/management/sqlite/configuration';
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { conduitFixture } from "../scripts/architecture-proof/conduit-fixture.js";
import { buildRelease } from "../scripts/build-release.js";
import { authority } from "@ctlflow/crossfire-adapter-matrix/account/authority";
import { serve } from "../apps/server/src/main.js";
import { secret } from "./support/application.js";
import type { Config } from "../apps/server/src/config.js";
import { writeJson } from "@ctlflow/crossfire-adapter-filesystem/index";

test("native authority shutdown aborts reads and serialized provisioning without replay", { timeout: 10_000 }, async scope => {
  const paths: string[] = [];
  const server = createServer(request => { paths.push(request.url ?? ""); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  cleanup(scope, () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }));
  const address = server.address();
  assert(address && typeof address === "object");
  const native = authority({ serverName: "tests.localhost",
    matrixOrigin: "http://127.0.0.1:" + address.port,
    registrationSecret: secret(), jwtSecret: secret(), serviceMatrixId: '@crossfire-shutdown:tests.localhost' });
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
  const probes = [createServer(), createServer()];
  const ports: number[] = [];
  for (const probe of probes) {
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    cleanup(scope, () => new Promise<void>(resolve => probe.listening ? probe.close(() => resolve()) : resolve()));
    const address = probe.address();
    assert(address && typeof address === "object");
    ports.push(address.port);
  }
  const [port, contentPort] = ports as [number, number];
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".temp/service-lifecycle-"));
  const config: Config = { instance: "lifecycle", serverName: "architecture.localhost",
    publicOrigin: "http://127.0.0.1:" + port, contentOrigin: 'http://localhost:' + contentPort, matrixOrigin: native.base,
    administrator: "@admin:architecture.localhost", registrationSecret: native.registrationToken, jwtSecret };
  writeJson(join(directory, "config.json"), config);
  writeJson(join(directory, "bootstrap.json"), { servicePassword: secret(), administratorPassword: secret() });
  const output = join(directory, "release");
  const release = await buildRelease(process.cwd(), join(process.cwd(), 'apps/web/dist'), output);
  for (const probe of probes) await new Promise<void>(resolve => probe.close(() => resolve()));
  await migrateDatabase(join(directory, 'management.sqlite'));
  const service = await serve(directory, join(output, "onboarding", release.release), port, {}, contentPort);
  cleanup(scope, service.close);
  const health = await fetch(config.publicOrigin + "/api/health", { signal: AbortSignal.timeout(5000) });
  assert.equal(health.status, 200);
  const identity = (await health.json() as { data: { startedAt: number } }).data;
  assert(Number.isFinite(identity.startedAt));
  assert.deepEqual(identity, { instance: config.instance, version: release.version, release: release.release,
    startedAt: identity.startedAt, loggingRetentionDays: 7, loggingError: null });
  await service.worker.drain();
  await Promise.all([service.close(), service.close()]);
  assert.equal(service.server.listening, false);
  assert.equal(service.contentServer.listening, false);
  assert.equal((await service.application.services.matrix.identify("closed")).ok, false);
  assert.throws(() => service.application.services.repositories.instancePolicy.find({ id: 'instance' }), /database connection is not open/);
});
