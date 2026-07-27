import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AuditServiceService
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  readProbeStatus
} from "../support/read-probe-status.js";

test("auditd exposes exactly the approved RPC inventory", () => {
  assert.deepEqual(
    Object.keys(AuditServiceService),
    ["recordAuditBatch"]);
});

test("auditd health and readiness probes are available", async () => {
  const context = getAuditdTestContext();
  assert.equal(await readProbeStatus(context.probePort, "/healthz"), 204);
  assert.equal(await readProbeStatus(context.probePort, "/readyz"), 204);
});
