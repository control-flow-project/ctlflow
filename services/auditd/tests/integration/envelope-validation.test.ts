import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  AuditEvent,
  IdentitySessionAction,
  TenancyResourceState,
  TenantMutationAction,
  type DeepPartial
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  createAuditEvent
} from "../support/audit-events/create-audit-event.js";
import {
  invocationAttribution
} from "../support/audit-events/invocation-attribution.js";
import {
  operatorAttribution
} from "../support/audit-events/operator-attribution.js";
import {
  tenantPartition
} from "../support/audit-events/tenant-partition.js";
import {
  workloadAttribution
} from "../support/audit-events/workload-attribution.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  recordAuditBatch
} from "../support/record-audit-batch.js";

test("requires every event envelope field and oneof", async () => {
  const valid = tenantEvent();
  const invalid: readonly DeepPartial<AuditEvent>[] = [
    { occurredAt: undefined },
    { attribution: undefined },
    { attribution: {} },
    { partition: undefined },
    { partition: {} },
    { tenantMutation: undefined },
    {
      tenantMutation: undefined,
      workspaceMutation: undefined,
      identitySession: undefined,
      packageDeclaration: undefined,
      appMutation: undefined,
      configurationPublication: undefined,
      secretPublication: undefined,
      projectionMutation: undefined,
      placementMutation: undefined,
      workloadMutation: undefined,
      runMutation: undefined
    }
  ];
  for (const [index, override] of invalid.entries()) {
    await expectInvalid(
      AuditEvent.create({ ...valid, ...override }),
      `required field ${String(index)}`);
  }
});

test("validates event, trace, span, partition, and timestamp values", async () => {
  const valid = tenantEvent();
  const invalid: readonly DeepPartial<AuditEvent>[] = [
    { sourceEventId: "" },
    { sourceEventId: `evt_${"A".repeat(32)}` },
    { sourceEventId: `evt_${"a".repeat(31)}` },
    { sourceEventId: `bad_${"a".repeat(32)}` },
    { traceId: "0".repeat(32) },
    { traceId: "A".repeat(32) },
    { traceId: "a".repeat(31) },
    { spanId: "0".repeat(16) },
    { spanId: "A".repeat(16) },
    { spanId: "a".repeat(15) },
    { partition: tenantPartition("") },
    { partition: tenantPartition("Upper") },
    { partition: tenantPartition("a".repeat(65)) },
    { occurredAt: new Date(Date.UTC(10_000, 0, 1)) }
  ];
  for (const [index, override] of invalid.entries()) {
    await expectInvalid(
      AuditEvent.create({ ...valid, ...override }),
      `envelope value ${String(index)}`);
  }
});

test("accepts operator common-name boundary lengths", async () => {
  const context = getAuditdTestContext();
  for (const commonName of ["a", "x".repeat(253)]) {
    const event = tenantEvent();
    event.attribution = operatorAttribution(commonName);
    const result = await recordAuditBatch(
      context,
      context.workloads.tenantd,
      [event]);
    assert.equal(
      result.acceptances[0]?.sourceEventId,
      event.sourceEventId);
  }
});

test("rejects invalid operator common names", async () => {
  for (const commonName of [
    "",
    "x".repeat(254),
    "contains space",
    "contains\u00a0space",
    "contains\ncontrol",
    "\u0000"
  ]) {
    const event = tenantEvent();
    event.attribution = operatorAttribution(commonName);
    await expectInvalid(event, JSON.stringify(commonName));
  }
});

test("validates workload attribution subjects", async () => {
  const context = getAuditdTestContext();
  for (const subject of [
    "",
    "identityd",
    "system:serviceaccount:namespace",
    "system:serviceaccount:Upper:identityd",
    "system:serviceaccount:namespace:-identityd",
    `system:serviceaccount:${"a".repeat(64)}:identityd`,
    "system:serviceaccount:namespace:identityd:extra"
  ]) {
    const event = identityEvent(
      context.workloads.identityd.callerSubject);
    event.attribution = workloadAttribution(subject);
    await assert.rejects(
      recordAuditBatch(
        context,
        context.workloads.identityd,
        [event]),
      matchGrpcStatus(status.INVALID_ARGUMENT),
      subject);
  }
});

test("validates invocation Actor and attached account structure", async () => {
  const context = getAuditdTestContext();
  const subject = context.workloads.tenantd.callerSubject;
  for (const attribution of [
    invocationAttribution(subject, "", "user:maya"),
    invocationAttribution(subject, "user:maya", ""),
    invocationAttribution(subject, "group:maya", "user:maya"),
    invocationAttribution(subject, "user:maya", "agent:maya"),
    invocationAttribution(subject, "user:maya", "user:other"),
    invocationAttribution(subject, "service:one", "service:two"),
    invocationAttribution(
      subject,
      `agent:${"a".repeat(251)}`,
      "user:maya")
  ]) {
    const event = tenantUpdateEvent(subject);
    event.attribution = attribution;
    await expectInvalid(event, JSON.stringify(attribution));
  }
});

test("accepts a virtual Actor distinct from its attached account", async () => {
  const context = getAuditdTestContext();
  const event = tenantUpdateEvent(
    context.workloads.tenantd.callerSubject);
  event.attribution = invocationAttribution(
    context.workloads.tenantd.callerSubject,
    "agent:reviewer",
    "service:automation");
  const result = await recordAuditBatch(
    context,
    context.workloads.tenantd,
    [event]);
  assert.equal(
    result.acceptances[0]?.sourceEventId,
    event.sourceEventId);
});

function tenantEvent(): AuditEvent {
  return createAuditEvent({
    tenantMutation: {
      action:
        TenantMutationAction.TENANT_MUTATION_ACTION_CREATE_TENANT,
      resourceRevision: 1n,
      resultingState:
        TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE
    }
  });
}

function tenantUpdateEvent(subject: string): AuditEvent {
  return createAuditEvent({
    tenantMutation: {
      action:
        TenantMutationAction.TENANT_MUTATION_ACTION_UPDATE_TENANT,
      resourceRevision: 2n,
      resultingState:
        TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE
    }
  }, {
    attribution: invocationAttribution(subject)
  });
}

function identityEvent(subject: string): AuditEvent {
  return createAuditEvent({
    identitySession: {
      sessionId: "a".repeat(32),
      humanAccountPrincipalId: "user:maya",
      sessionRevision: 1n,
      action: IdentitySessionAction.IDENTITY_SESSION_ACTION_CREATED
    }
  }, {
    attribution: workloadAttribution(subject)
  });
}

async function expectInvalid(
  event: AuditEvent,
  message: string
): Promise<void> {
  const context = getAuditdTestContext();
  await assert.rejects(
    recordAuditBatch(
      context,
      context.workloads.tenantd,
      [event]),
    matchGrpcStatus(status.INVALID_ARGUMENT),
    message);
}
