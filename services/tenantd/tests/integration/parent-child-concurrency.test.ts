import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status,
  type ServiceError
} from "@grpc/grpc-js";
import {
  ResourceState,
  type Tenant,
  type Workspace
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import { callUnary } from "../support/call-unary.js";
import {
  createTenant
} from "../support/tenants/create-tenant.js";
import {
  createWorkspace
} from "../support/workspaces/create-workspace.js";

test("one concurrent update wins each expected Tenant revision", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "tenant_revision_race",
    address: "tenant-revision-race",
    displayName: "Tenant Revision Race"
  });
  const results = await Promise.allSettled([
    updateTenant(tenant, "Tenant Revision Winner A"),
    updateTenant(tenant, "Tenant Revision Winner B")
  ]);
  const fulfilled = results.filter(
    (result) => result.status === "fulfilled");
  const rejected = results.filter(
    (result) => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(
    (rejected[0] as PromiseRejectedResult).reason.code,
    status.ABORTED);

  const stored = await getTenant(tenant.tenantId);
  assert.equal(stored.revision, 2n);
  assert.ok(
    stored.displayName === "Tenant Revision Winner A"
      || stored.displayName === "Tenant Revision Winner B");
});

test("Tenant deletion cannot race Workspace creation past parent fencing",
  async () => {
    const context = getTenantdTestContext();
    for (let index = 0; index < 4; index++) {
      const suffix = String(index);
      const tenant = await createTenant(context, {
        tenantId: `create_race_tenant_${suffix}`,
        address: `create-race-tenant-${suffix}`,
        displayName: `Create Race Tenant ${suffix}`
      });
      const workspaceId = `create_race_workspace_${suffix}`;
      const results = await Promise.allSettled([
        setTenantState(
          tenant.tenantId,
          tenant.revision,
          ResourceState.RESOURCE_STATE_DELETED),
        createWorkspace(context, {
          workspaceId,
          tenantId: tenant.tenantId,
          address: `create-race-workspace-${suffix}`,
          displayName: `Create Race Workspace ${suffix}`
        })
      ]);
      requireAdmittedRaceResults(results);

      const storedTenant = await getTenant(tenant.tenantId);
      const storedWorkspace = await getOptionalWorkspace(workspaceId);
      assert.equal(
        storedTenant.state === ResourceState.RESOURCE_STATE_DELETED
          && storedWorkspace !== undefined
          && storedWorkspace.state !== ResourceState.RESOURCE_STATE_DELETED,
        false);
    }
  });

test("Tenant deletion cannot race Workspace reactivation past parent fencing",
  async () => {
    const context = getTenantdTestContext();
    for (let index = 0; index < 4; index++) {
      const suffix = String(index);
      const tenant = await createTenant(context, {
        tenantId: `reactivate_race_tenant_${suffix}`,
        address: `reactivate-race-tenant-${suffix}`,
        displayName: `Reactivate Race Tenant ${suffix}`
      });
      const created = await createWorkspace(context, {
        workspaceId: `reactivate_race_workspace_${suffix}`,
        tenantId: tenant.tenantId,
        address: `reactivate-race-workspace-${suffix}`,
        displayName: `Reactivate Race Workspace ${suffix}`
      });
      const deleted = await setWorkspaceState(
        created.workspaceId,
        created.revision,
        ResourceState.RESOURCE_STATE_DELETED);
      const results = await Promise.allSettled([
        setTenantState(
          tenant.tenantId,
          tenant.revision,
          ResourceState.RESOURCE_STATE_DELETED),
        setWorkspaceState(
          deleted.workspaceId,
          deleted.revision,
          ResourceState.RESOURCE_STATE_ACTIVE)
      ]);
      requireAdmittedRaceResults(results);

      const storedTenant = await getTenant(tenant.tenantId);
      const storedWorkspace = await getWorkspace(deleted.workspaceId);
      assert.equal(
        storedTenant.state === ResourceState.RESOURCE_STATE_DELETED
          && storedWorkspace.state === ResourceState.RESOURCE_STATE_ACTIVE,
        false);
    }
  });

function requireAdmittedRaceResults(
  results: readonly PromiseSettledResult<unknown>[]
): void {
  for (const result of results) {
    if (result.status === "fulfilled") {
      continue;
    }

    const code = (result.reason as ServiceError).code;
    assert.ok(
      code === status.FAILED_PRECONDITION
        || code === status.UNAVAILABLE,
      `Unexpected concurrent mutation status ${String(code)}`);
  }
}

async function getTenant(tenantId: string): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.client.getTenant(
      { tenantId },
      done));
}

async function getWorkspace(workspaceId: string): Promise<Workspace> {
  const context = getTenantdTestContext();
  return await callUnary<Workspace>((done) =>
    context.client.getWorkspace(
      { workspaceId },
      done));
}

async function getOptionalWorkspace(
  workspaceId: string
): Promise<Workspace | undefined> {
  try {
    return await getWorkspace(workspaceId);
  } catch (error) {
    if ((error as ServiceError).code === status.NOT_FOUND) {
      return undefined;
    }
    throw error;
  }
}

async function setTenantState(
  tenantId: string,
  expectedRevision: bigint,
  state: ResourceState
): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.client.setTenantState(
      {
        tenantId,
        expectedRevision,
        state
      },
      done));
}

async function updateTenant(
  tenant: Tenant,
  displayName: string
): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.client.updateTenant(
      {
        tenantId: tenant.tenantId,
        expectedRevision: tenant.revision,
        displayName
      },
      done));
}

async function setWorkspaceState(
  workspaceId: string,
  expectedRevision: bigint,
  state: ResourceState
): Promise<Workspace> {
  const context = getTenantdTestContext();
  return await callUnary<Workspace>((done) =>
    context.client.setWorkspaceState(
      {
        workspaceId,
        expectedRevision,
        state
      },
      done));
}
