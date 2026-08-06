import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { status } from "@grpc/grpc-js";
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
  findSpansForTrace,
  type OtlpSpan
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
  matchGrpcStatus
} from "../support/match-grpc-status.js";
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

test("records the Execd dependency span and its outcome", async () => {
  // The product branch resolves authority through Execd. This suite deploys
  // no Execd, so the call fails closed — and the dependency span must still
  // name the Execd RPC and carry its canonical outcome.
  const context = getPolicydTestContext();
  const traceId = "abcdef01234567890abcdef012345678";
  const invocation = context.invocation.sign({ tenantId: "acme" });
  const metadata = workloadMetadata(
    context.workloads.product.callerToken,
    invocation);
  metadata.set(
    "traceparent",
    `00-${traceId}-1234567890abcdef-01`);
  await assert.rejects(
    callCheckAccess(
      {
        operation: "messages.post",
        resourcePath: "/tenants/acme/apps/app_chat/topics/general",
        tenantId: "acme"
      },
      { metadata }),
    matchGrpcStatus(status.UNAVAILABLE));

  // The server span proves the trace correlated at all; the dependency span
  // is then asserted from the same export.
  await waitForExport(
    context.collector.tracesPath,
    (value) =>
      findSpansForTrace(value, traceId).some(
        (span) => span.name === "policyd.CheckAccess"));
  const spans = findSpansForTrace(
    await readFile(context.collector.tracesPath, "utf8"),
    traceId);
  const names = spans.map((span) => String(span.name)).join(", ");
  const server = spans.find(
    (span) => span.name === "policyd.CheckAccess");
  const dependency = spans.find(
    (span) =>
      span.name === "policyd.execd.ResolveWorkloadOperationBinding");
  assert.ok(dependency, `Execd dependency span among: ${names}`);
  assert.equal(dependency.parentSpanId, server?.spanId);
  assert.equal(
    attributeValue(dependency, "rpc.service"),
    "ctlflow.execution.v1.ExecutionService");
  assert.equal(
    attributeValue(dependency, "rpc.method"),
    "ResolveWorkloadOperationBinding");
  // The dependency was unreachable, so the recorded outcome is its canonical
  // failure status, never OK and never absent.
  const outcome = attributeValue(dependency, "ctlflow.outcome");
  assert.ok(outcome, `ctlflow.outcome recorded among: ${names}`);
  assert.notEqual(outcome, "OK");
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
    grants: [directGrant("svc_tenantd", "tenants.read", "/tenants/acme")]
  });
  return context;
}

function attributeValue(
  span: OtlpSpan | undefined,
  key: string
): string | undefined {
  const value = span?.attributes?.find(
    (item) => item.key === key)?.value?.stringValue;
  return typeof value === "string" ? value : undefined;
}
