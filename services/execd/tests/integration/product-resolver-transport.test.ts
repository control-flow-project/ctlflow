import assert from "node:assert/strict";
import {
  setTimeout as delay
} from "node:timers/promises";
import { test } from "node:test";
import {
  status,
  type ClientUnaryCall
} from "@grpc/grpc-js";
import type {
  ResolveWorkloadOperationBindingResponse
} from "../generated/v1/execd.js";
import {
  getExecdTestContext
} from "../suite/get-execd-test-context.js";
import {
  getExecdTestSuite
} from "../suite/get-execd-test-suite.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  appPath,
  fixture,
  grantedOperation,
  productCheck,
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
import {
  workloadMetadata
} from "../support/workload-metadata.js";

const resolverRequest = {
  serviceAccountSubject: "",
  operation: grantedOperation
};

test("resolver honors in-flight cancellation", async () => {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
  const chat = fixture("chat_ws");
  const traceId = "41000000000000000000000000000001";
  const metadata = workloadMetadata(policyd.callerToken);
  metadata.set("traceparent", `00-${traceId}-0000000000000001-01`);

  await context.database.connection.raw("BEGIN EXCLUSIVE");
  let call: ClientUnaryCall | undefined;
  try {
    const pending = new Promise<ResolveWorkloadOperationBindingResponse>(
      (resolve, reject) => {
        const started = context.capabilityClient
          .resolveWorkloadOperationBinding(
            {
              ...resolverRequest,
              serviceAccountSubject: chat.subject
            },
            metadata,
            (error, response) => error === null
              ? resolve(response)
              : reject(error));
        started.on("error", () => undefined);
        call = started;
      });
    await delay(100);
    call?.cancel();
    await assert.rejects(
      pending,
      matchGrpcStatus(status.CANCELLED));
  } finally {
    await context.database.connection.raw("ROLLBACK");
  }

  await waitForResolverOutcome(traceId, "CANCELLED");
});

test("resolver honors in-flight deadlines", async () => {
  const context = getExecdTestContext();
  const suite = getExecdTestSuite();
  const policyd = await suite.kubernetes.createWorkloadCredentials("policyd");
  const chat = fixture("chat_ws");
  const traceId = "41000000000000000000000000000002";
  const metadata = workloadMetadata(policyd.callerToken);
  metadata.set("traceparent", `00-${traceId}-0000000000000002-01`);

  await context.database.connection.raw("BEGIN EXCLUSIVE");
  try {
    await assert.rejects(
      callUnary((done) => context.capabilityClient
        .resolveWorkloadOperationBinding(
          {
            ...resolverRequest,
            serviceAccountSubject: chat.subject
          },
          metadata,
          { deadline: Date.now() + 500 },
          done)),
      matchGrpcStatus(status.DEADLINE_EXCEEDED));
  } finally {
    await context.database.connection.raw("ROLLBACK");
  }

  await waitForResolverOutcome(traceId, "DEADLINE_EXCEEDED");
});

test("preserves the Execd dependency deadline", async () => {
  const context = getExecdTestContext();
  const chat = fixture("chat_ws");
  const request = {
    operation: grantedOperation,
    resourcePath: appPath(workspacePath(chat.appId), "topics/general"),
    tenantId,
    workspaceId
  };

  await context.database.connection.raw("BEGIN EXCLUSIVE");
  try {
    const result = await productCheck(chat, request);
    assert.equal(result.decision, undefined);
    assert.equal(result.error?.stage, "policy");
    assert.equal(result.error?.code, status.DEADLINE_EXCEEDED);
  } finally {
    await context.database.connection.raw("ROLLBACK");
  }

  assert.deepEqual(await productCheck(chat, request), { decision: "allow" });
});

async function waitForResolverOutcome(
  traceId: string,
  outcome: string
): Promise<void> {
  await waitForExport(
    getExecdTestSuite().collector.tracesPath,
    (content) => findSpansForTrace(content, traceId).some((span) =>
      span.name === "execd.ResolveWorkloadOperationBinding"
      && span.attributes?.some((attribute) =>
        attribute.key === "ctlflow.outcome"
        && attribute.value?.stringValue === outcome) === true));
}
