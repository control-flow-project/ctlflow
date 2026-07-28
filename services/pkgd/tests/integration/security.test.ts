import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import type {
  AppScope,
  Package
} from "../generated/v1/pkgd.js";
import {
  getPkgdTestContext
} from "../suite/get-pkgd-test-context.js";
import {
  configureCapabilityPolicy
} from "../support/authorization/configure-capability-policy.js";
import type {
  CapabilityGrant
} from "../support/authorization/capability-grant.js";
import {
  createCapabilityMetadata
} from "../support/authorization/create-capability-metadata.js";
import {
  createApp
} from "../support/apps/create-app.js";
import {
  getApp
} from "../support/apps/get-app.js";
import {
  setAppPackageGeneration
} from "../support/apps/set-app-package-generation.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  createPackageRequest
} from "../support/packages/create-package-request.js";
import {
  declarePackage
} from "../support/packages/declare-package.js";
import {
  getPackage
} from "../support/packages/get-package.js";
import {
  workloadMetadata
} from "../support/workload-metadata.js";
import {
  callUnary
} from "../support/call-unary.js";

const packageId = "security_package";
let setup: Promise<void> | undefined;

test("admits the exact operator and autonomous Execd surfaces", async () => {
  const context = getPkgdTestContext();
  await ensureSecurityState();
  const metadata = workloadMetadata(context.workload.callerToken);

  assert.equal(
    (await getPackage(
      context.workloadClient,
      packageId,
      1n,
      metadata)).packageId,
    packageId);
  assert.equal(
    (await getApp(
      context.workloadClient,
      "security_global",
      metadata)).appId,
    "security_global");

  await assert.rejects(
    callUnary<Package>((done) =>
      context.workloadClient.declarePackage(
        createPackageRequest({
          packageId: "security_operator_only"
        }),
        metadata,
        done)),
    matchGrpcStatus(status.UNAUTHENTICATED));

  await assert.rejects(
    createApp(
      context.workloadClient,
      createAppRequest(
        "security_autonomous_create",
        { tenant: { tenantId: "security_tenant" } }),
      metadata),
    matchGrpcStatus(status.PERMISSION_DENIED));
  await assert.rejects(
    setAppPackageGeneration(
      context.workloadClient,
      "security_global",
      1n,
      2n,
      metadata),
    matchGrpcStatus(status.PERMISSION_DENIED));

  const autonomousWithInvocation = workloadMetadata(
    context.workload.callerToken,
    context.invocation.sign({
      tenantId: "security_tenant"
    }));
  await assert.rejects(
    getPackage(
      context.workloadClient,
      packageId,
      1n,
      autonomousWithInvocation),
    matchGrpcStatus(status.UNAUTHENTICATED));
});

test("operator authentication rejects missing, mixed, and unadmitted identity",
  async () => {
    const context = getPkgdTestContext();
    await ensureSecurityState();

    await assert.rejects(
      getPackage(
        context.workloadClient,
        packageId,
        1n),
      matchGrpcStatus(status.UNAUTHENTICATED));
    await assert.rejects(
      getPackage(
        context.unadmittedOperatorClient,
        packageId,
        1n),
      matchGrpcStatus(status.PERMISSION_DENIED));

    const bearer = workloadMetadata(context.workload.callerToken);
    await assert.rejects(
      getPackage(
        context.client,
        packageId,
        1n,
        bearer),
      matchGrpcStatus(status.UNAUTHENTICATED));
  });

