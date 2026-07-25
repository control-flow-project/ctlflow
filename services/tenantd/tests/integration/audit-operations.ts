import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import {
  LifecycleStepKey,
  LifecycleStepOutcome,
  type LifecycleStep,
  type LifecycleTarget
} from "../generated/v1/tenantd.js";
import {
  acknowledgeLifecycleStep
} from "../support/acknowledge-lifecycle-step.js";
import {
  completeLifecycleOperation
} from "../support/complete-lifecycle-operation.js";
import {
  createTenantdTestContext,
  type TenantdTestContext
} from "../support/create-tenantd-test-context.js";
import {
  createTestTenant
} from "../support/create-test-tenant.js";
import {
  createTestWorkspace
} from "../support/create-test-workspace.js";
import { getTestTenant } from "../support/get-test-tenant.js";
import {
  getTestWorkspace
} from "../support/get-test-workspace.js";
import {
  listLifecycleSteps
} from "../support/list-lifecycle-steps.js";
import {
  putLifecycleAction
} from "../support/put-lifecycle-action.js";
import {
  requestTenancyApi,
  type TenancyApiResponse
} from "../support/request-tenancy-api.js";
import {
  requireTenantDocument
} from "../support/require-tenant-document.js";
import {
  requireWorkspaceDocument
} from "../support/require-workspace-document.js";
import type { TenantDocument } from "../support/tenant-document.js";
import {
  waitForAuditEvents
} from "../support/wait-for-audit-events.js";
import {
  waitForAuditOutboxCount
} from "../support/wait-for-audit-outbox-count.js";
import { workloadMetadata } from "../support/workload-metadata.js";
import type {
  WorkspaceDocument
} from "../support/workspace-document.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
const expectedOperations = [
  "acknowledge_lifecycle_step",
  "create_tenant",
  "create_workspace",
  "delete_tenant",
  "delete_workspace",
  "resume_tenant",
  "resume_workspace",
  "retry_tenant",
  "retry_workspace",
  "suspend_tenant",
  "suspend_workspace",
  "update_tenant",
  "update_workspace"
] as const;

test("delivers every Tenant and Workspace audit operation", async () => {
  const context = await createTenantdTestContext({
    registerAggregatedApi: true,
    seedResolutionData: false
  });
  try {
    const baseline = (await context.auditd.readEvents()).length;
    let tenant = await createTestTenant(
      context,
      "Audit Operation Tenant",
      "audit-operations.example.com",
      "audit-operations-create-tenant");
    await completeTenantOperation(context, tenant);
    tenant = await getTestTenant(context, tenant.metadata.name);
    tenant = await updateTenant(context, tenant);

    tenant = requireTenantDocument(await acceptedLifecycleAction(
      context,
      "tenants",
      tenant.metadata.name,
      "suspend",
      tenant.metadata.resourceVersion,
      "audit-operations-suspend-tenant"));
    await blockOperation(context, targetForTenant(tenant), operationId(tenant));
    tenant = await getTestTenant(context, tenant.metadata.name);
    tenant = requireTenantDocument(await acceptedLifecycleAction(
      context,
      "tenants",
      tenant.metadata.name,
      "retry",
      tenant.metadata.resourceVersion,
      "audit-operations-retry-tenant"));
    await completeTenantOperation(context, tenant);
    tenant = await getTestTenant(context, tenant.metadata.name);
    tenant = requireTenantDocument(await acceptedLifecycleAction(
      context,
      "tenants",
      tenant.metadata.name,
      "resume",
      tenant.metadata.resourceVersion,
      "audit-operations-resume-tenant"));
    await completeTenantOperation(context, tenant);
    tenant = await getTestTenant(context, tenant.metadata.name);

    let workspace = await createTestWorkspace(
      context,
      tenant.metadata.name,
      "Audit Operation Workspace",
      "audit-operations",
      "audit-operations-create-workspace");
    await completeWorkspaceOperation(context, workspace);
    workspace = await getTestWorkspace(
      context,
      workspace.metadata.name);
    workspace = await updateWorkspace(context, workspace);

    workspace = requireWorkspaceDocument(await acceptedLifecycleAction(
      context,
      "workspaces",
      workspace.metadata.name,
      "suspend",
      workspace.metadata.resourceVersion,
      "audit-operations-suspend-workspace"));
    await blockOperation(
      context,
      targetForWorkspace(workspace),
      operationId(workspace));
    workspace = await getTestWorkspace(
      context,
      workspace.metadata.name);
    workspace = requireWorkspaceDocument(await acceptedLifecycleAction(
      context,
      "workspaces",
      workspace.metadata.name,
      "retry",
      workspace.metadata.resourceVersion,
      "audit-operations-retry-workspace"));
    await completeWorkspaceOperation(context, workspace);
    workspace = await getTestWorkspace(
      context,
      workspace.metadata.name);
    workspace = requireWorkspaceDocument(await acceptedLifecycleAction(
      context,
      "workspaces",
      workspace.metadata.name,
      "resume",
      workspace.metadata.resourceVersion,
      "audit-operations-resume-workspace"));
    await completeWorkspaceOperation(context, workspace);
    workspace = await getTestWorkspace(
      context,
      workspace.metadata.name);
    workspace = requireWorkspaceDocument(await acceptedLifecycleAction(
      context,
      "workspaces",
      workspace.metadata.name,
      "delete",
      workspace.metadata.resourceVersion,
      "audit-operations-delete-workspace"));
    await completeWorkspaceOperation(context, workspace);

    tenant = await getTestTenant(context, tenant.metadata.name);
    tenant = requireTenantDocument(await acceptedLifecycleAction(
      context,
      "tenants",
      tenant.metadata.name,
      "delete",
      tenant.metadata.resourceVersion,
      "audit-operations-delete-tenant"));
    await completeTenantOperation(context, tenant);

    await waitForAuditOutboxCount(context.database, 0);
    const events = await waitForAuditEvents(
      context.auditd,
      baseline + expectedOperations.length);
    assert.deepEqual(
      [...new Set(events.slice(baseline).map((event) => event.operation))]
        .sort(),
      [...expectedOperations].sort());
  } finally {
    await context.stop();
  }
});

