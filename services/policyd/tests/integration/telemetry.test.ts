import assert from "node:assert/strict";
import {
  performance
} from "node:perf_hooks";
import {
  test
} from "node:test";
import {
  AccessDecision
} from "../generated/v1/policyd.js";
import {
  getPolicydTestContext
} from "../suite/get-policyd-test-context.js";
import {
  callCheckAccess
} from "../support/call-check-access.js";
import {
  directGrant
} from "../support/direct-grant.js";
import {
  principalFact
} from "../support/principal-fact.js";
import {
  findSpansForTrace
} from "../support/telemetry/find-spans-for-trace.js";
import {
  hasOperationLog
} from "../support/telemetry/has-operation-log.js";
import {
  readAllExports
} from "../support/telemetry/read-all-exports.js";
import {
  waitForExport
} from "../support/telemetry/wait-for-export.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

const request = {
  operation: "tenants.read",
  resourcePath: "/tenants/acme",
  tenantId: "acme"
};

test("exports correlated, parented, redacted traces, metrics, and logs",
  async () => {
    const context = await arrangeAllow();
    const traceId = "1234567890abcdef1234567890abcdef";
    const invocation = context.invocation.sign({
      tenantId: "acme",
      tokenId: "telemetry-secret-token"
    });
    const metadata = workloadMetadata(
      context.workloads.tenantd.callerToken,
      invocation);
    metadata.set(
      "traceparent",
      `00-${traceId}-1234567890abcdef-01`);
    const response = await callCheckAccess(request, { metadata });
    assert.equal(
      response.decision,
      AccessDecision.ACCESS_DECISION_ALLOW);

    await waitForExport(
      context.collector.tracesPath,
      (value) => {
        const spans = findSpansForTrace(value, traceId);
        const server = spans.find(
          (span) => span.name === "policyd.CheckAccess");
        const database = spans.find(
          (span) => span.name === "policyd.db.find_rules");
        const identity = spans.find(
          (span) => span.name === "policyd.identityd.ResolvePrincipal");
        return typeof server?.spanId === "string"
          && database?.parentSpanId === server.spanId
          && identity?.parentSpanId === server.spanId;
      });
    await waitForExport(
      context.collector.metricsPath,
      (value) =>
        value.includes("ctlflow.policyd.requests")
        && value.includes("ctlflow.policyd.decisions")
        && value.includes("ctlflow.policyd.duration")
        && value.includes("allow"));
    await waitForExport(
      context.collector.logsPath,
      (value) => hasOperationLog(value, "OK", traceId));

    const exports = await readAllExports(context.collector);
    for (const sensitive of [
      "user:alice",
      "acme",
      "/tenants/acme",
      context.workloads.tenantd.callerToken,
      invocation
    ]) {
      assert.equal(exports.includes(sensitive), false);
    }
  });

test("Collector outage is bounded and does not change a decision", async () => {
  const context = await arrangeAllow();
  await context.collector.suspend();
  const started = performance.now();
  try {
    const response = await callCheckAccess(request);
    assert.equal(
      response.decision,
      AccessDecision.ACCESS_DECISION_ALLOW);
    assert.ok(performance.now() - started < 1_000);
  } finally {
    await context.collector.resume();
  }
});

async function arrangeAllow() {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([principalFact()]);
  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant("tenants.read", "/tenants/acme")]
  });
  return context;
}
