import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  Metadata,
  status
} from "@grpc/grpc-js";
import type {
  PolicyGrant
} from "@ctlflow/policyd/testing/stub";
import type {
  ListTenantsResponse,
  ResolveTenantResponse,
  Tenant,
  Workspace
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
  createInvocationAuthority
} from "../support/create-invocation-authority.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createTenant
} from "../support/tenants/create-tenant.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";
import {
  createWorkspace
} from "../support/workspaces/create-workspace.js";

test("capability callers require both admitted workload and invocation identities", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_identity_tenant",
    address: "capability-identity-tenant",
    displayName: "Capability Identity Tenant"
  });
  await configureReadPolicy(tenant.tenantId);

  for (const metadata of [
    workloadMetadata(
      context.capabilityWorkload.callerToken),
    workloadMetadata(
      context.capabilityWorkload.callerToken,
      "invalid-invocation")
  ]) {
    await assert.rejects(
      getTenant(tenant.tenantId, metadata),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }

  await assert.rejects(
    getTenant(
      tenant.tenantId,
      workloadMetadata(
        context.capabilityWorkload.unadmittedToken,
        context.invocation.sign({
          tenantId: tenant.tenantId,
          tokenId: "capability-unadmitted"
        }))),
    matchGrpcStatus(status.PERMISSION_DENIED));
});

test("autonomous, capability, and operator-only paths stay disjoint", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_disjoint_tenant",
    address: "capability-disjoint-tenant",
    displayName: "Capability Disjoint Tenant"
  });
  await configureReadPolicy(tenant.tenantId);
  const autonomous = workloadMetadata(
    context.workload.callerToken,
    context.invocation.sign({
      tenantId: tenant.tenantId,
      tokenId: "capability-autonomous"
    }));
  const policyBaseline =
    (await context.policyd.readRequests()).length;
  assert.equal(
    (await getTenant(tenant.tenantId, autonomous)).tenantId,
    tenant.tenantId);
  assert.equal(
    (await context.policyd.readRequests()).length,
    policyBaseline);
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.workloadClient.updateTenant(
        {
          tenantId: tenant.tenantId,
          expectedRevision: tenant.revision,
          displayName: "Not Autonomous"
        },
        autonomous,
        done)),
    matchGrpcStatus(status.PERMISSION_DENIED));

  const readOnly = workloadMetadata(
    context.readOnlyCapabilityWorkload.callerToken,
    context.invocation.sign({
      tenantId: tenant.tenantId,
      tokenId: "capability-read-only"
    }));
  assert.equal(
    (await getTenant(tenant.tenantId, readOnly)).tenantId,
    tenant.tenantId);
  await assert.rejects(
    callUnary<Tenant>((done) =>
      context.workloadClient.updateTenant(
        {
          tenantId: tenant.tenantId,
          expectedRevision: tenant.revision,
          displayName: "Not Read Only"
        },
        readOnly,
        done)),
    matchGrpcStatus(status.PERMISSION_DENIED));

  const capability = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    tokenId: "capability-no-resolution"
  });
  await assert.rejects(
    callUnary<ResolveTenantResponse>((done) =>
      context.workloadClient.resolveTenant(
        { address: tenant.address },
        capability,
        done)),
    matchGrpcStatus(status.PERMISSION_DENIED));

  for (const request of [
    () => callUnary<Tenant>((done) =>
      context.workloadClient.createTenant(
        {
          tenantId: "capability_cannot_create_tenant",
          address: "capability-cannot-create-tenant",
          displayName: "Cannot Create"
        },
        capability,
        done)),
    () => callUnary<ListTenantsResponse>((done) =>
      context.workloadClient.listTenants(
        { pageSize: 10 },
        capability,
        done))
  ]) {
    await assert.rejects(
      request(),
      matchGrpcStatus(status.UNAUTHENTICATED));
  }
});

test("tenantd rejects overlapping admission paths at startup", async () => {
  const context = getTenantdTestContext();
  try {
    await assert.rejects(
      context.service.restart({
        CTLFLOW_UPDATE_TENANT_CAPABILITY_CALLERS:
          context.workload.callerSubject
      }));
  } finally {
    await context.service.restart(context.environment);
  }
});

test("capability denial, standing, and identity state fail closed", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_state_tenant",
    address: "capability-state-tenant",
    displayName: "Capability State Tenant"
  });
  const path = `/tenants/${tenant.tenantId}`;
  const metadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    tokenId: "capability-state"
  });

  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    grants: []
  });
  await assert.rejects(
    getTenant(tenant.tenantId, metadata),
    matchGrpcStatus(status.PERMISSION_DENIED));

  await context.policyIdentityd.setPrincipalFacts([]);
  await context.policyd.setGrants([
    grant("user:alice", "tenants.read", path)
  ]);
  await assert.rejects(
    getTenant(tenant.tenantId, metadata),
    matchGrpcStatus(status.NOT_FOUND));

  await configureCapabilityPolicy(context, {
    tenantId: tenant.tenantId,
    principalEnabled: false,
    subjectAccountEnabled: false,
    grants: [
      grant("user:alice", "tenants.read", path)
    ]
  });
  await assert.rejects(
    getTenant(tenant.tenantId, metadata),
    matchGrpcStatus(status.PERMISSION_DENIED));
});

