import assert from "node:assert/strict";
import {
  test
} from "node:test";
import type {
  CapabilityGrant
} from "../support/authorization/capability-grant.js";
import {
  ResourceState,
  type ListWorkspacesResponse,
  type Tenant,
  type Workspace
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
import {
  createCapabilityMetadata
} from "../support/authorization/create-capability-metadata.js";
import {
  callUnary
} from "../support/call-unary.js";
import {
  createTenant
} from "../support/tenants/create-tenant.js";

test("tenant capabilities use exact operations and resource paths", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_tenant",
    address: "capability-tenant",
    displayName: "Capability Tenant"
  });
  const path = `/tenants/${tenant.tenantId}`;
  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    grants: [
      grant("user:alice", "tenants.read", path),
      grant(
        "user:alice",
        "tenants.update_display_name",
        path)
    ]
  });
  const metadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    tokenId: "capability-tenant-operations"
  });
  const auditBaseline =
    (await context.auditd.readTenancyEvents()).length;

  const loaded = await callUnary<Tenant>((done) =>
    context.workloadClient.getTenant(
      { tenantId: tenant.tenantId },
      metadata,
      done));
  assert.equal(loaded.tenantId, tenant.tenantId);

  const updated = await callUnary<Tenant>((done) =>
    context.workloadClient.updateTenant(
      {
        tenantId: tenant.tenantId,
        expectedRevision: tenant.revision,
        displayName: "Capability Tenant Updated"
      },
      metadata,
      done));
  assert.equal(
    updated.displayName,
    "Capability Tenant Updated");
  assert.equal(updated.revision, tenant.revision + 1n);

  const audit = (await context.auditd.readTenancyEvents())
    .slice(auditBaseline);
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0]?.attribution, {
    kind: "invocation",
    actorPrincipalId: "user:alice",
    attachedAccountPrincipalId: "user:alice",
    workloadSubject: context.capabilityWorkload.callerSubject
  });
});

test("workspace capabilities cover collection and exact targets", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_workspace_tenant",
    address: "capability-workspace-tenant",
    displayName: "Capability Workspace Tenant"
  });
  const collection =
    `/tenants/${tenant.tenantId}/workspaces`;
  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    grants: [
      grant("user:alice", "workspaces.create", collection),
      grant("user:alice", "workspaces.read", collection)
    ]
  });
  const tenantMetadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    tokenId: "capability-workspace-collection"
  });
  const created = await callUnary<Workspace>((done) =>
    context.workloadClient.createWorkspace(
      {
        workspaceId: "capability_workspace",
        tenantId: tenant.tenantId,
        address: "capability-workspace",
        displayName: "Capability Workspace"
      },
      tenantMetadata,
      done));
  const listed = await callUnary<ListWorkspacesResponse>((done) =>
    context.workloadClient.listWorkspaces(
      {
        tenantId: tenant.tenantId,
        pageSize: 10
      },
      tenantMetadata,
      done));
  assert.ok(listed.workspaces.some(
    (workspace) =>
      workspace.workspaceId === created.workspaceId));

  const exact = `${collection}/${created.workspaceId}`;
  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    workspaceId: created.workspaceId,
    grants: [
      grant("user:alice", "workspaces.read", exact),
      grant(
        "user:alice",
        "workspaces.update_display_name",
        exact),
      grant("user:alice", "workspaces.suspend", exact),
      grant("user:alice", "workspaces.resume", exact),
      grant("user:alice", "workspaces.delete", exact)
    ]
  });
  const workspaceMetadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    workspaceId: created.workspaceId,
    tokenId: "capability-workspace-exact"
  });
  const loaded = await callUnary<Workspace>((done) =>
    context.workloadClient.getWorkspace(
      { workspaceId: created.workspaceId },
      workspaceMetadata,
      done));
  const updated = await callUnary<Workspace>((done) =>
    context.workloadClient.updateWorkspace(
      {
        workspaceId: created.workspaceId,
        expectedRevision: loaded.revision,
        displayName: "Capability Workspace Updated"
      },
      workspaceMetadata,
      done));
  const suspended = await setWorkspaceState(
    created.workspaceId,
    updated.revision,
    ResourceState.RESOURCE_STATE_SUSPENDED,
    workspaceMetadata);
  const resumed = await setWorkspaceState(
    created.workspaceId,
    suspended.revision,
    ResourceState.RESOURCE_STATE_ACTIVE,
    workspaceMetadata);
  const deleted = await setWorkspaceState(
    created.workspaceId,
    resumed.revision,
    ResourceState.RESOURCE_STATE_DELETED,
    workspaceMetadata);
  assert.equal(
    deleted.state,
    ResourceState.RESOURCE_STATE_DELETED);

});

function grant(
  subjectId: string,
  operation: string,
  resourcePath: string
): CapabilityGrant {
  return {
    subject: {
      kind: subjectId.includes(":") ? "principal" : "group",
      id: subjectId
    },
    operation,
    basePath: resourcePath,
    match: "exact"
  };
}

async function setWorkspaceState(
  workspaceId: string,
  expectedRevision: bigint,
  state: ResourceState,
  metadata: import("@grpc/grpc-js").Metadata
): Promise<Workspace> {
  const context = getTenantdTestContext();
  return await callUnary<Workspace>((done) =>
    context.workloadClient.setWorkspaceState(
      {
        workspaceId,
        expectedRevision,
        state
      },
      metadata,
      done));
}
