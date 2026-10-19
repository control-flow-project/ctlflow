import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from "node:assert/strict";
import test from "node:test";
import { conduitFixture } from "../scripts/architecture-proof/conduit-fixture.js";
import { bootstrap } from "@ctlflow/crossfire-adapter-matrix/bootstrap";
import { authority } from "@ctlflow/crossfire-adapter-matrix/account/authority";
import { secret } from "./support/application.js";
import { serviceUser } from '@ctlflow/crossfire-adapter-matrix/config';
import { matrixSettings } from './support/matrix-config.js';
import { API } from '@ctlflow/crossfire-adapter-matrix/protocol';
import { nativeOk, nativeRequest } from '@ctlflow/crossfire-adapter-matrix/http';
import type { Config } from "../apps/server/src/config.js";
import type { Result } from "@ctlflow/crossfire-kernel/result";

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? "" : result.error.message);
  return result.value;
}

test("private service bootstrap survives a human password change without resetting or adopting native authority", { timeout: 120_000 }, async scope => {
  const jwtSecret = secret();
  const fixture = await conduitFixture(scope, { jwtSecret });
  const config: Config = { instance: "bootstrap", publicOrigin: "http://127.0.0.1", contentOrigin: 'http://localhost',
    messaging: { type: 'matrix', parameters: { serverName: 'architecture.localhost', origin: fixture.base, registrationSecret: fixture.registrationToken, jwtSecret } },
    administrator: "@admin:architecture.localhost" };
  const credentials = { servicePassword: secret(), administratorPassword: secret() };
  const configuration = { ...matrixSettings(config), instance: config.instance, administrator: config.administrator };
  value(await bootstrap(configuration, credentials));
  const native = authority({ ...configuration, serviceBackendUserId: serviceUser(config.instance, configuration) });
  cleanup(scope, () => native.close());
  const human = value(await native.provision(config.administrator, credentials.administratorPassword, "CROSSFIRE_HUMAN"));
  const client = { base: fixture.base, token: human.access_token };
  assert.deepEqual(value(await nativeOk(client, "GET", API + "/joined_rooms")).joined_rooms, []);
  const password = secret();
  const challenge = value(await nativeRequest(client, "POST", API + "/account/password", { new_password: password, logout_devices: false }));
  assert.equal(challenge.status, 401);
  assert.equal(typeof challenge.body.session, "string");
  value(await nativeOk(client, "POST", API + "/account/password", { new_password: password, logout_devices: false,
    auth: { type: "m.login.password", session: challenge.body.session,
      identifier: { type: "m.id.user", user: human.user_id }, password: credentials.administratorPassword } }));
  const devices = value(await nativeOk(client, "GET", API + "/devices")).devices;
  assert(Array.isArray(devices));
  value(await bootstrap(configuration, credentials));
  const after = value(await nativeOk(client, "GET", API + "/devices")).devices;
  assert(Array.isArray(after));
  const ids = (entries: typeof devices) => entries.map(device => {
    assert(device && typeof device === "object" && !Array.isArray(device));
    return device.device_id;
  }).sort();
  assert.deepEqual(ids(after), ids(devices));
  const old = value(await nativeRequest({ base: fixture.base }, "POST", API + "/login", {
    type: "m.login.password", identifier: { type: "m.id.user", user: human.user_id }, password: credentials.administratorPassword,
  }));
  assert.equal(old.status, 403);
  assert.equal(value(await native.identify(value(await native.provision(human.user_id, password, "CROSSFIRE_HUMAN")).access_token)), human.user_id);
  assert.equal((await bootstrap({ ...configuration, instance: "unrelated" }, credentials)).ok, false);
});
