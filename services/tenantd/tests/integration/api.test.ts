import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TenantServiceService
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import {
  readProbeStatus
} from "../support/read-probe-status.js";

test("tenantd exposes exactly the approved RPC inventory", () => {
  assert.deepEqual(
    Object.keys(TenantServiceService),
    [
      "createTenant",
      "getTenant",
      "listTenants",
      "updateTenant",
      "setTenantState",
      "createWorkspace",
      "getWorkspace",
      "listWorkspaces",
      "updateWorkspace",
      "setWorkspaceState",
      "resolveTenant",
      "resolveWorkspace"
    ]);
});

test("tenantd health and readiness probes are available", async () => {
  const context = getTenantdTestContext();
  assert.equal(await readProbeStatus(context.probePort, "/healthz"), 204);
  assert.equal(await readProbeStatus(context.probePort, "/readyz"), 204);
});
