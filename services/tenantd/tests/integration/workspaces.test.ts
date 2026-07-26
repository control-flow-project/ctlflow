import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  ResourceState,
  type ResolveWorkspaceResponse,
  type Tenant,
  type Workspace
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import { callUnary } from "../support/call-unary.js";
import { matchGrpcStatus } from "../support/match-grpc-status.js";
import {
  createTenant
} from "../support/tenants/create-tenant.js";
import { workloadMetadata } from "../support/workload-metadata.js";
import {
  createWorkspace
} from "../support/workspaces/create-workspace.js";

test("creates, retries, and gets a Workspace", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "workspace_create_parent",
    address: "workspace-create-parent",
    displayName: "Workspace Create Parent"
  });
  const request = {
    workspaceId: "workspace_create",
    tenantId: tenant.tenantId,
    address: "workspace-create",
    displayName: "Workspace Create"
  };
  const created = await createWorkspace(context, request);

  assert.equal(created.workspaceId, request.workspaceId);
  assert.equal(created.tenantId, request.tenantId);
  assert.equal(created.address, request.address);
  assert.equal(created.displayName, request.displayName);
  assert.equal(created.state, ResourceState.RESOURCE_STATE_ACTIVE);
  assert.equal(created.revision, 1n);
  assert.ok(created.createdAt instanceof Date);
  assert.deepEqual(created.updatedAt, created.createdAt);

  const retried = await createWorkspace(context, request);
  assert.deepEqual(retried, created);
  const loaded = await callUnary<Workspace>((done) =>
    context.client.getWorkspace(
      { workspaceId: created.workspaceId },
      done));
  assert.deepEqual(loaded, created);
});

test("enforces Workspace identity, scoped address ownership, and parents", async () => {
  const context = getTenantdTestContext();
  const firstParent = await createTenant(context, {
    tenantId: "workspace_conflict_parent_a",
    address: "workspace-conflict-parent-a",
    displayName: "Workspace Conflict Parent A"
  });
  const secondParent = await createTenant(context, {
    tenantId: "workspace_conflict_parent_b",
    address: "workspace-conflict-parent-b",
    displayName: "Workspace Conflict Parent B"
  });
  await createWorkspace(context, {
    workspaceId: "workspace_conflict",
    tenantId: firstParent.tenantId,
    address: "shared-workspace-address",
    displayName: "Workspace Conflict"
  });

  for (const request of [
    {
      workspaceId: "workspace_conflict",
      tenantId: firstParent.tenantId,
      address: "shared-workspace-address",
      displayName: "Different Name"
    },
    {
      workspaceId: "workspace_conflict",
      tenantId: secondParent.tenantId,
      address: "different-address",
      displayName: "Workspace Conflict"
    },
    {
      workspaceId: "workspace_conflict_other",
      tenantId: firstParent.tenantId,
      address: "shared-workspace-address",
      displayName: "Other Workspace"
    }
  ]) {
    await assert.rejects(
      createWorkspace(context, request),
      matchGrpcStatus(status.ALREADY_EXISTS));
  }

  const sameAddressOtherParent = await createWorkspace(context, {
    workspaceId: "workspace_scoped_address",
    tenantId: secondParent.tenantId,
    address: "shared-workspace-address",
    displayName: "Scoped Address"
  });
  assert.equal(sameAddressOtherParent.tenantId, secondParent.tenantId);

  await assert.rejects(
    createWorkspace(context, {
      workspaceId: "workspace_missing_parent",
      tenantId: "tenant_absent_parent",
      address: "workspace-missing-parent",
      displayName: "Missing Parent"
    }),
    matchGrpcStatus(status.NOT_FOUND));

  const suspendedParent = await setTenantState(
    context,
    secondParent.tenantId,
    secondParent.revision,
    ResourceState.RESOURCE_STATE_SUSPENDED);
  assert.equal(
    suspendedParent.state,
    ResourceState.RESOURCE_STATE_SUSPENDED);
  await assert.rejects(
    createWorkspace(context, {
      workspaceId: "workspace_inactive_parent",
      tenantId: secondParent.tenantId,
      address: "workspace-inactive-parent",
      displayName: "Inactive Parent"
    }),
    matchGrpcStatus(status.FAILED_PRECONDITION));
});

