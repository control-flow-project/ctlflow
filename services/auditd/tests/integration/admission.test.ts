import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  AuditEvent
} from "../generated/v1/auditd.js";
import {
  getAuditdTestContext
} from "../suite/get-auditd-test-context.js";
import {
  createAdmittedAuditBatches
} from "../support/audit-events/create-admitted-audit-batches.js";
import {
  globalPartition
} from "../support/audit-events/global-partition.js";
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

test("only the owning source may submit each typed detail", async () => {
  const context = getAuditdTestContext();
  const batches = createAdmittedAuditBatches(context);
  for (const owner of batches) {
    for (const event of owner.events) {
      for (const caller of batches) {
        if (caller.name === owner.name) {
          continue;
        }
        await assert.rejects(
          recordAuditBatch(
            context,
            caller.workload,
            [event]),
          matchGrpcStatus(status.PERMISSION_DENIED),
          `${caller.name}:${owner.name}:${detailName(event)}`);
      }
    }
  }
});

test("source-specific attribution admission is exact", async () => {
  const context = getAuditdTestContext();
  const batches = new Map(
    createAdmittedAuditBatches(context)
      .map((batch) => [batch.name, batch] as const));
  const tenantd = batches.get("tenantd")!;
  const identityd = batches.get("identityd")!;
  const pkgd = batches.get("pkgd")!;
  const configd = batches.get("configd")!;
  const execd = batches.get("execd")!;

  const denied = [
    {
      workload: tenantd.workload,
      event: withAttribution(
        tenantd.events[0]!,
        invocationAttribution(tenantd.sourceSubject))
    },
    {
      workload: tenantd.workload,
      event: withAttribution(
        tenantd.events[3]!,
        workloadAttribution(tenantd.sourceSubject))
    },
    {
      workload: identityd.workload,
      event: withAttribution(
        identityd.events[0]!,
        operatorAttribution())
    },
    {
      workload: identityd.workload,
      event: withAttribution(
        identityd.events[2]!,
        workloadAttribution(identityd.sourceSubject))
    },
    {
      workload: pkgd.workload,
      event: withAttribution(
        pkgd.events[0]!,
        invocationAttribution(pkgd.sourceSubject))
    },
    {
      workload: pkgd.workload,
      event: withAttribution(
        pkgd.events[1]!,
        invocationAttribution(pkgd.sourceSubject))
    },
    {
      workload: pkgd.workload,
      event: withAttribution(
        pkgd.events[2]!,
        workloadAttribution(pkgd.sourceSubject))
    },
    {
      workload: configd.workload,
      event: withAttribution(
        configd.events[0]!,
        invocationAttribution(configd.sourceSubject))
    },
    {
      workload: configd.workload,
      event: withAttribution(
        configd.events[8]!,
        operatorAttribution())
    },
    {
      workload: execd.workload,
      event: withAttribution(
        execd.events[0]!,
        invocationAttribution(execd.sourceSubject))
    },
    {
      workload: execd.workload,
      event: withAttribution(
        execd.events[1]!,
        workloadAttribution(execd.sourceSubject))
    },
    {
      workload: execd.workload,
      event: withAttribution(
        execd.events[4]!,
        invocationAttribution(execd.sourceSubject))
    },
    {
      workload: execd.workload,
      event: withAttribution(
        execd.events[9]!,
        workloadAttribution(execd.sourceSubject))
    }
  ];
  for (const [index, value] of denied.entries()) {
    await assert.rejects(
      recordAuditBatch(
        context,
        value.workload,
        [value.event]),
      matchGrpcStatus(status.PERMISSION_DENIED),
      `attribution case ${String(index)}`);
  }
});

