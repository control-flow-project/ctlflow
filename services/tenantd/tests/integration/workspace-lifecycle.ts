import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { LifecycleState } from "../generated/v1/tenantd.js";
import {
  assertKubernetesStatus
} from "../support/assert-kubernetes-status.js";
import {
  completeLifecycleOperation,
  type LifecycleOperationReference
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
import {
  createWorkspaceBody
} from "../support/create-workspace-body.js";
import { getLifecycle } from "../support/get-lifecycle.js";
import {
  getTestTenant
} from "../support/get-test-tenant.js";
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
  requestTenancyApi
} from "../support/request-tenancy-api.js";
import {
  requireWorkspaceDocument
} from "../support/require-workspace-document.js";
import type { TenantDocument } from "../support/tenant-document.js";
import { workloadMetadata } from "../support/workload-metadata.js";
import type {
  WorkspaceDocument
} from "../support/workspace-document.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
let context: TenantdTestContext | undefined;

describe("Workspace lifecycle", { concurrency: false }, () => {
  before(async () => {
    context = await createTenantdTestContext({
      registerAggregatedApi: true,
      seedResolutionData: false
    });
  });

  after(async () => {
    await context?.stop();
    context = undefined;
  });

  test("completes provisioning, suspension, and resumption", async () => {
    const tenant = await createActiveTenant(
      "Workspace Lifecycle Tenant",
      "workspace-lifecycle.example.com",
      "create-workspace-lifecycle-tenant");
    const created = await createTestWorkspace(
      requireContext(),
      tenant.metadata.name,
      "Workspace Lifecycle",
      "lifecycle",
      "create-workspace-lifecycle");
    await completeWorkspaceOperation(created);
    const active = await getTestWorkspace(
      requireContext(),
      created.metadata.name);
    assert.equal(active.status.lifecycle, "active");
    assert.equal(active.status.currentOperation, null);

    const suspendResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "suspend",
      active.metadata.resourceVersion,
      "suspend-workspace-lifecycle");
    assert.equal(suspendResponse.statusCode, 202, suspendResponse.text);
    const suspending = requireWorkspaceDocument(suspendResponse);
    assert.equal(suspending.status.lifecycle, "suspending");
    assert.equal(suspending.status.currentOperation?.kind, "suspend");
    await completeWorkspaceOperation(suspending);

    const suspended = await getTestWorkspace(
      requireContext(),
      active.metadata.name);
    assert.equal(suspended.status.lifecycle, "suspended");
    assert.equal(suspended.status.currentOperation, null);

    const resumeResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      suspended.metadata.name,
      "resume",
      suspended.metadata.resourceVersion,
      "resume-workspace-lifecycle");
    assert.equal(resumeResponse.statusCode, 202, resumeResponse.text);
    const resuming = requireWorkspaceDocument(resumeResponse);
    assert.equal(resuming.status.lifecycle, "resuming");
    await completeWorkspaceOperation(resuming);

    const resumed = await getTestWorkspace(
      requireContext(),
      active.metadata.name);
    assert.equal(resumed.status.lifecycle, "active");
    assert.equal(resumed.status.currentOperation, null);
    assert.equal(
      resumed.status.provisioningGeneration,
      active.status.provisioningGeneration + 2);
  });

  test("enforces lifecycle state, revision, and idempotency", async () => {
    const tenant = await createActiveTenant(
      "Workspace Guard Tenant",
      "workspace-guard.example.com",
      "create-workspace-guard-tenant");
    const active = await createActiveWorkspace(
      tenant.metadata.name,
      "Workspace Guards",
      "guards",
      "create-workspace-guards");

    const invalidResume = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "resume",
      active.metadata.resourceVersion,
      "resume-active-workspace");
    assertKubernetesStatus(invalidResume, 422, "Invalid");

    const staleSuspend = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "suspend",
      "999999",
      "stale-suspend-workspace");
    assertKubernetesStatus(staleSuspend, 409, "Conflict");

    const firstResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "suspend",
      active.metadata.resourceVersion,
      "idempotent-suspend-workspace");
    assert.equal(firstResponse.statusCode, 202, firstResponse.text);
    const first = requireWorkspaceDocument(firstResponse);
    await completeWorkspaceOperation(first);

    const replayResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "suspend",
      active.metadata.resourceVersion,
      "idempotent-suspend-workspace");
    assert.equal(replayResponse.statusCode, 202, replayResponse.text);
    assert.deepEqual(requireWorkspaceDocument(replayResponse), first);

    const conflict = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "suspend",
      first.metadata.resourceVersion,
      "idempotent-suspend-workspace");
    assertKubernetesStatus(conflict, 409, "AlreadyExists");
  });

  test("a non-active parent fences Workspace mutations and owner work", async () => {
    const tenant = await createActiveTenant(
      "Workspace Parent Fence",
      "workspace-parent-fence.example.com",
      "create-workspace-parent-fence");
    const workspace = await createActiveWorkspace(
      tenant.metadata.name,
      "Workspace Parent Fenced",
      "fenced",
      "create-workspace-parent-fenced");

    const childSuspendResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      workspace.metadata.name,
      "suspend",
      workspace.metadata.resourceVersion,
      "suspend-workspace-before-parent");
    assert.equal(
      childSuspendResponse.statusCode,
      202,
      childSuspendResponse.text);
    const childSuspending = requireWorkspaceDocument(childSuspendResponse);

    const tenantSuspendResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      tenant.metadata.name,
      "suspend",
      tenant.metadata.resourceVersion,
      "suspend-parent-tenant");
    assert.equal(
      tenantSuspendResponse.statusCode,
      202,
      tenantSuspendResponse.text);
    const tenantSuspending = tenantSuspendResponse.body as TenantDocument;
    await completeTenantOperation(tenantSuspending);

    const suspendedTenant = await getTestTenant(
      requireContext(),
      tenant.metadata.name);
    assert.equal(suspendedTenant.status.lifecycle, "suspended");

    const create = await requestTenancyApi(
      requireContext().kubernetesApi,
      {
        method: "POST",
        path: `${basePath}/workspaces`,
        headers: {
          "Idempotency-Key": "create-under-suspended-parent"
        },
        body: createWorkspaceBody(
          tenant.metadata.name,
          "Blocked Child",
          "blocked")
      });
    assertKubernetesStatus(create, 422, "Invalid");

    const currentWorkspace = await getTestWorkspace(
      requireContext(),
      workspace.metadata.name);
    const update = await requestTenancyApi(
      requireContext().kubernetesApi,
      {
        method: "PUT",
        path: `${basePath}/workspaces/${workspace.metadata.name}`,
        headers: {
          "Idempotency-Key": "update-under-suspended-parent"
        },
        body: {
          ...currentWorkspace,
          spec: {
            ...currentWorkspace.spec,
            displayName: "Blocked Update"
          },
          status: undefined
        }
      });
    assertKubernetesStatus(update, 422, "Invalid");

    for (const token of ownerTokens()) {
      const work = await listLifecycleSteps(
        requireContext().client,
        { pageSize: 100 },
        workloadMetadata(token));
      assert.equal(
        work.steps.some((step) =>
          step.lifecycleOperationId
          === childSuspending.status.currentOperation?.id),
        false);
    }

    const resumeResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      suspendedTenant.metadata.name,
      "resume",
      suspendedTenant.metadata.resourceVersion,
      "resume-parent-tenant");
    assert.equal(resumeResponse.statusCode, 202, resumeResponse.text);
    await completeTenantOperation(resumeResponse.body as TenantDocument);

    for (const token of ownerTokens()) {
      const work = await listLifecycleSteps(
        requireContext().client,
        { pageSize: 100 },
        workloadMetadata(token));
      assert.equal(
        work.steps.some((step) =>
          step.lifecycleOperationId
          === childSuspending.status.currentOperation?.id),
        true);
    }
    await completeWorkspaceOperation(childSuspending);
  });

  test("deletion retains the Workspace tombstone and address", async () => {
    const tenant = await createActiveTenant(
      "Workspace Delete Tenant",
      "workspace-delete.example.com",
      "create-workspace-delete-tenant");
    const active = await createActiveWorkspace(
      tenant.metadata.name,
      "Workspace Deleted",
      "deleted",
      "create-workspace-deleted");

    const deleteResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      active.metadata.name,
      "delete",
      active.metadata.resourceVersion,
      "delete-workspace-terminal");
    assert.equal(deleteResponse.statusCode, 202, deleteResponse.text);
    const deleting = requireWorkspaceDocument(deleteResponse);
    assert.equal(deleting.status.lifecycle, "deleting");
    await completeWorkspaceOperation(deleting);

    const deleted = await getTestWorkspace(
      requireContext(),
      active.metadata.name);
    assert.equal(deleted.status.lifecycle, "deleted");
    assert.equal(deleted.status.currentOperation, null);

    const lifecycle = await getLifecycle(
      requireContext().client,
      {
        target: {
          workspace: {
            tenantId: tenant.metadata.name,
            workspaceId: active.metadata.name
          }
        }
      },
      workloadMetadata(requireContext().kubernetes.callerToken));
    assert.equal(
      lifecycle.lifecycle,
      LifecycleState.LIFECYCLE_STATE_DELETED);

    const reuse = await requestTenancyApi(
      requireContext().kubernetesApi,
      {
        method: "POST",
        path: `${basePath}/workspaces`,
        headers: {
          "Idempotency-Key": "reuse-deleted-workspace-address"
        },
        body: createWorkspaceBody(
          tenant.metadata.name,
          "Address Reuse",
          active.spec.workspaceAddress)
      });
    assertKubernetesStatus(reuse, 409, "AlreadyExists");

    const selector = encodeURIComponent(
      `spec.tenantId=${tenant.metadata.name}`);
    const list = await requestTenancyApi(
      requireContext().kubernetesApi,
      {
        method: "GET",
        path: `${basePath}/workspaces?fieldSelector=${selector}&limit=100`
      });
    assert.equal(list.statusCode, 200, list.text);
    const items = (list.body as {
      readonly items: readonly WorkspaceDocument[];
    }).items;
    assert.equal(
      items.find((item) => item.metadata.name === active.metadata.name)
        ?.status.lifecycle,
      "deleted");

    const forbidden = await putLifecycleAction(
      requireContext(),
      "workspaces",
      deleted.metadata.name,
      "resume",
      deleted.metadata.resourceVersion,
      "resume-deleted-workspace");
    assertKubernetesStatus(forbidden, 422, "Invalid");
  });
});

