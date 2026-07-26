import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import {
  AuditOutcome,
  TenancyResourceState
} from "../generated/v1/auditd.js";
import {
  ResourceState,
  type ListTenantsResponse,
  type ResolveTenantResponse,
  type Tenant,
  type Workspace
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import { callUnary } from "../support/call-unary.js";
import { matchGrpcStatus } from "../support/match-grpc-status.js";
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
  createTenant
} from "../support/tenants/create-tenant.js";
import { workloadMetadata } from "../support/workload-metadata.js";
import {
  createWorkspace
} from "../support/workspaces/create-workspace.js";

test("records one complete audit event for each mutation operation", async () => {
  const context = getTenantdTestContext();
  const baseline = (await context.auditd.readEvents()).length;
  const tenant = await createTenant(context, {
    tenantId: "audit_tenant",
    address: "audit-tenant",
    displayName: "Audit Tenant"
  });
  const updatedTenant = await callUnary<Tenant>((done) =>
    context.client.updateTenant(
      {
        tenantId: tenant.tenantId,
        expectedRevision: tenant.revision,
        displayName: "Audit Tenant Updated"
      },
      done));
  const workspace = await createWorkspace(context, {
    workspaceId: "audit_workspace",
    tenantId: tenant.tenantId,
    address: "audit-workspace",
    displayName: "Audit Workspace"
  });
  const updatedWorkspace = await callUnary<Workspace>((done) =>
    context.client.updateWorkspace(
      {
        workspaceId: workspace.workspaceId,
        expectedRevision: workspace.revision,
        displayName: "Audit Workspace Updated"
      },
      done));
  await callUnary<Workspace>((done) =>
    context.client.setWorkspaceState(
      {
        workspaceId: workspace.workspaceId,
        expectedRevision: updatedWorkspace.revision,
        state: ResourceState.RESOURCE_STATE_SUSPENDED
      },
      done));
  await callUnary<Tenant>((done) =>
    context.client.setTenantState(
      {
        tenantId: tenant.tenantId,
        expectedRevision: updatedTenant.revision,
        state: ResourceState.RESOURCE_STATE_SUSPENDED
      },
      done));

  const events = (await context.auditd.readEvents()).slice(baseline);
  assert.deepEqual(
    events.map((event) => event.operation),
    [
      "create_tenant",
      "update_tenant",
      "create_workspace",
      "update_workspace",
      "set_workspace_state",
      "set_tenant_state"
    ]);
  assert.deepEqual(
    events.map((event) => event.resourceRevision),
    [1n, 2n, 1n, 2n, 3n, 3n]);
  assert.deepEqual(
    events.map((event) => event.resultingState),
    [
      TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE,
      TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE,
      TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE,
      TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE,
      TenancyResourceState.TENANCY_RESOURCE_STATE_SUSPENDED,
      TenancyResourceState.TENANCY_RESOURCE_STATE_SUSPENDED
    ]);
  assert.deepEqual(
    events.map((event) => event.targetKind),
    ["tenant", "tenant", "workspace", "workspace", "workspace", "tenant"]);

  for (const event of events) {
    assert.equal(event.idempotencyKey, event.sourceEventId);
    assert.match(event.sourceEventId, /^evt_[0-9a-f]{32}$/u);
    assert.equal(event.kubernetesSubject, context.operatorSubject);
    assert.equal(event.actorPrincipalId, undefined);
    assert.equal(event.attachedAccountPrincipalId, undefined);
    assert.equal(event.tenantId, tenant.tenantId);
    assert.equal(event.outcome, AuditOutcome.AUDIT_OUTCOME_SUCCEEDED);
    assert.match(event.traceId, /^[0-9a-f]{32}$/u);
    assert.match(event.spanId, /^[0-9a-f]{16}$/u);
    assert.ok(Number.isFinite(Date.parse(event.occurredAt)));
  }
  assert.deepEqual(
    events.map((event) => event.targetId),
    [
      tenant.tenantId,
      tenant.tenantId,
      workspace.workspaceId,
      workspace.workspaceId,
      workspace.workspaceId,
      tenant.tenantId
    ]);
});

test("does not audit reads, rejections, retries, or no-op mutations", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "audit_noop_tenant",
    address: "audit-noop-tenant",
    displayName: "Audit No-op Tenant"
  });
  const baseline = (await context.auditd.readEvents()).length;

  await createTenant(context, {
    tenantId: tenant.tenantId,
    address: tenant.address,
    displayName: tenant.displayName
  });
  await callUnary<Tenant>((done) =>
    context.client.getTenant(
      { tenantId: tenant.tenantId },
      done));
  await callUnary<ListTenantsResponse>((done) =>
    context.client.listTenants(
      { pageSize: 10 },
      done));
  await callUnary<ResolveTenantResponse>((done) =>
    context.workloadClient.resolveTenant(
      { address: tenant.address },
      workloadMetadata(context.workload.callerToken),
      done));
  await callUnary<Tenant>((done) =>
    context.client.updateTenant(
      {
        tenantId: tenant.tenantId,
        expectedRevision: tenant.revision,
        displayName: tenant.displayName
      },
      done));
  await callUnary<Tenant>((done) =>
    context.client.setTenantState(
      {
        tenantId: tenant.tenantId,
        expectedRevision: tenant.revision,
        state: ResourceState.RESOURCE_STATE_ACTIVE
      },
      done));
  await assert.rejects(
    createTenant(context, {
      tenantId: "Invalid",
      address: "invalid",
      displayName: "Invalid"
    }),
    matchGrpcStatus(status.INVALID_ARGUMENT));

  assert.equal((await context.auditd.readEvents()).length, baseline);
});