test("accepts source-attested upstream workload attribution", async () => {
  const context = getAuditdTestContext();
  const batches = new Map(
    createAdmittedAuditBatches(context)
      .map((batch) => [batch.name, batch] as const));
  const identityd = batches.get("identityd")!;
  const tenantd = batches.get("tenantd")!;
  const subjectPrefix = identityd.sourceSubject.slice(
    0,
    identityd.sourceSubject.lastIndexOf(":") + 1);
  const authdSubject = `${subjectPrefix}authd`;
  const productSubject = `${subjectPrefix}product-backend`;

  const identityResult = await recordAuditBatch(
    context,
    identityd.workload,
    [withAttribution(
      identityd.events[0]!,
      workloadAttribution(authdSubject))]);
  const tenantResult = await recordAuditBatch(
    context,
    tenantd.workload,
    [withAttribution(
      tenantd.events[1]!,
      invocationAttribution(productSubject))]);
  assert.equal(identityResult.acceptances.length, 1);
  assert.equal(tenantResult.acceptances.length, 1);
});

test("detail and target partitions must be coherent", async () => {
  const context = getAuditdTestContext();
  const batches = new Map(
    createAdmittedAuditBatches(context)
      .map((batch) => [batch.name, batch] as const));
  const tenantd = batches.get("tenantd")!;
  const identityd = batches.get("identityd")!;
  const pkgd = batches.get("pkgd")!;
  const configd = batches.get("configd")!;
  const execd = batches.get("execd")!;

  const denied = [
    [tenantd.workload, withPartition(
      tenantd.events[0]!,
      globalPartition())],
    [tenantd.workload, withPartition(
      tenantd.events[3]!,
      globalPartition())],
    [identityd.workload, withPartition(
      identityd.events[0]!,
      globalPartition())],
    [identityd.workload, withPartition(
      identityd.events[2]!,
      globalPartition())],
    [pkgd.workload, withPartition(
      pkgd.events[0]!,
      tenantPartition("wrong"))],
    [pkgd.workload, withPartition(
      pkgd.events[1]!,
      tenantPartition("wrong"))],
    [pkgd.workload, withPartition(
      pkgd.events[2]!,
      tenantPartition("other"))],
    [configd.workload, withPartition(
      configd.events[0]!,
      tenantPartition("wrong"))],
    [configd.workload, withPartition(
      configd.events[1]!,
      tenantPartition("other"))],
    [configd.workload, withPartition(
      configd.events[8]!,
      tenantPartition("wrong"))],
    [configd.workload, withPartition(
      configd.events[9]!,
      tenantPartition("other"))],
    [execd.workload, withPartition(
      execd.events[0]!,
      tenantPartition("wrong"))],
    [execd.workload, withPartition(
      execd.events[1]!,
      tenantPartition("other"))],
    [execd.workload, withPartition(
      execd.events[4]!,
      tenantPartition("wrong"))],
    [execd.workload, withPartition(
      execd.events[9]!,
      tenantPartition("other"))]
  ] as const;

  for (const [index, [workload, event]] of denied.entries()) {
    await assert.rejects(
      recordAuditBatch(context, workload, [event]),
      matchGrpcStatus(status.PERMISSION_DENIED),
      `partition case ${String(index)}`);
  }
});

function withAttribution(
  event: AuditEvent,
  attribution: NonNullable<AuditEvent["attribution"]>
): AuditEvent {
  return AuditEvent.create({ ...event, attribution });
}

function withPartition(
  event: AuditEvent,
  partition: NonNullable<AuditEvent["partition"]>
): AuditEvent {
  return AuditEvent.create({ ...event, partition });
}

function detailName(event: AuditEvent): string {
  for (const name of [
    "tenantMutation",
    "workspaceMutation",
    "identitySession",
    "identityMembership",
    "identityGroup",
    "identityGroupMember",
    "identityVirtualPrincipal",
    "identityExternalLink",
    "identityLoginProvider",
    "identityWorkspaceProviderAdmission",
    "packageDeclaration",
    "appMutation",
    "configurationPublication",
    "secretPublication",
    "projectionMutation",
    "placementMutation",
    "workloadMutation",
    "runMutation"
  ] as const) {
    if (event[name] !== undefined) {
      return name;
    }
  }
  return "missing";
}
