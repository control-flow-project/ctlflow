import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import {
  ResourceState,
  type ListTenantsResponse,
  type ResolveTenantResponse,
  type ResolveWorkspaceResponse,
  type Tenant,
  type TenantServiceClient,
  type Workspace
} from "../generated/v1/tenantd.js";
import {
  getTenantdTestContext
} from "../suite/get-tenantd-test-context.js";
import { callUnary } from "../support/call-unary.js";
import {
  createInvalidInvocationTokens
} from "../support/create-invalid-invocation-tokens.js";
import { matchGrpcStatus } from "../support/match-grpc-status.js";
import {
  createTenant
} from "../support/tenants/create-tenant.js";
import { workloadMetadata } from "../support/workload-metadata.js";
import {
  createWorkspace
} from "../support/workspaces/create-workspace.js";

test("operator RPCs require a client certificate", async () => {
  const context = getTenantdTestContext();
  for (const call of createOperatorOnlyRpcCalls(
    context.workloadClient,
    new Metadata()
  )) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.UNAUTHENTICATED),
      call.name);
  }
});

test("operator RPCs reject a trusted but unadmitted certificate", async () => {
  const context = getTenantdTestContext();
  for (const call of createOperatorOnlyRpcCalls(
    context.unadmittedOperatorClient,
    new Metadata()
  )) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.PERMISSION_DENIED),
      call.name);
  }
});

test("an admitted operator certificate reaches the domain contract", async () => {
  const context = getTenantdTestContext();
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.client.createTenant(
        {
          tenantId: "",
          address: "",
          displayName: ""
        },
        done)),
    matchGrpcStatus(status.INVALID_ARGUMENT));
});

test("workload reads require an admitted workload or operator", async () => {
  const context = getTenantdTestContext();
  for (const call of createWorkloadReadRpcCalls(
    context.workloadClient,
    new Metadata()
  )) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.UNAUTHENTICATED),
      call.name);
  }

  const unadmitted = workloadMetadata(
    context.workload.unadmittedToken);
  for (const call of createWorkloadReadRpcCalls(
    context.workloadClient,
    unadmitted
  )) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.PERMISSION_DENIED),
      call.name);
  }

  await assert.rejects(
    callUnary<ResolveTenantResponse>((done) =>
      context.client.resolveTenant(
        { address: "unknown-security-tenant" },
        done)),
    matchGrpcStatus(status.NOT_FOUND));
});

