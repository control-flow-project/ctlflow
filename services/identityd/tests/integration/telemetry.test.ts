import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  CreateSessionResponse,
  GetInvocationVerificationKeysResponse,
  IssueInvocationResponse,
  ListPrincipalGroupsResponse,
  ResolvePrincipalResponse
} from "../generated/v1/identityd.js";
import {
  getIdentitydTestContext
} from "../suite/get-identityd-test-context.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
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

test("exports correlated and redacted traces, metrics, and logs", async () => {
  const context = getIdentitydTestContext();
  const traceId = "1234567890abcdef1234567890abcdef";
  const invocationToken = context.invocation.sign({
    tenantId: "acme",
    tokenId: "telemetry-redaction-token"
  });
  const metadata = workloadMetadata(
    context.policydWorkload.callerToken,
    invocationToken);
  metadata.set(
    "traceparent",
    `00-${traceId}-1234567890abcdef-01`);

  const result = await callUnary<ResolvePrincipalResponse>((done) =>
    context.client.resolvePrincipal(
      {
        principalId: "user:alice",
        tenantId: "acme"
      },
      metadata,
      done));
  assert.equal(result.principalId, "user:alice");

  await waitForExport(
    context.collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "identityd.ResolvePrincipal");
      const database = spans.find(
        (span) => span.name === "identityd.db.resolve_account");
      return typeof server?.spanId === "string"
        && database?.parentSpanId === server.spanId;
    });
  await waitForExport(
    context.collector.metricsPath,
    (value) =>
      value.includes("ctlflow.identityd.requests")
      && value.includes("ctlflow.identityd.duration"));
  await waitForExport(
    context.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "ResolvePrincipal",
      outcome: "OK",
      traceId
    }));

  const exports = await readAllExports(context.collector);
  for (const secret of [
    "user:alice",
    "acme",
    context.policydWorkload.callerToken,
    invocationToken
  ]) {
    assert.equal(exports.includes(secret), false);
  }

  const malformedParent = workloadMetadata(
    context.policydWorkload.callerToken,
    context.invocation.sign({ tenantId: "acme" }));
  malformedParent.set("traceparent", "not-a-traceparent");
  const malformedResult =
    await callUnary<ResolvePrincipalResponse>((done) =>
      context.client.resolvePrincipal(
        {
          principalId: "user:alice",
          tenantId: "acme"
        },
        malformedParent,
        done));
  assert.equal(malformedResult.principalId, "user:alice");
});

test("every operation emits correlated telemetry and Session audit",
  async () => {
    const context = getIdentitydTestContext();
    const traceId = "0123456789abcdef0123456789abcdef";
    const auditBefore =
      (await context.auditd.readIdentitySessionEvents()).length;

    await callUnary<GetInvocationVerificationKeysResponse>((done) =>
      context.client.getInvocationVerificationKeys(
        {},
        tracedMetadata(
          context.tenantdWorkload.callerToken,
          traceId),
        done));
    const invocation = context.invocation.sign({
      tenantId: "acme",
      tokenId: "telemetry-all-operations"
    });
    await callUnary<ResolvePrincipalResponse>((done) =>
      context.client.resolvePrincipal(
        {
          principalId: "user:alice",
          tenantId: "acme"
        },
        tracedMetadata(
          context.policydWorkload.callerToken,
          traceId,
          invocation),
        done));
    await callUnary<ListPrincipalGroupsResponse>((done) =>
      context.client.listPrincipalGroups(
        {
          principalId: "user:alice",
          tenantId: "acme",
          pageSize: 50
        },
        tracedMetadata(
          context.policydWorkload.callerToken,
          traceId,
          invocation),
        done));
    const session = await callUnary<CreateSessionResponse>((done) =>
      context.client.createSession(
        {
          tenantId: "acme",
          providerId: "oidc",
          providerSubject: "alice@example.com"
        },
        tracedMetadata(
          context.authdWorkload.callerToken,
          traceId),
        done));
    const exchanged = await callUnary<IssueInvocationResponse>((done) =>
      context.client.exchangeSession(
        {
          sessionCredential: session.sessionCredential,
          tenantId: "acme"
        },
        tracedMetadata(
          context.edgedWorkload.callerToken,
          traceId),
        done));
    await callUnary<IssueInvocationResponse>((done) =>
      context.client.issueRunInvocation(
        {
          principalId: "user:alice",
          tenantId: "acme",
          runId: "telemetry-run"
        },
        tracedMetadata(
          context.execdWorkload.callerToken,
          traceId),
        done));
    await callUnary((done) =>
      context.client.revokeSession(
        { sessionCredential: session.sessionCredential },
        tracedMetadata(
          context.authdWorkload.callerToken,
          traceId),
        done));

    const operations = [
      "GetInvocationVerificationKeys",
      "ResolvePrincipal",
      "ListPrincipalGroups",
      "CreateSession",
      "ExchangeSession",
      "IssueRunInvocation",
      "RevokeSession"
    ] as const;
    await waitForExport(
      context.collector.logsPath,
      (value) => operations.every((operation) =>
        hasOperationLog(value, {
          operation,
          outcome: "OK",
          traceId
        })));
    await waitForExport(
      context.collector.tracesPath,
      (value) => {
        const names = new Set(
          findSpansForTrace(value, traceId)
            .map((span) => span.name));
        return operations.every((operation) =>
          names.has(`identityd.${operation}`));
      });
    await waitForExport(
      context.collector.metricsPath,
      (value) =>
        value.includes("ctlflow.identityd.requests")
        && value.includes("ctlflow.identityd.duration")
        && operations.every((operation) => value.includes(operation)));

    const auditAfter = await context.auditd.readIdentitySessionEvents();
    const events = auditAfter.slice(auditBefore);
    assert.deepEqual(
      events.map((event) => event.action),
      ["created", "revoked"]);
    for (const event of events) {
      assert.equal(event.traceId, traceId);
      assert.match(
        event.receivedTraceparent ?? "",
        new RegExp(`^00-${traceId}-[a-f0-9]{16}-01$`, "u"));
    }

    const exports = await readAllExports(context.collector);
    for (const sensitive of [
      "alice@example.com",
      "user:alice",
      "acme",
      session.sessionId,
      session.sessionCredential.toString("hex"),
      session.sessionCredential.toString("base64"),
      exchanged.invocationJwt
    ]) {
      assert.equal(exports.includes(sensitive), false);
    }
  });

