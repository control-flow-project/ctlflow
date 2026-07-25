import assert from "node:assert/strict";
import { Metadata, status, type ServiceError } from "@grpc/grpc-js";
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
  createTenantBody
} from "../support/create-tenant-body.js";
import {
  createTestTenant
} from "../support/create-test-tenant.js";
import {
  createTestWorkspace
} from "../support/create-test-workspace.js";
import {
  getTestTenant
} from "../support/get-test-tenant.js";
import {
  getTestWorkspace
} from "../support/get-test-workspace.js";
import {
  putLifecycleAction
} from "../support/put-lifecycle-action.js";
import {
  requestTenancyApi
} from "../support/request-tenancy-api.js";
import {
  requireTenantDocument
} from "../support/require-tenant-document.js";
import { resolveTenant } from "../support/resolve-tenant.js";
import type { TenantDocument } from "../support/tenant-document.js";
import { workloadMetadata } from "../support/workload-metadata.js";
import type {
  WorkspaceDocument
} from "../support/workspace-document.js";

const basePath = "/apis/tenancy.ctlflow.com/v1alpha1";
let context: TenantdTestContext | undefined;

describe("Tenant lifecycle", { concurrency: false }, () => {
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
    const created = await createTenant(
      "Tenant Lifecycle",
      "tenant-lifecycle.example.com",
      "create-tenant-lifecycle");
    await completeTenantOperation(created);
    const active = await getTestTenant(
      requireContext(),
      created.metadata.name);
    assert.equal(active.status.lifecycle, "active");
    assert.equal(active.status.currentOperation, null);

    const suspendResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "suspend",
      active.metadata.resourceVersion,
      "suspend-tenant-lifecycle");
    assert.equal(suspendResponse.statusCode, 202, suspendResponse.text);
    const suspending = requireTenantDocument(suspendResponse);
    assert.equal(suspending.status.lifecycle, "suspending");
    assert.equal(suspending.status.currentOperation?.kind, "suspend");
    assert.equal(
      suspending.status.provisioningGeneration,
      active.status.provisioningGeneration + 1);
    await completeTenantOperation(suspending);

    const suspended = await getTestTenant(
      requireContext(),
      active.metadata.name);
    assert.equal(suspended.status.lifecycle, "suspended");
    assert.equal(suspended.status.currentOperation, null);

    const resumeResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      suspended.metadata.name,
      "resume",
      suspended.metadata.resourceVersion,
      "resume-tenant-lifecycle");
    assert.equal(resumeResponse.statusCode, 202, resumeResponse.text);
    const resuming = requireTenantDocument(resumeResponse);
    assert.equal(resuming.status.lifecycle, "resuming");
    assert.equal(resuming.status.currentOperation?.kind, "resume");
    await completeTenantOperation(resuming);

    const resumed = await getTestTenant(
      requireContext(),
      active.metadata.name);
    assert.equal(resumed.status.lifecycle, "active");
    assert.equal(resumed.status.currentOperation, null);
    assert.equal(
      resumed.status.provisioningGeneration,
      active.status.provisioningGeneration + 2);
  });

  test("enforces lifecycle state, revision, and idempotency", async () => {
    const active = await createActiveTenant(
      "Tenant Guards",
      "tenant-guards.example.com",
      "create-tenant-guards");

    const invalidResume = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "resume",
      active.metadata.resourceVersion,
      "resume-active-tenant");
    assertKubernetesStatus(invalidResume, 422, "Invalid");

    const staleSuspend = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "suspend",
      "999999",
      "stale-suspend-tenant");
    assertKubernetesStatus(staleSuspend, 409, "Conflict");

    const firstResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "suspend",
      active.metadata.resourceVersion,
      "idempotent-suspend-tenant");
    assert.equal(firstResponse.statusCode, 202, firstResponse.text);
    const first = requireTenantDocument(firstResponse);
    await completeTenantOperation(first);

    const replayResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "suspend",
      active.metadata.resourceVersion,
      "idempotent-suspend-tenant");
    assert.equal(replayResponse.statusCode, 202, replayResponse.text);
    assert.deepEqual(requireTenantDocument(replayResponse), first);

    const conflictingReplay = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "suspend",
      first.metadata.resourceVersion,
      "idempotent-suspend-tenant");
    assertKubernetesStatus(conflictingReplay, 409, "AlreadyExists");
  });

  test("blocks Tenant deletion until every Workspace is deleted", async () => {
    const tenant = await createActiveTenant(
      "Tenant Children",
      "tenant-children.example.com",
      "create-tenant-children");
    const workspace = await createTestWorkspace(
      requireContext(),
      tenant.metadata.name,
      "Tenant Child Workspace",
      "child",
      "create-tenant-child-workspace");
    await completeWorkspaceOperation(workspace);

    const blocked = await putLifecycleAction(
      requireContext(),
      "tenants",
      tenant.metadata.name,
      "delete",
      (await getTestTenant(
        requireContext(),
        tenant.metadata.name)).metadata.resourceVersion,
      "delete-tenant-with-child");
    assertKubernetesStatus(blocked, 422, "Invalid");

    const deletingWorkspaceResponse = await putLifecycleAction(
      requireContext(),
      "workspaces",
      workspace.metadata.name,
      "delete",
      (await getTestWorkspace(
        requireContext(),
        workspace.metadata.name)).metadata.resourceVersion,
      "delete-tenant-child-workspace");
    assert.equal(
      deletingWorkspaceResponse.statusCode,
      202,
      deletingWorkspaceResponse.text);
    await completeWorkspaceOperation(
      deletingWorkspaceResponse.body as WorkspaceDocument);

    const currentTenant = await getTestTenant(
      requireContext(),
      tenant.metadata.name);
    const deleteResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      tenant.metadata.name,
      "delete",
      currentTenant.metadata.resourceVersion,
      "delete-childless-tenant");
    assert.equal(deleteResponse.statusCode, 202, deleteResponse.text);
  });

  test("deletion is irreversible and retains the tombstone and address", async () => {
    const authority = "tenant-deleted.example.com";
    const active = await createActiveTenant(
      "Tenant Deleted",
      authority,
      "create-tenant-deleted");
    const deleteResponse = await putLifecycleAction(
      requireContext(),
      "tenants",
      active.metadata.name,
      "delete",
      active.metadata.resourceVersion,
      "delete-tenant-terminal");
    assert.equal(deleteResponse.statusCode, 202, deleteResponse.text);
    const deleting = requireTenantDocument(deleteResponse);
    assert.equal(deleting.status.lifecycle, "deleting");

    const updateWhileDeleting = await requestTenancyApi(
      requireContext().kubernetesApi,
      {
        method: "PUT",
        path: `${basePath}/tenants/${active.metadata.name}`,
        headers: { "Idempotency-Key": "update-deleting-tenant" },
        body: {
          ...deleting,
          spec: {
            ...deleting.spec,
            displayName: "Cannot Update"
          },
          status: undefined
        }
      });
    assertKubernetesStatus(updateWhileDeleting, 422, "Invalid");

    await assert.rejects(
      resolveTenant(
        requireContext().client,
        {
          externalAddress: {
            authority,
            pathPrefix: "/"
          }
        },
        kernelMetadata()),
      hasStatus(status.NOT_FOUND));

    await completeTenantOperation(deleting);
    const deleted = await getTestTenant(
      requireContext(),
      active.metadata.name);
    assert.equal(deleted.status.lifecycle, "deleted");
    assert.equal(deleted.status.currentOperation, null);

    const direct = await resolveTenant(
      requireContext().client,
      { tenantId: active.metadata.name },
      kernelMetadata());
    assert.equal(direct.lifecycle, LifecycleState.LIFECYCLE_STATE_DELETED);

    const reuse = await requestTenancyApi(
      requireContext().kubernetesApi,
      {
        method: "POST",
        path: `${basePath}/tenants`,
        headers: { "Idempotency-Key": "reuse-deleted-tenant-address" },
        body: createTenantBody("Address Reuse", authority)
      });
    assertKubernetesStatus(reuse, 409, "AlreadyExists");

    const listResponse = await requestTenancyApi(
      requireContext().kubernetesApi,
      {
        method: "GET",
        path: `${basePath}/tenants?limit=100`
      });
    assert.equal(listResponse.statusCode, 200, listResponse.text);
    const items = (listResponse.body as {
      readonly items: readonly TenantDocument[];
    }).items;
    assert.equal(
      items.find((item) => item.metadata.name === active.metadata.name)
        ?.status.lifecycle,
      "deleted");

    for (const action of ["resume", "suspend"] as const) {
      const forbidden = await putLifecycleAction(
        requireContext(),
        "tenants",
        deleted.metadata.name,
        action,
        deleted.metadata.resourceVersion,
        `${action}-deleted-tenant`);
      assertKubernetesStatus(forbidden, 422, "Invalid");
    }
  });
});

async function createTenant(
  displayName: string,
  authority: string,
  idempotencyKey: string
): Promise<TenantDocument> {
  return createTestTenant(
    requireContext(),
    displayName,
    authority,
    idempotencyKey);
}

async function createActiveTenant(
  displayName: string,
  authority: string,
  idempotencyKey: string
): Promise<TenantDocument> {
  const created = await createTenant(displayName, authority, idempotencyKey);
  await completeTenantOperation(created);
  return getTestTenant(requireContext(), created.metadata.name);
}

async function completeTenantOperation(
  tenant: TenantDocument
): Promise<void> {
  await completeLifecycleOperation(
    requireContext(),
    tenantOperation(tenant));
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
    target: {
      tenant: { tenantId: tenant.metadata.name }
    },
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

function kernelMetadata(): Metadata {
  return workloadMetadata(requireContext().kubernetes.callerToken);
}

function hasStatus(expected: status): (error: unknown) => boolean {
  return (error: unknown): boolean =>
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as ServiceError).code === expected;
}

function requireContext(): TenantdTestContext {
  assert.ok(context);
  return context;
}
