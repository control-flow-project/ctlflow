import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdirSync, mkdtempSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { conduitFixture } from "../scripts/architecture-proof/conduit-fixture.js";
import { openStore } from "../apps/server/src/data/database.js";
import * as queries from "../apps/server/src/data/queries.js";
import { context, secret } from "../apps/server/src/context.js";
import { httpService } from "../apps/server/src/http.js";
import { reconciler } from "../apps/server/src/reconcile.js";
import { paths, readProfile } from "../packages/agent-core/src/state.js";
import { enroll, connect } from "../apps/client/src/enrollment.js";
import { API, nativeOk } from "../packages/matrix/src/http.js";
import type { Result } from "../packages/kernel/src/result.js";
import { releaseFixture } from "./release-fixture.js";

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

test("public documentation and local pairing enroll exactly one zero-room native identity", { timeout: 120_000 }, async scope => {
  const jwtSecret = secret();
  const native = await conduitFixture(scope, { jwtSecret });
  await native.register("crossfire-onboarding");
  const human = await native.register("admin");
  const store = openStore(":memory:");
  const ctx = context(store, { instance: "onboarding", serverName: "architecture.localhost", publicOrigin: "http://127.0.0.1",
    matrixOrigin: native.base, administrator: human.id, registrationSecret: native.registrationToken, jwtSecret });
  const worker = reconciler(ctx);
  const release = await releaseFixture();
  const server = httpService(ctx, worker, release);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address === "object");
  const origin = "http://127.0.0.1:" + address.port;
  ctx.config.publicOrigin = origin;
  scope.after(async () => {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await worker.stop();
    store.close();
  });
  const publicReadme = await fetch(origin + "/onboarding/" + release.manifest.release + "/README.md");
  assert.equal(publicReadme.status, 200);
  const documentation = await publicReadme.text();
  assert(!documentation.includes(native.registrationToken));
  assert(!documentation.includes(jwtSecret));
  mkdirSync(join(process.cwd(), ".temp"), { recursive: true });
  const project = mkdtempSync(join(process.cwd(), ".temp/project-onboarding-"));
  const destination = paths(project, "holmes");
  const requested = value(await enroll(destination, origin, human.id, "Holmes", release.manifest)) as { code: string; approvalUrl: string };
  assert(!JSON.stringify(requested).includes("secret"));
  assert.equal((value(await connect(destination, release.manifest)) as { status: string }).status, "pending");
  assert.equal(queries.agents(store, "", true).length, 0);
  assert.equal((await fetch(origin + "/_coord/enrollments/" + requested.approvalUrl.split("/").at(-1) + "/decision", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision: "approve", code: requested.code }),
  })).status, 403);
  const login = await fetch(origin + "/_coord/session", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ token: human.token }) });
  assert.equal(login.status, 200);
  const session = await login.json() as { csrf: string };
  const cookie = login.headers.get("set-cookie")!.split(";", 1)[0]!;
  const approved = await fetch(origin + "/_coord/enrollments/" + requested.approvalUrl.split("/").at(-1) + "/decision", {
    method: "POST", headers: { Origin: origin, Cookie: cookie, "X-Crossfire-CSRF": session.csrf, "Content-Type": "application/json" },
    body: JSON.stringify({ decision: "approve", code: requested.code }),
  });
  assert.equal(approved.status, 200);
  await worker.drain();
  const connected = value(await connect(destination, release.manifest)) as { status: string };
  assert.equal(connected.status, "connected");
  const profile = readProfile(destination.profile);
  assert.equal(profile.workspace, project);
  assert.equal(profile.settings.owner, human.id);
  assert.equal(statSync(destination.profile).mode & 0o777, 0o600);
  assert.equal(statSync(destination.pending).mode & 0o777, 0o600);
  assert.deepEqual(value(await nativeOk({ base: native.base, token: profile.account.access_token }, "GET", API + "/joined_rooms")).joined_rooms, []);
  assert.equal((await enroll(destination, origin, human.id, "Holmes", release.manifest)).ok, false);
  assert.equal((await connect(destination, release.manifest)).ok, true);
  assert.equal(queries.agents(store, "", true).length, 1);
  assert.deepEqual(JSON.parse(queries.agent(store, profile.id)!.grants), []);
});