test("records cancellation for an in-flight database query", async () => {
  const context = getIdentitydTestContext();
  const traceId = "abcdef1234567890abcdef1234567890";
  const metadata = workloadMetadata(
    context.policydWorkload.callerToken,
    context.invocation.sign({ tenantId: "acme" }));
  metadata.set(
    "traceparent",
    `00-${traceId}-abcdef1234567890-01`);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  let cancelCall: (() => void) | undefined;
  const blockedCall = new Promise<never>((_resolve, reject) => {
    const call = context.client.resolvePrincipal(
      {
        principalId: "user:alice",
        tenantId: "acme"
      },
      metadata,
      (error) => {
        reject(error ?? new Error("Cancelled RPC returned no error"));
      });
    call.on("error", () => undefined);
    cancelCall = () => call.cancel();
  });
  try {
    await assert.rejects(
      callUnary<ResolvePrincipalResponse>((done) =>
        context.client.resolvePrincipal(
          {
            principalId: "",
            tenantId: "acme"
          },
          metadata,
          done)),
      matchGrpcStatus(status.INVALID_ARGUMENT));
    assert.ok(cancelCall);
    cancelCall();
    await assert.rejects(
      blockedCall,
      matchGrpcStatus(status.CANCELLED));
  } finally {
    cancelCall?.();
    await blockedCall.catch(() => undefined);
    await context.database.connection.raw("ROLLBACK");
  }
  await waitForExport(
    context.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "ResolvePrincipal",
      outcome: "CANCELLED",
      traceId
    }));
});

test("records a deadline exceeded for a blocked query", async () => {
  const context = getIdentitydTestContext();
  const traceId = "fedcba0987654321fedcba0987654321";
  const metadata = workloadMetadata(
    context.policydWorkload.callerToken,
    context.invocation.sign({ tenantId: "acme" }));
  metadata.set(
    "traceparent",
    `00-${traceId}-fedcba0987654321-01`);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  const blockedCall = callUnary<ResolvePrincipalResponse>((done) =>
    context.client.resolvePrincipal(
      {
        principalId: "user:alice",
        tenantId: "acme"
      },
      metadata,
      { deadline: Date.now() + 2_000 },
      done));
  try {
    await assert.rejects(
      blockedCall,
      matchGrpcStatus(status.DEADLINE_EXCEEDED));
  } finally {
    await blockedCall.catch(() => undefined);
    await context.database.connection.raw("ROLLBACK");
  }
  await waitForExport(
    context.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "ResolvePrincipal",
      outcome: "DEADLINE_EXCEEDED",
      traceId
    }));
});

test("telemetry outage is bounded and preserves the result", async () => {
  const context = getIdentitydTestContext();
  await context.collector.suspend();
  try {
    const started = performance.now();
    const result = await callUnary<ResolvePrincipalResponse>((done) =>
      context.client.resolvePrincipal(
        {
          principalId: "user:alice",
          tenantId: "acme"
        },
        workloadMetadata(
          context.policydWorkload.callerToken,
          context.invocation.sign({ tenantId: "acme" })),
        { deadline: Date.now() + 2_000 },
        done));
    assert.equal(result.principalId, "user:alice");
    assert.ok(performance.now() - started < 1_800);
  } finally {
    await context.collector.resume();
  }
});

function tracedMetadata(
  workloadToken: string,
  traceId: string,
  invocationToken?: string
) {
  const metadata = workloadMetadata(workloadToken, invocationToken);
  metadata.set(
    "traceparent",
    `00-${traceId}-0011223344556677-01`);
  return metadata;
}