test("capability callers use exact Tenant, Workspace, and User paths",
  async () => {
    const context = getPkgdTestContext();
    await ensureSecurityState();

    const tenantId = "capability_tenant";
    const tenantCollection = `/tenants/${tenantId}/apps`;
    await configureCapabilityPolicy(context, {
      tenantId,
      grants: [
        grant("apps.create", tenantCollection)
      ]
    });
    const tenantMetadata = createCapabilityMetadata(context, {
      tenantId,
      tokenId: "pkgd-tenant-create"
    });
    const tenantApp = await createApp(
      context.workloadClient,
      createAppRequest(
        "capability_tenant_app",
        { tenant: { tenantId } }),
      tenantMetadata);
    const tenantPath = `${tenantCollection}/${tenantApp.appId}`;
    await configureCapabilityPolicy(context, {
      tenantId,
      grants: [
        grant("apps.read", tenantPath),
        grant("apps.set_package_generation", tenantPath)
      ]
    });
    assert.deepEqual(
      await getApp(
        context.workloadClient,
        tenantApp.appId,
        tenantMetadata),
      tenantApp);
    const tenantUpdated = await setAppPackageGeneration(
      context.workloadClient,
      tenantApp.appId,
      tenantApp.revision,
      2n,
      tenantMetadata);
    assert.equal(tenantUpdated.revision, 2n);

    const workspaceId = "capability_workspace";
    const workspaceCollection =
      `/tenants/${tenantId}/workspaces/${workspaceId}/apps`;
    await configureCapabilityPolicy(context, {
      tenantId,
      workspaceId,
      grants: [
        grant("apps.create", workspaceCollection)
      ]
    });
    const workspaceMetadata = createCapabilityMetadata(context, {
      tenantId,
      workspaceId,
      tokenId: "pkgd-workspace-create"
    });
    const workspaceApp = await createApp(
      context.workloadClient,
      createAppRequest(
        "capability_workspace_app",
        {
          workspace: {
            tenantId,
            workspaceId
          }
        }),
      workspaceMetadata);
    assert.equal(workspaceApp.appId, "capability_workspace_app");

    const userId = "user:alice";
    const userCollection =
      `/tenants/${tenantId}/accounts/${userId}/apps`;
    await configureCapabilityPolicy(context, {
      tenantId,
      grants: [
        grant("apps.create", userCollection)
      ]
    });
    const userMetadata = createCapabilityMetadata(context, {
      tenantId,
      subject: userId,
      tokenId: "pkgd-user-create"
    });
    const userApp = await createApp(
      context.workloadClient,
      createAppRequest(
        "capability_user_app",
        {
          user: {
            tenantId,
            accountPrincipalId: userId
          }
        }),
      userMetadata);
    assert.equal(userApp.appId, "capability_user_app");
  });

test("capability scope fences conceal cross-scope targets", async () => {
  const context = getPkgdTestContext();
  await ensureSecurityState();
  await configureCapabilityPolicy(context, {
    tenantId: "security_tenant",
    grants: [
      grant("apps.read", "/tenants/security_tenant/apps/security_tenant")
    ]
  });

  const workspaceInvocation = createCapabilityMetadata(context, {
    tenantId: "security_tenant",
    workspaceId: "security_workspace",
    tokenId: "pkgd-parent-fence"
  });
  await assert.rejects(
    getApp(
      context.workloadClient,
      "security_tenant",
      workspaceInvocation),
    matchGrpcStatus(status.NOT_FOUND));

  const wrongWorkspace = createCapabilityMetadata(context, {
    tenantId: "security_tenant",
    workspaceId: "workspace_other",
    tokenId: "pkgd-workspace-fence"
  });
  await assert.rejects(
    getApp(
      context.workloadClient,
      "security_workspace",
      wrongWorkspace),
    matchGrpcStatus(status.NOT_FOUND));

  const wrongTenant = createCapabilityMetadata(context, {
    tenantId: "tenant_other",
    tokenId: "pkgd-tenant-fence"
  });
  await assert.rejects(
    getApp(
      context.workloadClient,
      "security_tenant",
      wrongTenant),
    matchGrpcStatus(status.NOT_FOUND));

  const wrongAccount = createCapabilityMetadata(context, {
    tenantId: "security_tenant",
    subject: "user:bob",
    tokenId: "pkgd-account-fence"
  });
  await assert.rejects(
    getApp(
      context.workloadClient,
      "security_user",
      wrongAccount),
    matchGrpcStatus(status.NOT_FOUND));
});

