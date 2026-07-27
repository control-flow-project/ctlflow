import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import type {
  AuditEvent,
  RecordAuditBatchResponse
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  createAuditEvent
} from "../support/audit-events/create-audit-event.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";

test("requires exactly one canonical Bearer workload token", async () => {
  const context = getAuditdTestContext();
  const noAuthentication = new Metadata();
  await assert.rejects(
    record([], noAuthentication),
    matchGrpcStatus(status.UNAUTHENTICATED));

  for (const value of [
    "",
    "Basic credential",
    "bearer credential",
    "Bearer",
    "Bearer ",
    "Bearer a b",
    `Bearer ${"a".repeat(16_385)}`
  ]) {
    const metadata = new Metadata();
    metadata.set("authorization", value);
    await assert.rejects(
      record([validTenantEvent()], metadata),
      matchGrpcStatus(status.UNAUTHENTICATED),
      value.slice(0, 32));
  }

  const duplicate = new Metadata();
  duplicate.set(
    "authorization",
    `Bearer ${context.workloads.tenantd.callerToken},`
    + `Bearer ${context.workloads.tenantd.callerToken}`);
  await assert.rejects(
    record([validTenantEvent()], duplicate),
    matchGrpcStatus(status.UNAUTHENTICATED));
});

test("rejects invalid bound workload identity claims", async () => {
  const context = getAuditdTestContext();
  const workload = context.workloads.tenantd;
  for (const token of [
    "not-a-token",
    corruptSignature(workload.callerToken),
    workload.expiredToken,
    workload.overlongToken,
    workload.unboundToken,
    workload.wrongAudienceToken
  ]) {
    await assert.rejects(
      record(
        [validTenantEvent()],
        workloadMetadata(token)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("rejects a valid but unadmitted workload", async () => {
  const context = getAuditdTestContext();
  await assert.rejects(
    record(
      [validTenantEvent()],
      workloadMetadata(
        context.workloads.tenantd.unadmittedToken)),
    matchGrpcStatus(status.PERMISSION_DENIED));
});

test("authentication precedes ordinary body validation", async () => {
  await assert.rejects(
    record([], new Metadata()),
    matchGrpcStatus(status.UNAUTHENTICATED));
});

test("transport rejects an encoded request above 256 KiB", async () => {
  const context = getAuditdTestContext();
  const oversized = validTenantEvent();
  oversized.attribution = {
    operatorCommonName: "x".repeat(300 * 1024)
  };
  await assert.rejects(
    record(
      [oversized],
      workloadMetadata(
        context.workloads.tenantd.callerToken)),
    matchGrpcStatus(status.RESOURCE_EXHAUSTED));
});

function validTenantEvent(): AuditEvent {
  return createAuditEvent({
    tenantMutation: {
      action: 1,
      resourceRevision: 1n,
      resultingState: 1
    }
  });
}

async function record(
  events: readonly AuditEvent[],
  metadata: Metadata
): Promise<RecordAuditBatchResponse> {
  const context = getAuditdTestContext();
  return await callUnary((done) =>
    context.client.recordAuditBatch(
      { events: [...events] },
      metadata,
      done));
}

function corruptSignature(token: string): string {
  const segments = token.split(".");
  assert.equal(segments.length, 3);
  const signature = segments[2]!;
  const replacement = signature[0] === "a" ? "b" : "a";
  return `${segments[0]}.${segments[1]}.${replacement}${signature.slice(1)}`;
}