test("validates every Workspace field", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "workspace_validation_parent",
    address: "workspace-validation-parent",
    displayName: "Workspace Validation Parent"
  });
  const invalidRequests = [
    {
      workspaceId: "",
      tenantId: tenant.tenantId,
      address: "valid",
      displayName: "Valid"
    },
    {
      workspaceId: "_workspace",
      tenantId: tenant.tenantId,
      address: "valid",
      displayName: "Valid"
    },
    {
      workspaceId: "Workspace",
      tenantId: tenant.tenantId,
      address: "valid",
      displayName: "Valid"
    },
    {
      workspaceId: `w${"a".repeat(64)}`,
      tenantId: tenant.tenantId,
      address: "valid",
      displayName: "Valid"
    },
    {
      workspaceId: "valid_a",
      tenantId: "Invalid",
      address: "valid",
      displayName: "Valid"
    },
    {
      workspaceId: "valid_b",
      tenantId: tenant.tenantId,
      address: "",
      displayName: "Valid"
    },
    {
      workspaceId: "valid_c",
      tenantId: tenant.tenantId,
      address: ".",
      displayName: "Valid"
    },
    {
      workspaceId: "valid_d",
      tenantId: tenant.tenantId,
      address: "..",
      displayName: "Valid"
    },
    {
      workspaceId: "valid_e",
      tenantId: tenant.tenantId,
      address: "Not-Lower",
      displayName: "Valid"
    },
    {
      workspaceId: "valid_f",
      tenantId: tenant.tenantId,
      address: "not/segment",
      displayName: "Valid"
    },
    {
      workspaceId: "valid_g",
      tenantId: tenant.tenantId,
      address: "a".repeat(64),
      displayName: "Valid"
    },
    {
      workspaceId: "valid_h",
      tenantId: tenant.tenantId,
      address: "valid-h",
      displayName: ""
    },
    {
      workspaceId: "valid_i",
      tenantId: tenant.tenantId,
      address: "valid-i",
      displayName: " "
    },
    {
      workspaceId: "valid_j",
      tenantId: tenant.tenantId,
      address: "valid-j",
      displayName: "n".repeat(201)
    }
  ];

  for (const request of invalidRequests) {
    await assert.rejects(
      createWorkspace(context, request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("updates a Workspace with optimistic revision checks", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "workspace_update_parent",
    address: "workspace-update-parent",
    displayName: "Workspace Update Parent"
  });
  const created = await createWorkspace(context, {
    workspaceId: "workspace_update",
    tenantId: tenant.tenantId,
    address: "workspace-update",
    displayName: "Before Update"
  });
  const updated = await callUnary<Workspace>((done) =>
    context.client.updateWorkspace(
      {
        workspaceId: created.workspaceId,
        expectedRevision: created.revision,
        displayName: "After Update"
      },
      done));
  assert.equal(updated.displayName, "After Update");
  assert.equal(updated.revision, 2n);
  assert.deepEqual(updated.createdAt, created.createdAt);
  assert.ok(updated.updatedAt!.getTime() >= created.updatedAt!.getTime());

  const unchanged = await callUnary<Workspace>((done) =>
    context.client.updateWorkspace(
      {
        workspaceId: updated.workspaceId,
        expectedRevision: updated.revision,
        displayName: updated.displayName
      },
      done));
  assert.deepEqual(unchanged, updated);

  for (const request of [
    {
      workspaceId: updated.workspaceId,
      expectedRevision: 0n,
      displayName: "Invalid"
    },
    {
      workspaceId: updated.workspaceId,
      expectedRevision: 9_223_372_036_854_775_808n,
      displayName: "Invalid"
    },
    {
      workspaceId: updated.workspaceId,
      expectedRevision: updated.revision,
      displayName: " "
    }
  ]) {
    await assert.rejects(
      callUnary<Workspace>((done) =>
        context.client.updateWorkspace(
          request,
          done)),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.client.updateWorkspace(
        {
          workspaceId: updated.workspaceId,
          expectedRevision: 1n,
          displayName: "Stale"
        },
        done)),
    matchGrpcStatus(status.ABORTED));
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.client.updateWorkspace(
        {
          workspaceId: "workspace_absent_update",
          expectedRevision: 1n,
          displayName: "Missing"
        },
        done)),
    matchGrpcStatus(status.NOT_FOUND));
});