test("policy and identity dependency failures preserve canonical statuses", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_dependency_tenant",
    address: "capability-dependency-tenant",
    displayName: "Capability Dependency Tenant"
  });
  await configureReadPolicy(tenant.tenantId);
  const metadata = createCapabilityMetadata(context, {
    tenantId: tenant.tenantId,
    tokenId: "capability-dependencies"
  });

  await context.policyd.setMode("unavailable");
  try {
    assert.equal(
      (await callUnary<Tenant>((done) =>
        context.client.getTenant(
          { tenantId: tenant.tenantId },
          done))).tenantId,
      tenant.tenantId);
    await assert.rejects(
      getTenant(tenant.tenantId, metadata),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.policyd.setMode("available");
  }

  await context.policyd.setMode("denied");
  try {
    await assert.rejects(
      getTenant(tenant.tenantId, metadata),
      matchGrpcStatus(status.PERMISSION_DENIED));
  } finally {
    await context.policyd.setMode("available");
  }

  await context.policyd.setMode("malformed");
  try {
    await assert.rejects(
      getTenant(tenant.tenantId, metadata),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.policyd.setMode("available");
  }

  await context.policyIdentityd.setMode("unavailable");
  try {
    await assert.rejects(
      getTenant(tenant.tenantId, metadata),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.policyIdentityd.setMode("available");
  }
  await context.reconnectPolicyIdentity();
  await context.service.restart(context.environment);

  await context.policyd.setMode("blocked");
  try {
    await assert.rejects(
      callUnary<Tenant>((done) =>
        context.workloadClient.getTenant(
          { tenantId: tenant.tenantId },
          metadata,
          { deadline: Date.now() + 50 },
          done)),
      matchGrpcStatus(status.DEADLINE_EXCEEDED));
  } finally {
    await context.policyd.setMode("available");
  }
});

test("policyd independently validates the invocation signature", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_independent_tenant",
    address: "capability-independent-tenant",
    displayName: "Capability Independent Tenant"
  });
  await configureReadPolicy(tenant.tenantId);
  await getTenant(
    tenant.tenantId,
    workloadMetadata(
      context.workload.callerToken,
      context.invocation.sign({
        tenantId: tenant.tenantId,
        tokenId: "capability-independent-cache"
      })));
  const otherAuthority = await createInvocationAuthority(
    "policy-other-key");
  await context.policyIdentityd.setVerificationKeys({
    keys: [otherAuthority.verificationKey],
    expiresAt:
      new Date(Date.now() + 4 * 60_000).toISOString()
  });
  try {
    await assert.rejects(
      getTenant(
        tenant.tenantId,
        createCapabilityMetadata(context, {
          tenantId: tenant.tenantId,
          tokenId: "capability-independent-validation"
        })),
      matchGrpcStatus(status.UNAUTHENTICATED));
  } finally {
    await context.policyIdentityd.setVerificationKeys({
      keys: [context.invocation.verificationKey],
      expiresAt:
        new Date(Date.now() + 4 * 60_000).toISOString()
    });
  }
});

test("capability fences reject hidden targets before policy", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_fence_tenant",
    address: "capability-fence-tenant",
    displayName: "Capability Fence Tenant"
  });
  const workspace = await createWorkspace(context, {
    workspaceId: "capability_fence_workspace",
    tenantId: tenant.tenantId,
    address: "capability-fence-workspace",
    displayName: "Capability Fence Workspace"
  });
  const sibling = await createWorkspace(context, {
    workspaceId: "capability_fence_sibling",
    tenantId: tenant.tenantId,
    address: "capability-fence-sibling",
    displayName: "Capability Fence Sibling"
  });
  await configureReadPolicy(tenant.tenantId);
  const baseline = (await context.policyd.readRequests()).length;

  await assert.rejects(
    getTenant(
      tenant.tenantId,
      createCapabilityMetadata(context, {
        tenantId: "another_tenant",
        tokenId: "capability-tenant-fence"
      })),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<import(
      "../generated/v1/tenantd.js"
    ).ListWorkspacesResponse>((done) =>
      context.workloadClient.listWorkspaces(
        {
          tenantId: tenant.tenantId,
          pageSize: 10
        },
        createCapabilityMetadata(context, {
          tenantId: tenant.tenantId,
          workspaceId: workspace.workspaceId,
          tokenId: "capability-collection-fence"
        }),
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  await assert.rejects(
    callUnary<Workspace>((done) =>
      context.workloadClient.getWorkspace(
        { workspaceId: workspace.workspaceId },
        createCapabilityMetadata(context, {
          tenantId: tenant.tenantId,
          workspaceId: sibling.workspaceId,
          tokenId: "capability-workspace-fence"
        }),
        done)),
    matchGrpcStatus(status.NOT_FOUND));
  assert.equal(
    (await context.policyd.readRequests()).length,
    baseline);
});

test("workspace-scoped invocation can read its parent Tenant", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "capability_parent_tenant",
    address: "capability-parent-tenant",
    displayName: "Capability Parent Tenant"
  });
  const workspace = await createWorkspace(context, {
    workspaceId: "capability_parent_workspace",
    tenantId: tenant.tenantId,
    address: "capability-parent-workspace",
    displayName: "Capability Parent Workspace"
  });
  await configureReadPolicy(tenant.tenantId);
  const loaded = await getTenant(
    tenant.tenantId,
    createCapabilityMetadata(context, {
      tenantId: tenant.tenantId,
      workspaceId: workspace.workspaceId,
      tokenId: "capability-parent-read"
    }));
  assert.equal(loaded.tenantId, tenant.tenantId);
});

async function configureReadPolicy(
  tenantId: string
): Promise<void> {
  const context = getTenantdTestContext();
  await configureCapabilityPolicy(context, {
    tenantId,
    grants: [
      grant(
        "user:alice",
        "tenants.read",
        `/tenants/${tenantId}`)
    ]
  });
}

function grant(
  subjectId: string,
  operation: string,
  resourcePath: string
): PolicyGrant {
  return {
    subjectId,
    operation,
    resourcePath,
    match: "exact"
  };
}

async function getTenant(
  tenantId: string,
  metadata: Metadata
): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.workloadClient.getTenant(
      { tenantId },
      metadata,
      done));
}
