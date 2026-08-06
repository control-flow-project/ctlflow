import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  callProductApp
} from "../support/product/call-product-app.js";
import {
  appPath,
  currentProductPod,
  fixture,
  grantedOperation,
  tenantId,
  workspaceId,
  workspacePath
} from "../support/product/product-fixtures.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";

test("propagates product trace context through authorization", async () => {
  const suite = getExecdTestSuite();
  // This fixture has not made a product call yet, so the same trace also
  // covers its cold verification-key bootstrap.
  const workload = fixture("roll_old");
  const traceId = "3210fedcba9876543210fedcba987654";
  const parentSpanId = "0123456789abcdef";
  await suite.collector.clearExports();
  const result = await callProductApp(
    suite.kubernetes,
    workload.namespace,
    await currentProductPod(workload),
    {
      operation: grantedOperation,
      resourcePath: appPath(
        workspacePath(workload.appId),
        "topics/general"),
      tenantId,
      workspaceId,
      invocationToken: suite.invocation.sign({ tenantId, workspaceId })
    },
    `00-${traceId}-${parentSpanId}-01`);
  assert.deepEqual(result, { decision: "allow" });

  await waitForExport(
    suite.collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "policyd.CheckAccess");
      const execution = spans.find((span) =>
        span.name
          === "policyd.execd.ResolveWorkloadOperationBinding");
      const identity = spans.find((span) =>
        span.name === "policyd.identityd.ResolvePrincipal");
      const keyBootstrap = spans.find((span) =>
        span.name === "identityd.GetInvocationVerificationKeys");
      return server?.parentSpanId === parentSpanId
        && typeof server.spanId === "string"
        && execution?.parentSpanId === server.spanId
        && identity?.parentSpanId === server.spanId
        && keyBootstrap?.parentSpanId === parentSpanId;
    });
});