test("enforces Workspace state, parent fencing, retention, and resolution", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "workspace_state_parent",
    address: "workspace-state-parent",
    displayName: "Workspace State Parent"
  });
  const workspace = await createWorkspace(context, {
    workspaceId: "workspace_state",
    tenantId: tenant.tenantId,
    address: "workspace-state",
    displayName: "Workspace State"
  });
  assert.deepEqual(
    await resolveWorkspace(context, tenant.tenantId, workspace.address),
    {
      workspaceId: workspace.workspaceId,
      state: ResourceState.RESOURCE_STATE_ACTIVE,
      revision: 1n
    });

  const suspended = await setWorkspaceState(
    context,
    workspace.workspaceId,
    workspace.revision,
    ResourceState.RESOURCE_STATE_SUSPENDED);
  assert.equal(suspended.revision, 2n);
  assert.deepEqual(
    await setWorkspaceState(
      context,
      workspace.workspaceId,
      suspended.revision,
      ResourceState.RESOURCE_STATE_SUSPENDED),
    suspended);
  await assert.rejects(
    resolveWorkspace(context, tenant.tenantId, workspace.address),
    matchGrpcStatus(status.NOT_FOUND));

  const suspendedParent = await setTenantState(
    context,
    tenant.tenantId,
    tenant.revision,
    ResourceState.RESOURCE_STATE_SUSPENDED);
  await assert.rejects(
    setWorkspaceState(
      context,
      workspace.workspaceId,
      suspended.revision,
      ResourceState.RESOURCE_STATE_ACTIVE),
    matchGrpcStatus(status.FAILED_PRECONDITION));
  const activeParent = await setTenantState(
    context,
    tenant.tenantId,
    suspendedParent.revision,
    ResourceState.RESOURCE_STATE_ACTIVE);
  assert.equal(activeParent.state, ResourceState.RESOURCE_STATE_ACTIVE);

  const active = await setWorkspaceState(
    context,
    workspace.workspaceId,
    suspended.revision,
    ResourceState.RESOURCE_STATE_ACTIVE);
  assert.equal(active.revision, 3n);
  await setTenantState(
    context,
    tenant.tenantId,
    activeParent.revision,
    ResourceState.RESOURCE_STATE_SUSPENDED);
  await assert.rejects(
    resolveWorkspace(context, tenant.tenantId, workspace.address),
    matchGrpcStatus(status.NOT_FOUND));
  const reactivatedParent = await setTenantState(
    context,
    tenant.tenantId,
    activeParent.revision + 1n,
    ResourceState.RESOURCE_STATE_ACTIVE);
  assert.equal(reactivatedParent.state, ResourceState.RESOURCE_STATE_ACTIVE);

  const deleted = await setWorkspaceState(
    context,
    workspace.workspaceId,
    active.revision,
    ResourceState.RESOURCE_STATE_DELETED);
  assert.equal(deleted.state, ResourceState.RESOURCE_STATE_DELETED);
  assert.equal(deleted.revision, 4n);
  const retained = await callUnary<Workspace>((done) =>
    context.client.getWorkspace(
      { workspaceId: workspace.workspaceId },
      done));
  assert.deepEqual(retained, deleted);
  assert.deepEqual(
    await createWorkspace(context, {
      workspaceId: workspace.workspaceId,
      tenantId: tenant.tenantId,
      address: workspace.address,
      displayName: workspace.displayName
    }),
    deleted);
  await assert.rejects(
    createWorkspace(context, {
      workspaceId: "workspace_reuse",
      tenantId: tenant.tenantId,
      address: workspace.address,
      displayName: "Cannot Reuse"
    }),
    matchGrpcStatus(status.ALREADY_EXISTS));
  await assert.rejects(
    resolveWorkspace(context, tenant.tenantId, workspace.address),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.client.updateWorkspace(
        {
          workspaceId: workspace.workspaceId,
          expectedRevision: deleted.revision,
          displayName: "Cannot Update"
        },
        done)),
    matchGrpcStatus(status.FAILED_PRECONDITION));
  await assert.rejects(
    setWorkspaceState(
      context,
      workspace.workspaceId,
      deleted.revision,
      ResourceState.RESOURCE_STATE_ACTIVE),
    matchGrpcStatus(status.FAILED_PRECONDITION));
});

test("rejects invalid, absent, and cross-parent Workspace lookups", async () => {
  const context = getTenantdTestContext();
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.client.getWorkspace(
        { workspaceId: "workspace_absent" },
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.client.getWorkspace(
        { workspaceId: "Invalid" },
        done)),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    setWorkspaceState(
      context,
      "workspace_absent",
      1n,
      ResourceState.RESOURCE_STATE_ACTIVE),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    setWorkspaceState(
      context,
      "workspace_create",
      1n,
      ResourceState.RESOURCE_STATE_UNSPECIFIED),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    resolveWorkspace(context, "Invalid", "workspace-create"),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    resolveWorkspace(
      context,
      "workspace_validation_parent",
      "Not-Canonical"),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    resolveWorkspace(
      context,
      "workspace_validation_parent",
      "workspace-absent"),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    resolveWorkspace(
      context,
      "workspace_conflict_parent_b",
      "workspace-create"),
    matchGrpcStatus(status.NOT_FOUND));
});

async function setTenantState(
  context: ReturnType<typeof getTenantdTestContext>,
  tenantId: string,
  expectedRevision: bigint,
  state: ResourceState
): Promise<Tenant> {
  return await callUnary<Tenant>((done) =>
    context.client.setTenantState(
      { tenantId, expectedRevision, state },
      done));
}

async function setWorkspaceState(
  context: ReturnType<typeof getTenantdTestContext>,
  workspaceId: string,
  expectedRevision: bigint,
  state: ResourceState
): Promise<Workspace> {
  return await callUnary<Workspace>((done) =>
    context.client.setWorkspaceState(
      { workspaceId, expectedRevision, state },
      done));
}

async function resolveWorkspace(
  context: ReturnType<typeof getTenantdTestContext>,
  tenantId: string,
  address: string
): Promise<ResolveWorkspaceResponse> {
  return await callUnary<ResolveWorkspaceResponse>((done) =>
    context.workloadClient.resolveWorkspace(
      { tenantId, address },
      workloadMetadata(context.workload.callerToken),
      done));
}