async function createActiveTenant(
  displayName: string,
  authority: string,
  idempotencyKey: string
): Promise<TenantDocument> {
  const created = await createTestTenant(
    requireContext(),
    displayName,
    authority,
    idempotencyKey);
  await completeTenantOperation(created);
  return getTestTenant(requireContext(), created.metadata.name);
}

async function createActiveWorkspace(
  tenantId: string,
  displayName: string,
  address: string,
  idempotencyKey: string
): Promise<WorkspaceDocument> {
  const created = await createTestWorkspace(
    requireContext(),
    tenantId,
    displayName,
    address,
    idempotencyKey);
  await completeWorkspaceOperation(created);
  return getTestWorkspace(requireContext(), created.metadata.name);
}

async function completeTenantOperation(
  tenant: TenantDocument
): Promise<void> {
  await completeLifecycleOperation(requireContext(), tenantOperation(tenant));
}

async function completeWorkspaceOperation(
  workspace: WorkspaceDocument
): Promise<void> {
  await completeLifecycleOperation(
    requireContext(),
    workspaceOperation(workspace));
}

function tenantOperation(
  tenant: TenantDocument
): LifecycleOperationReference {
  const operationId = tenant.status.currentOperation?.id;
  assert.ok(operationId);
  return {
    target: { tenant: { tenantId: tenant.metadata.name } },
    operationId,
    provisioningGeneration: tenant.status.provisioningGeneration
  };
}

function workspaceOperation(
  workspace: WorkspaceDocument
): LifecycleOperationReference {
  const operationId = workspace.status.currentOperation?.id;
  assert.ok(operationId);
  return {
    target: {
      workspace: {
        tenantId: workspace.spec.tenantId,
        workspaceId: workspace.metadata.name
      }
    },
    operationId,
    provisioningGeneration: workspace.status.provisioningGeneration
  };
}

function ownerTokens(): readonly string[] {
  const owners = requireContext().lifecycleOwners;
  return [
    owners.identity.callerToken,
    owners.configuration.callerToken,
    owners.execution.callerToken,
    owners.packages.callerToken
  ];
}

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}
