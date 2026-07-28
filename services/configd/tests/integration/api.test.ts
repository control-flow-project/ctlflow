import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ConfigurationServiceService
} from "../generated/v1/configd.js";
import {
  getConfigdTestContext
} from "../suite/get-configd-test-context.js";
import {
  readProbeStatus
} from "../support/read-probe-status.js";

test("configd exposes exactly the approved RPC inventory", () => {
  assert.deepEqual(
    Object.keys(ConfigurationServiceService),
    [
      "publishConfiguration",
      "resolveConfiguration",
      "publishSecret",
      "getSecretMetadata",
      "applyProjection"
    ]);
});

test("configd health and readiness probes are available", async () => {
  const context = getConfigdTestContext();
  assert.equal(await readProbeStatus(context.probePort, "/healthz"), 204);
  assert.equal(await readProbeStatus(context.probePort, "/readyz"), 204);
});