test("capability paths deny Global Apps and require Policyd allow",
  async () => {
    const context = getPkgdTestContext();
    await ensureSecurityState();
    const metadata = createCapabilityMetadata(context, {
      tenantId: "security_tenant",
      tokenId: "pkgd-policy-deny"
    });

    await configureCapabilityPolicy(context, {
      tenantId: "security_tenant",
      grants: []
    });
    await assert.rejects(
      getApp(
        context.workloadClient,
        "security_tenant",
        metadata),
      matchGrpcStatus(status.PERMISSION_DENIED));
    await assert.rejects(
      getApp(
        context.workloadClient,
        "security_global",
        metadata),
      matchGrpcStatus(status.PERMISSION_DENIED));

    await configureCapabilityPolicy(context, {
      tenantId: "security_tenant",
      principalEnabled: false,
      grants: [
        grant(
          "apps.read",
          "/tenants/security_tenant/apps/security_tenant")
      ]
    });
    await assert.rejects(
      getApp(
        context.workloadClient,
        "security_tenant",
        metadata),
      matchGrpcStatus(status.PERMISSION_DENIED));
  });

test("capability paths fail closed when Policyd is unavailable", async () => {
  const context = getPkgdTestContext();
  await ensureSecurityState();
  const path = "/tenants/security_tenant/apps/security_tenant";
  await configureCapabilityPolicy(context, {
    tenantId: "security_tenant",
    grants: [grant("apps.read", path)]
  });
  const metadata = createCapabilityMetadata(context, {
    tenantId: "security_tenant",
    tokenId: "pkgd-policy-unavailable"
  });

  await context.policyd.setAvailable(false);
  try {
    await assert.rejects(
      getApp(
        context.workloadClient,
        "security_tenant",
        metadata),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.policyd.setAvailable(true);
    await context.service.restart(context.environment);
  }
});

test("configured read-only workloads cannot invoke mutations", async () => {
  const context = getPkgdTestContext();
  await ensureSecurityState();
  const path = "/tenants/security_tenant/apps/security_tenant";
  await configureCapabilityPolicy(context, {
    tenantId: "security_tenant",
    grants: [grant("apps.read", path)]
  });
  const metadata = workloadMetadata(
    context.readOnlyCapabilityWorkload.callerToken,
    context.invocation.sign({
      tenantId: "security_tenant",
      tokenId: "pkgd-read-only"
    }));
  assert.equal(
    (await getApp(
      context.workloadClient,
      "security_tenant",
      metadata)).appId,
    "security_tenant");
  await assert.rejects(
    createApp(
      context.workloadClient,
      createAppRequest(
        "security_read_only_create",
        { tenant: { tenantId: "security_tenant" } }),
      metadata),
    matchGrpcStatus(status.PERMISSION_DENIED));
});

async function ensureSecurityState(): Promise<void> {
  setup ??= createSecurityState();
  await setup;
}

async function createSecurityState(): Promise<void> {
  const context = getPkgdTestContext();
  await declarePackage(context, createPackageRequest({ packageId }));
  await declarePackage(context, createPackageRequest({
    packageId,
    generation: 2n,
    version: "2.0.0"
  }));
  const scopes: readonly [string, AppScope][] = [
    ["security_global", { global: {} }],
    [
      "security_tenant",
      { tenant: { tenantId: "security_tenant" } }
    ],
    [
      "security_workspace",
      {
        workspace: {
          tenantId: "security_tenant",
          workspaceId: "security_workspace"
        }
      }
    ],
    [
      "security_user",
      {
        user: {
          tenantId: "security_tenant",
          accountPrincipalId: "user:alice"
        }
      }
    ]
  ];
  for (const [appId, scope] of scopes) {
    await createApp(
      context.client,
      createAppRequest(appId, scope));
  }
}

function createAppRequest(
  appId: string,
  scope: AppScope
): {
  readonly appId: string;
  readonly scope: AppScope;
  readonly placementId: string;
  readonly packageId: string;
  readonly desiredPackageGeneration: bigint;
} {
  return {
    appId,
    scope,
    placementId: "placement_security",
    packageId,
    desiredPackageGeneration: 1n
  };
}

function grant(
  operation: string,
  basePath: string
): CapabilityGrant {
  return {
    subject: {
      kind: "principal",
      id: "user:alice"
    },
    operation,
    basePath,
    match: "exact"
  };
}
