import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PackageServiceService
} from "../generated/v1/pkgd.js";
import {
  getPkgdTestContext
} from "../suite/get-pkgd-test-context.js";
import {
  readProbeStatus
} from "../support/read-probe-status.js";

test("pkgd exposes exactly the approved RPC inventory", () => {
  assert.deepEqual(
    Object.keys(PackageServiceService),
    [
      "declarePackage",
      "getPackage",
      "createApp",
      "getApp",
      "setAppPackageGeneration"
    ]);
});

test("pkgd health and readiness probes are available", async () => {
  const context = getPkgdTestContext();
  assert.equal(await readProbeStatus(context.probePort, "/healthz"), 204);
  assert.equal(await readProbeStatus(context.probePort, "/readyz"), 204);
});
