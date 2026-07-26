import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import {
  ResourceState,
  type ListTenantsResponse,
  type ResolveTenantResponse,
  type Tenant
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

test("creates, retries, and gets a Tenant", async () => {
  const context = getTenantdTestContext();
  const request = {
    tenantId: "tenant_create",
    address: "tenant-create",
    displayName: "Tenant Create"
  };
  const created = await createTenant(context, request);

  assert.equal(created.tenantId, request.tenantId);
  assert.equal(created.address, request.address);
  assert.equal(created.displayName, request.displayName);
  assert.equal(created.state, ResourceState.RESOURCE_STATE_ACTIVE);
  assert.equal(created.revision, 1n);
  assert.ok(created.createdAt instanceof Date);
  assert.deepEqual(created.updatedAt, created.createdAt);

  const retried = await createTenant(context, request);
  assert.deepEqual(retried, created);

  const loaded = await callUnary<Tenant>((done) =>
    context.client.getTenant(
      { tenantId: request.tenantId },
      done));
  assert.deepEqual(loaded, created);
});

test("enforces Tenant identity, address ownership, and field bounds", async () => {
  const context = getTenantdTestContext();
  await createTenant(context, {
    tenantId: "tenant_conflict",
    address: "tenant-conflict",
    displayName: "Tenant Conflict"
  });

  for (const request of [
    {
      tenantId: "tenant_conflict",
      address: "tenant-conflict",
      displayName: "Different Name"
    },
    {
      tenantId: "tenant_conflict",
      address: "different-address",
      displayName: "Tenant Conflict"
    },
    {
      tenantId: "tenant_conflict_other",
      address: "tenant-conflict",
      displayName: "Other Tenant"
    }
  ]) {
    await assert.rejects(
      createTenant(context, request),
      matchGrpcStatus(status.ALREADY_EXISTS));
  }

  const invalidRequests = [
    { tenantId: "", address: "valid", displayName: "Valid" },
    { tenantId: "_tenant", address: "valid", displayName: "Valid" },
    { tenantId: "Tenant", address: "valid", displayName: "Valid" },
    { tenantId: `t${"a".repeat(64)}`, address: "valid", displayName: "Valid" },
    { tenantId: "valid_a", address: "", displayName: "Valid" },
    { tenantId: "valid_b", address: ".", displayName: "Valid" },
    { tenantId: "valid_c", address: "..", displayName: "Valid" },
    { tenantId: "valid_d", address: "Not-Lower", displayName: "Valid" },
    { tenantId: "valid_e", address: "not/segment", displayName: "Valid" },
    {
      tenantId: "valid_f",
      address: "a".repeat(64),
      displayName: "Valid"
    },
    { tenantId: "valid_g", address: "valid-g", displayName: "" },
    { tenantId: "valid_h", address: "valid-h", displayName: "   " },
    {
      tenantId: "valid_i",
      address: "valid-i",
      displayName: "n".repeat(201)
    }
  ];
  for (const request of invalidRequests) {
    await assert.rejects(
      createTenant(context, request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("lists Tenants with bounded last-ID pagination", async () => {
  const context = getTenantdTestContext();
  for (let index = 0; index < 51; index++) {
    const suffix = String(index).padStart(3, "0");
    await createTenant(context, {
      tenantId: `zzzd_${suffix}`,
      address: `zzzd-${suffix}`,
      displayName: `Paged Tenant ${suffix}`
    });
  }

  const first = await listTenants(context, {
    pageSize: 0,
    afterTenantId: "zzzd"
  });
  assert.equal(first.tenants.length, 50);
  assert.deepEqual(
    first.tenants.map((tenant) => tenant.tenantId),
    Array.from(
      { length: 50 },
      (_, index) => `zzzd_${String(index).padStart(3, "0")}`));
  assert.equal(first.nextAfterTenantId, "zzzd_049");

  const second = await listTenants(context, {
    pageSize: 100,
    afterTenantId: first.nextAfterTenantId
  });
  assert.deepEqual(
    second.tenants.map((tenant) => tenant.tenantId),
    ["zzzd_050"]);
  assert.equal(second.nextAfterTenantId, undefined);

  for (const request of [
    { pageSize: 101, afterTenantId: "zzzd" },
    { pageSize: 1, afterTenantId: "Invalid" }
  ]) {
    await assert.rejects(
      listTenants(context, request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
});

test("pagination remains ordered when a Tenant is inserted between pages", async () => {
  const context = getTenantdTestContext();
  for (const suffix of ["a", "b", "d"]) {
    await createTenant(context, {
      tenantId: `zzze_page_${suffix}`,
      address: `zzze-page-${suffix}`,
      displayName: `Page ${suffix}`
    });
  }

  const first = await listTenants(context, {
    pageSize: 2,
    afterTenantId: "zzze_page"
  });
  assert.deepEqual(
    first.tenants.map((tenant) => tenant.tenantId),
    ["zzze_page_a", "zzze_page_b"]);
  assert.equal(first.nextAfterTenantId, "zzze_page_b");

  await createTenant(context, {
    tenantId: "zzze_page_c",
    address: "zzze-page-c",
    displayName: "Page c"
  });
  const second = await listTenants(context, {
    pageSize: 2,
    afterTenantId: first.nextAfterTenantId
  });
  assert.deepEqual(
    second.tenants.map((tenant) => tenant.tenantId),
    ["zzze_page_c", "zzze_page_d"]);
});

test("updates a Tenant with optimistic revision checks", async () => {
  const context = getTenantdTestContext();
  const created = await createTenant(context, {
    tenantId: "tenant_update",
    address: "tenant-update",
    displayName: "Before Update"
  });
  const updated = await callUnary<Tenant>((done) =>
    context.client.updateTenant(
      {
        tenantId: created.tenantId,
        expectedRevision: created.revision,
        displayName: "After Update"
      },
      done));
  assert.equal(updated.displayName, "After Update");
  assert.equal(updated.revision, 2n);
  assert.deepEqual(updated.createdAt, created.createdAt);
  assert.ok(updated.updatedAt!.getTime() >= created.updatedAt!.getTime());

  const unchanged = await callUnary<Tenant>((done) =>
    context.client.updateTenant(
      {
        tenantId: updated.tenantId,
        expectedRevision: updated.revision,
        displayName: updated.displayName
      },
      done));
  assert.deepEqual(unchanged, updated);

  for (const request of [
    {
      tenantId: updated.tenantId,
      expectedRevision: 0n,
      displayName: "Invalid Revision"
    },
    {
      tenantId: updated.tenantId,
      expectedRevision: 9_223_372_036_854_775_808n,
      displayName: "Invalid Revision"
    },
    {
      tenantId: updated.tenantId,
      expectedRevision: updated.revision,
      displayName: " "
    }
  ]) {
    await assert.rejects(
      callUnary<Tenant>((done) =>
        context.client.updateTenant(
          request,
          done)),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }

  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.client.updateTenant(
        {
          tenantId: updated.tenantId,
          expectedRevision: 1n,
          displayName: "Stale"
        },
        done)),
    matchGrpcStatus(status.ABORTED));
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.client.updateTenant(
        {
          tenantId: "tenant_missing",
          expectedRevision: 1n,
          displayName: "Missing"
        },
        done)),
    matchGrpcStatus(status.NOT_FOUND));
});

test("enforces Tenant state, child, retention, and resolution rules", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "tenant_state",
    address: "tenant-state",
    displayName: "Tenant State"
  });
  const activeResolution = await resolveTenant(context, tenant.address);
  assert.deepEqual(activeResolution, {
    tenantId: tenant.tenantId,
    state: ResourceState.RESOURCE_STATE_ACTIVE,
    revision: 1n
  });

  const suspended = await setTenantState(
    context,
    tenant.tenantId,
    tenant.revision,
    ResourceState.RESOURCE_STATE_SUSPENDED);
  assert.equal(suspended.state, ResourceState.RESOURCE_STATE_SUSPENDED);
  assert.equal(suspended.revision, 2n);
  assert.deepEqual(
    await setTenantState(
      context,
      tenant.tenantId,
      suspended.revision,
      ResourceState.RESOURCE_STATE_SUSPENDED),
    suspended);
  await assert.rejects(
    resolveTenant(context, tenant.address),
    matchGrpcStatus(status.NOT_FOUND));

  const active = await setTenantState(
    context,
    tenant.tenantId,
    suspended.revision,
    ResourceState.RESOURCE_STATE_ACTIVE);
  const workspace = await createWorkspace(context, {
    workspaceId: "workspace_tenant_state",
    tenantId: tenant.tenantId,
    address: "workspace-tenant-state",
    displayName: "Workspace Tenant State"
  });
  await assert.rejects(
    setTenantState(
      context,
      tenant.tenantId,
      active.revision,
      ResourceState.RESOURCE_STATE_DELETED),
    matchGrpcStatus(status.FAILED_PRECONDITION));

  const deletedWorkspace = await callUnary<import(
    "../generated/v1/tenantd.js"
  ).Workspace>((done) =>
    context.client.setWorkspaceState(
      {
        workspaceId: workspace.workspaceId,
        expectedRevision: workspace.revision,
        state: ResourceState.RESOURCE_STATE_DELETED
      },
      done));
  assert.equal(
    deletedWorkspace.state,
    ResourceState.RESOURCE_STATE_DELETED);

  const deleted = await setTenantState(
    context,
    tenant.tenantId,
    active.revision,
    ResourceState.RESOURCE_STATE_DELETED);
  assert.equal(deleted.state, ResourceState.RESOURCE_STATE_DELETED);
  assert.equal(deleted.revision, 4n);

  const retained = await callUnary<Tenant>((done) =>
    context.client.getTenant(
      { tenantId: tenant.tenantId },
      done));
  assert.deepEqual(retained, deleted);
  assert.deepEqual(
    await createTenant(context, {
      tenantId: tenant.tenantId,
      address: tenant.address,
      displayName: tenant.displayName
    }),
    deleted);
  await assert.rejects(
    createTenant(context, {
      tenantId: "tenant_reuse",
      address: tenant.address,
      displayName: "Cannot Reuse"
    }),
    matchGrpcStatus(status.ALREADY_EXISTS));
  await assert.rejects(
    resolveTenant(context, tenant.address),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.client.updateTenant(
        {
          tenantId: tenant.tenantId,
          expectedRevision: deleted.revision,
          displayName: "Cannot Update"
        },
        done)),
    matchGrpcStatus(status.FAILED_PRECONDITION));
  await assert.rejects(
    setTenantState(
      context,
      tenant.tenantId,
      deleted.revision,
      ResourceState.RESOURCE_STATE_ACTIVE),
    matchGrpcStatus(status.FAILED_PRECONDITION));
});

test("rejects invalid or absent Tenant lookups and state requests", async () => {
  const context = getTenantdTestContext();
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.client.getTenant(
        { tenantId: "tenant_absent" },
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.client.getTenant(
        { tenantId: "Invalid" },
        done)),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    setTenantState(
      context,
      "tenant_absent",
      1n,
      ResourceState.RESOURCE_STATE_ACTIVE),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    setTenantState(
      context,
      "tenant_create",
      1n,
      ResourceState.RESOURCE_STATE_UNSPECIFIED),
    matchGrpcStatus(status.INVALID_ARGUMENT));
  await assert.rejects(
    resolveTenant(context, "missing-tenant"),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    resolveTenant(context, "Not-Canonical"),
    matchGrpcStatus(status.INVALID_ARGUMENT));
});

async function listTenants(
  context: ReturnType<typeof getTenantdTestContext>,
  request: {
    readonly pageSize: number;
    readonly afterTenantId?: string;
  }
): Promise<ListTenantsResponse> {
  return await callUnary<ListTenantsResponse>((done) =>
    context.client.listTenants(
      request,
      done));
}

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

async function resolveTenant(
  context: ReturnType<typeof getTenantdTestContext>,
  address: string
): Promise<ResolveTenantResponse> {
  return await callUnary<ResolveTenantResponse>((done) =>
    context.workloadClient.resolveTenant(
      { address },
      workloadMetadata(context.workload.callerToken),
      done));
}
