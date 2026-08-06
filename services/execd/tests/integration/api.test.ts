import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ExecutionServiceService
} from "../generated/v1/execd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  readProbeStatus
} from "../support/read-probe-status.js";

test("execd exposes exactly the approved RPC inventory", () => {
  assert.deepEqual(
    Object.keys(ExecutionServiceService),
    [
      "declarePlacement",
      "getPlacement",
      "listPlacements",
      "declareWorkload",
      "getWorkload",
      "listWorkloads",
      "createRun",
      "getRun",
      "listRuns",
      "cancelRun",
      "resolveWorkloadOperationBinding"
    ]);
});

test("execd health and readiness probes are available", async () => {
  const context = getExecdTestContext();
  assert.equal(await readProbeStatus(context.probePort, "/healthz"), 204);
  assert.equal(await readProbeStatus(context.probePort, "/readyz"), 204);
});
