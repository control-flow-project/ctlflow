import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  ListWorkspacesResponse
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import { callUnary } from "../support/call-unary.js";
import { matchGrpcStatus } from "../support/match-grpc-status.js";
import {
  createTenant
} from "../support/tenants/create-tenant.js";
import {
  createWorkspace
} from "../support/workspaces/create-workspace.js";

test("lists Workspaces with bounded last-ID pagination", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "workspace_page_parent",
    address: "workspace-page-parent",
    displayName: "Workspace Page Parent"
  });
  for (let index = 0; index < 51; index++) {
    const suffix = String(index).padStart(3, "0");
    await createWorkspace(context, {
      workspaceId: `zzzd_workspace_${suffix}`,
      tenantId: tenant.tenantId,
      address: `zzzd-workspace-${suffix}`,
      displayName: `Paged Workspace ${suffix}`
    });
  }

  const first = await listWorkspaces({
    tenantId: tenant.tenantId,
    pageSize: 0,
    afterWorkspaceId: "zzzd_workspace"
  });
  assert.equal(first.workspaces.length, 50);
  assert.deepEqual(
    first.workspaces.map((workspace) => workspace.workspaceId),
    Array.from(
      { length: 50 },
      (_, index) => `zzzd_workspace_${String(index).padStart(3, "0")}`));
  assert.equal(first.nextAfterWorkspaceId, "zzzd_workspace_049");

  const second = await listWorkspaces({
    tenantId: tenant.tenantId,
    pageSize: 100,
    afterWorkspaceId: first.nextAfterWorkspaceId!
  });
  assert.deepEqual(
    second.workspaces.map((workspace) => workspace.workspaceId),
    ["zzzd_workspace_050"]);
  assert.equal(second.nextAfterWorkspaceId, undefined);

  for (const request of [
    {
      tenantId: tenant.tenantId,
      pageSize: 101,
      afterWorkspaceId: "zzzd_workspace"
    },
    {
      tenantId: tenant.tenantId,
      pageSize: 1,
      afterWorkspaceId: "Invalid"
    }
  ]) {
    await assert.rejects(
      listWorkspaces(request),
      matchGrpcStatus(status.INVALID_ARGUMENT));
  }
  await assert.rejects(
    listWorkspaces({
      tenantId: "tenant_absent_for_list",
      pageSize: 10
    }),
    matchGrpcStatus(status.NOT_FOUND));
});

test("Workspace pagination remains ordered across concurrent insertion", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "workspace_insert_page_parent",
    address: "workspace-insert-page-parent",
    displayName: "Workspace Insert Page Parent"
  });
  for (const suffix of ["a", "b", "d"]) {
    await createWorkspace(context, {
      workspaceId: `zzze_workspace_${suffix}`,
      tenantId: tenant.tenantId,
      address: `zzze-workspace-${suffix}`,
      displayName: `Page ${suffix}`
    });
  }

  const first = await listWorkspaces({
    tenantId: tenant.tenantId,
    pageSize: 2,
    afterWorkspaceId: "zzze_workspace"
  });
  assert.deepEqual(
    first.workspaces.map((workspace) => workspace.workspaceId),
    ["zzze_workspace_a", "zzze_workspace_b"]);
  assert.equal(first.nextAfterWorkspaceId, "zzze_workspace_b");

  await createWorkspace(context, {
    workspaceId: "zzze_workspace_c",
    tenantId: tenant.tenantId,
    address: "zzze-workspace-c",
    displayName: "Page c"
  });
  const second = await listWorkspaces({
    tenantId: tenant.tenantId,
    pageSize: 2,
    afterWorkspaceId: first.nextAfterWorkspaceId!
  });
  assert.deepEqual(
    second.workspaces.map((workspace) => workspace.workspaceId),
    ["zzze_workspace_c", "zzze_workspace_d"]);
});

async function listWorkspaces(request: {
  readonly tenantId: string;
  readonly pageSize: number;
  readonly afterWorkspaceId?: string;
}): Promise<ListWorkspacesResponse> {
  const context = getTenantdTestContext();
  return await callUnary<ListWorkspacesResponse>((done) =>
    context.client.listWorkspaces(
      request,
      done));
}