test("rejects malformed, expired, overlong, and unbound workload tokens", async () => {
  const context = getTenantdTestContext();
  for (const token of [
    "not-a-token",
    context.workload.expiredToken,
    context.workload.overlongToken,
    context.workload.unboundToken,
    context.workload.wrongAudienceToken
  ]) {
    await assert.rejects(
      callUnary<ResolveTenantResponse>((done) =>
        context.workloadClient.resolveTenant(
          { address: "security-tenant" },
          workloadMetadata(token),
          done)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }

  for (const value of ["", "Basic credential", "Bearer", "Bearer a b"]) {
    const metadata = new Metadata();
    metadata.set("authorization", value);
    await assert.rejects(
      callUnary<ResolveTenantResponse>((done) =>
        context.workloadClient.resolveTenant(
          { address: "security-tenant" },
          metadata,
          done)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("workload and invocation identity never confer operator authority", async () => {
  const context = getTenantdTestContext();
  const metadata = workloadMetadata(
    context.workload.callerToken,
    context.invocation.sign({ tenantId: "security_tenant" }));
  for (const call of createOperatorOnlyRpcCalls(
    context.workloadClient,
    metadata
  )) {
    await assert.rejects(
      call.request(),
      matchGrpcStatus(status.UNAUTHENTICATED),
      call.name);
  }
});

test("resolution accepts valid session and run invocation identities", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "security_tenant",
    address: "security-tenant",
    displayName: "Security Tenant"
  });
  const workspace = await createWorkspace(context, {
    workspaceId: "security_workspace",
    tenantId: tenant.tenantId,
    address: "security-workspace",
    displayName: "Security Workspace"
  });
  const session = context.invocation.sign({
    tenantId: tenant.tenantId,
    workspaceId: workspace.workspaceId,
    tokenId: "security-session"
  });
  const directRun = context.invocation.sign({
    tenantId: tenant.tenantId,
    workspaceId: workspace.workspaceId,
    subject: "service:automation",
    sessionId: null,
    runId: "security-direct-run",
    tokenId: "security-direct-run-token"
  });
  const virtualRun = context.invocation.sign({
    tenantId: tenant.tenantId,
    workspaceId: workspace.workspaceId,
    subject: "service:automation",
    sessionId: null,
    runId: "security-run",
    actorSubject: "agent:security-agent",
    tokenId: "security-run-token"
  });
  const autonomous = workloadMetadata(context.workload.callerToken);
  const autonomouslyFoundTenant = await callUnary<Tenant>((done) =>
    context.workloadClient.getTenant(
      { tenantId: tenant.tenantId },
      autonomous,
      done));
  assert.equal(autonomouslyFoundTenant.tenantId, tenant.tenantId);
  const autonomouslyFoundWorkspace = await callUnary<Workspace>((done) =>
    context.workloadClient.getWorkspace(
      { workspaceId: workspace.workspaceId },
      autonomous,
      done));
  assert.equal(
    autonomouslyFoundWorkspace.workspaceId,
    workspace.workspaceId);

  for (const invocation of [session, directRun, virtualRun]) {
    const metadata = workloadMetadata(
      context.workload.callerToken,
      invocation);
    const foundTenant = await callUnary<Tenant>((done) =>
      context.workloadClient.getTenant(
        { tenantId: tenant.tenantId },
        metadata,
        done));
    assert.equal(foundTenant.tenantId, tenant.tenantId);
    const foundWorkspace = await callUnary<Workspace>((done) =>
      context.workloadClient.getWorkspace(
        { workspaceId: workspace.workspaceId },
        metadata,
        done));
    assert.equal(foundWorkspace.workspaceId, workspace.workspaceId);
    const resolvedTenant = await callUnary<ResolveTenantResponse>((done) =>
      context.workloadClient.resolveTenant(
        { address: tenant.address },
        metadata,
        done));
    assert.equal(resolvedTenant.tenantId, tenant.tenantId);
    const resolvedWorkspace =
      await callUnary<ResolveWorkspaceResponse>((done) =>
        context.workloadClient.resolveWorkspace(
          {
            tenantId: tenant.tenantId,
            address: workspace.address
          },
          metadata,
          done));
    assert.equal(resolvedWorkspace.workspaceId, workspace.workspaceId);
  }
});

test("workload reads apply Tenant and Workspace invocation fences", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "security_fence_tenant",
    address: "security-fence-tenant",
    displayName: "Security Fence Tenant"
  });
  const workspace = await createWorkspace(context, {
    workspaceId: "security_fence_workspace",
    tenantId: tenant.tenantId,
    address: "security-fence-workspace",
    displayName: "Security Fence Workspace"
  });
  const otherTenant = await createTenant(context, {
    tenantId: "security_other_tenant",
    address: "security-other-tenant",
    displayName: "Security Other Tenant"
  });
  const otherWorkspace = await createWorkspace(context, {
    workspaceId: "security_other_workspace",
    tenantId: tenant.tenantId,
    address: "security-other-workspace",
    displayName: "Security Other Workspace"
  });

  const tenantFence = workloadMetadata(
    context.workload.callerToken,
    context.invocation.sign({
      tenantId: otherTenant.tenantId,
      tokenId: "security-tenant-fence"
    }));
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.workloadClient.getTenant(
        { tenantId: tenant.tenantId },
        tenantFence,
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.workloadClient.getWorkspace(
        { workspaceId: workspace.workspaceId },
        tenantFence,
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<ResolveTenantResponse>((done) =>
      context.workloadClient.resolveTenant(
        { address: tenant.address },
        tenantFence,
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<ResolveWorkspaceResponse>((done) =>
      context.workloadClient.resolveWorkspace(
        {
          tenantId: tenant.tenantId,
          address: workspace.address
        },
        tenantFence,
        done)),
    matchGrpcStatus(status.NOT_FOUND));

  const workspaceFence = workloadMetadata(
    context.workload.callerToken,
    context.invocation.sign({
      tenantId: tenant.tenantId,
      workspaceId: otherWorkspace.workspaceId,
      tokenId: "security-workspace-fence"
    }));
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.workloadClient.getWorkspace(
        { workspaceId: workspace.workspaceId },
        workspaceFence,
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<ResolveWorkspaceResponse>((done) =>
      context.workloadClient.resolveWorkspace(
        {
          tenantId: tenant.tenantId,
          address: workspace.address
        },
        workspaceFence,
        done)),
    matchGrpcStatus(status.NOT_FOUND));
});

test("resolution rejects every malformed invocation token shape", async () => {
  const context = getTenantdTestContext();
  for (const token of createInvalidInvocationTokens(context.invocation)) {
    await assert.rejects(
      callUnary<ResolveTenantResponse>((done) =>
        context.workloadClient.resolveTenant(
          { address: "security-tenant" },
          workloadMetadata(context.workload.callerToken, token),
          done)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }

  for (const value of ["", "Basic credential", "Bearer", "Bearer a b"]) {
    const metadata = workloadMetadata(context.workload.callerToken);
    metadata.set("ctlflow-invocation", value);
    await assert.rejects(
      callUnary<ResolveTenantResponse>((done) =>
        context.workloadClient.resolveTenant(
          { address: "security-tenant" },
          metadata,
          done)),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("resolution propagates deadlines and client cancellation", async () => {
  const context = getTenantdTestContext();
  await assert.rejects(
    callUnary<ResolveWorkspaceResponse>((done) =>
      context.workloadClient.resolveWorkspace(
        {
          tenantId: "security_tenant",
          address: "security-workspace"
        },
        workloadMetadata(context.workload.callerToken),
        { deadline: Date.now() - 1 },
        done)),
    matchGrpcStatus(status.DEADLINE_EXCEEDED));

  await assert.rejects(
    new Promise<never>((_resolve, reject) => {
      const call = context.workloadClient.resolveWorkspace(
        {
          tenantId: "security_tenant",
          address: "security-workspace"
        },
        workloadMetadata(context.workload.callerToken),
        (error) => {
          reject(error ?? new Error("Cancelled RPC returned no error"));
        });
      call.on("error", () => undefined);
      call.cancel();
    }),
    matchGrpcStatus(status.CANCELLED));
});

function createOperatorOnlyRpcCalls(
  client: TenantServiceClient,
  metadata: Metadata
): readonly RpcCall[] {
  return [
    {
      name: "CreateTenant",
      request: () => callUnary<Tenant>((done) =>
        client.createTenant(
          { tenantId: "", address: "", displayName: "" },
          metadata,
          done))
    },
    {
      name: "ListTenants",
      request: () => callUnary<ListTenantsResponse>((done) =>
        client.listTenants({ pageSize: 0 }, metadata, done))
    },
    {
      name: "SetTenantState",
      request: () => callUnary<Tenant>((done) =>
        client.setTenantState(
          {
            tenantId: "",
            expectedRevision: 0n,
            state: ResourceState.RESOURCE_STATE_UNSPECIFIED
          },
          metadata,
          done))
    }
  ];
}

function createWorkloadReadRpcCalls(
  client: TenantServiceClient,
  metadata: Metadata
): readonly RpcCall[] {
  return [
    {
      name: "GetTenant",
      request: () => callUnary<Tenant>((done) =>
        client.getTenant({ tenantId: "" }, metadata, done))
    },
    {
      name: "GetWorkspace",
      request: () => callUnary<Workspace>((done) =>
        client.getWorkspace({ workspaceId: "" }, metadata, done))
    },
    {
      name: "ResolveTenant",
      request: () => callUnary<ResolveTenantResponse>((done) =>
        client.resolveTenant(
          { address: "" },
          metadata,
          done))
    },
    {
      name: "ResolveWorkspace",
      request: () => callUnary<ResolveWorkspaceResponse>((done) =>
        client.resolveWorkspace(
          { tenantId: "", address: "" },
          metadata,
          done))
    }
  ];
}

interface RpcCall {
  readonly name: string;
  readonly request: () => Promise<unknown>;
}