test("returns unavailable after a committed mutation when auditd fails", async () => {
  const context = getTenantdTestContext();
  const baseline = (await context.auditd.readEvents()).length;

  await context.auditd.setMode("unavailable");
  try {
    await assert.rejects(
      createTenant(context, {
        tenantId: "audit_unavailable_tenant",
        address: "audit-unavailable-tenant",
        displayName: "Audit Unavailable Tenant"
      }),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.auditd.setMode("available");
  }
  const committed = await getTenant("audit_unavailable_tenant");
  assert.equal(committed.revision, 1n);
  assert.equal((await context.auditd.readEvents()).length, baseline);

  await context.auditd.setMode("denied");
  try {
    await assert.rejects(
      updateTenant(
        committed.tenantId,
        committed.revision,
        "Committed Without Audit"),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.auditd.setMode("available");
  }
  const updated = await getTenant(committed.tenantId);
  assert.equal(updated.displayName, "Committed Without Audit");
  assert.equal(updated.revision, 2n);
  assert.equal((await context.auditd.readEvents()).length, baseline);

});

test("exports correlated and redacted traces, metrics, and logs", async () => {
  const context = getTenantdTestContext();
  const traceId = "1234567890abcdef1234567890abcdef";
  const metadata = new Metadata();
  metadata.set("traceparent", `00-${traceId}-1234567890abcdef-01`);
  const request = {
    tenantId: "telemetry_tenant",
    address: "telemetry-secret-address",
    displayName: "Telemetry Secret Display"
  };
  const created = await callUnary<Tenant>((done) =>
    context.client.createTenant(request, metadata, done));
  assert.equal(created.tenantId, request.tenantId);
  const invocationToken = context.invocation.sign({
    tenantId: request.tenantId,
    tokenId: "telemetry-redaction-token"
  });
  await callUnary<ResolveTenantResponse>((done) =>
    context.workloadClient.resolveTenant(
      { address: request.address },
      workloadMetadata(
        context.workload.callerToken,
        invocationToken),
      done));

  await waitForExport(
    context.collector.tracesPath,
    (value) => {
      const spans = findSpansForTrace(value, traceId);
      const server = spans.find(
        (span) => span.name === "tenantd.CreateTenant");
      const database = spans.find(
        (span) => span.name === "tenantd.db.create_tenant");
      const audit = spans.find(
        (span) => span.name === "tenantd.RecordAuditBatch");
      return typeof server?.spanId === "string"
        && database?.parentSpanId === server.spanId
        && audit?.parentSpanId === server.spanId;
    });
  await waitForExport(
    context.collector.metricsPath,
    (value) =>
      value.includes("ctlflow.tenantd.requests")
      && value.includes("ctlflow.tenantd.duration"));
  await waitForExport(
    context.collector.logsPath,
    (value) => hasOperationLog(value, {
      operation: "CreateTenant",
      outcome: "ok",
      traceId
    }));

  const exports = await readAllExports(context.collector);
  for (const secret of [
    request.address,
    request.displayName,
    context.workload.callerToken,
    invocationToken
  ]) {
    assert.equal(exports.includes(secret), false);
  }

  const malformedParent = workloadMetadata(context.workload.callerToken);
  malformedParent.set("traceparent", "not-a-traceparent");
  const resolved = await callUnary<ResolveTenantResponse>((done) =>
    context.workloadClient.resolveTenant(
      { address: request.address },
      malformedParent,
      done));
  assert.equal(resolved.tenantId, request.tenantId);
});

test("records cancellation when an in-flight database query is cancelled", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "cancel_tenant",
    address: "cancel-tenant",
    displayName: "Cancel Tenant"
  });
  const workspace = await createWorkspace(context, {
    workspaceId: "cancel_workspace",
    tenantId: tenant.tenantId,
    address: "cancel-workspace",
    displayName: "Cancel Workspace"
  });
  const traceId = "abcdef1234567890abcdef1234567890";
  const metadata = workloadMetadata(context.workload.callerToken);
  metadata.set("traceparent", `00-${traceId}-abcdef1234567890-01`);
  await context.database.connection.raw("BEGIN EXCLUSIVE");
  let cancelCall: (() => void) | undefined;
  const blockedCall = new Promise<never>((_resolve, reject) => {
    const call = context.workloadClient.resolveWorkspace(
      {
        tenantId: tenant.tenantId,
        address: workspace.address
      },
      metadata,
      (error) => {
        reject(error ?? new Error("Cancelled RPC returned no error"));
      });
    call.on("error", () => undefined);
    cancelCall = () => call.cancel();
  });
  try {
    // The later RPC proves the blocked request was sent before cancellation.
    await assert.rejects(
      callUnary<Tenant>((done) =>
        context.client.getTenant(
          { tenantId: "" },
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
      operation: "ResolveWorkspace",
      outcome: "cancelled",
      traceId
    }));
});

test("telemetry outage is bounded and does not change domain results", async () => {
  const context = getTenantdTestContext();
  await context.collector.suspend();
  try {
    const started = performance.now();
    const result = await callUnary<ResolveTenantResponse>((done) =>
      context.workloadClient.resolveTenant(
        { address: "telemetry-secret-address" },
        workloadMetadata(context.workload.callerToken),
        { deadline: Date.now() + 2_000 },
        done));
    assert.equal(result.tenantId, "telemetry_tenant");
    assert.ok(performance.now() - started < 1_800);
  } finally {
    await context.collector.resume();
  }
});

async function getTenant(tenantId: string): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.client.getTenant(
      { tenantId },
      done));
}

async function updateTenant(
  tenantId: string,
  expectedRevision: bigint,
  displayName: string
): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.client.updateTenant(
      { tenantId, expectedRevision, displayName },
      done));
}