test("delivers queued audit intents in source-sequence order", async () => {
  const context = await createTenantdTestContext({
    registerAggregatedApi: true,
    seedResolutionData: false
  });
  try {
    await context.auditd.setMode("unavailable");
    for (const [index, name] of [
      "One",
      "Two",
      "Three"
    ].entries()) {
      await createTestTenant(
        context,
        `Audit Queue ${name}`,
        `audit-queue-${String(index + 1)}.example.com`,
        `audit-queue-${String(index + 1)}`);
    }
    await waitForAuditOutboxCount(context.database, 3);
    await delay(150);

    await context.auditd.setMode("normal");
    const events = await waitForAuditEvents(context.auditd, 3);
    await waitForAuditOutboxCount(context.database, 0);
    assert.deepEqual(
      events.map((event) => BigInt(event.sourceSequence)),
      [...events]
        .map((event) => BigInt(event.sourceSequence))
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0));
    assert.deepEqual(
      events.map((event) => BigInt(event.partitionCursor)),
      [1n, 2n, 3n]);
  } finally {
    await context.stop();
  }
});

async function updateTenant(
  context: TenantdTestContext,
  tenant: TenantDocument
): Promise<TenantDocument> {
  const response = await requestTenancyApi(context.kubernetesApi, {
    method: "PUT",
    path: `${basePath}/tenants/${tenant.metadata.name}`,
    headers: { "Idempotency-Key": "audit-operations-update-tenant" },
    body: {
      ...tenant,
      spec: {
        ...tenant.spec,
        displayName: "Updated Audit Operation Tenant"
      },
      status: undefined
    }
  });
  assert.equal(response.statusCode, 200, response.text);
  return requireTenantDocument(response);
}

async function updateWorkspace(
  context: TenantdTestContext,
  workspace: WorkspaceDocument
): Promise<WorkspaceDocument> {
  const response = await requestTenancyApi(context.kubernetesApi, {
    method: "PUT",
    path: `${basePath}/workspaces/${workspace.metadata.name}`,
    headers: { "Idempotency-Key": "audit-operations-update-workspace" },
    body: {
      ...workspace,
      spec: {
        ...workspace.spec,
        displayName: "Updated Audit Operation Workspace"
      },
      status: undefined
    }
  });
  assert.equal(response.statusCode, 200, response.text);
  return requireWorkspaceDocument(response);
}

async function acceptedLifecycleAction(
  context: TenantdTestContext,
  kind: "tenants" | "workspaces",
  id: string,
  action: "delete" | "resume" | "retry" | "suspend",
  resourceVersion: string,
  idempotencyKey: string
): Promise<TenancyApiResponse> {
  const response = await putLifecycleAction(
    context,
    kind,
    id,
    action,
    resourceVersion,
    idempotencyKey);
  assert.equal(response.statusCode, 202, response.text);
  return response;
}

async function completeTenantOperation(
  context: TenantdTestContext,
  tenant: TenantDocument
): Promise<void> {
  await completeLifecycleOperation(context, {
    target: targetForTenant(tenant),
    operationId: operationId(tenant),
    provisioningGeneration: tenant.status.provisioningGeneration
  });
}

async function completeWorkspaceOperation(
  context: TenantdTestContext,
  workspace: WorkspaceDocument
): Promise<void> {
  await completeLifecycleOperation(context, {
    target: targetForWorkspace(workspace),
    operationId: operationId(workspace),
    provisioningGeneration: workspace.status.provisioningGeneration
  });
}

async function blockOperation(
  context: TenantdTestContext,
  target: LifecycleTarget,
  currentOperationId: string
): Promise<void> {
  const step = findStep(
    (await listLifecycleSteps(
      context.client,
      { pageSize: 100 },
      workloadMetadata(
        context.lifecycleOwners.identity.callerToken))).steps,
    currentOperationId);
  await acknowledgeLifecycleStep(
    context.client,
    {
      target,
      lifecycleOperationId: currentOperationId,
      provisioningGeneration: step.provisioningGeneration,
      stepKey: step.stepKey,
      expectedStepRevision: step.stepRevision,
      ownerRevision: 1n,
      outcome: LifecycleStepOutcome.LIFECYCLE_STEP_OUTCOME_BLOCKED,
      blockedReason: "controlled audit operation failure",
      idempotencyKey: `block-${currentOperationId}`
    },
    workloadMetadata(context.lifecycleOwners.identity.callerToken));
}

function findStep(
  steps: readonly LifecycleStep[],
  currentOperationId: string
): LifecycleStep {
  const step = steps.find((candidate) =>
    candidate.lifecycleOperationId === currentOperationId);
  assert.ok(step);
  assert.equal(
    step.stepKey,
    LifecycleStepKey.LIFECYCLE_STEP_KEY_IDENTITY);
  return step;
}

function targetForTenant(tenant: TenantDocument): LifecycleTarget {
  return { tenant: { tenantId: tenant.metadata.name } };
}

function targetForWorkspace(
  workspace: WorkspaceDocument
): LifecycleTarget {
  return {
    workspace: {
      tenantId: workspace.spec.tenantId,
      workspaceId: workspace.metadata.name
    }
  };
}

function operationId(
  resource: TenantDocument | WorkspaceDocument
): string {
  const id = resource.status.currentOperation?.id;
  assert.ok(id);
  return id;
}
