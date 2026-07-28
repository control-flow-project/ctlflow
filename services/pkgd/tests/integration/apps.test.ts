import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
import type {
  AppScope,
  CreateAppRequest
} from "../generated/v1/pkgd.js";
import {
  getPkgdTestContext
} from "../suite/get-pkgd-test-context.js";
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

const appPackageId = "apps_package";

test("creates and gets Apps in every closed scope", async () => {
  const context = getPkgdTestContext();
  await ensureAppPackage();
  const cases: readonly [string, AppScope][] = [
    ["app_global", { global: {} }],
    ["app_tenant", { tenant: { tenantId: "tenant_a" } }],
    [
      "app_workspace",
      {
        workspace: {
          tenantId: "tenant_a",
          workspaceId: "workspace_a"
        }
      }
    ],
    [
      "app_user",
      {
        user: {
          tenantId: "tenant_a",
          accountPrincipalId: "user:alice"
        }
      }
    ]
  ];

  for (const [appId, scope] of cases) {
    const request = createAppRequest(appId, scope);
    const created = await createApp(
      context.client,
      request);
    assert.equal(created.appId, appId);
    assert.deepEqual(created.scope, {
      global: undefined,
      tenant: undefined,
      workspace: undefined,
      user: undefined,
      ...scope
    });
    assert.equal(created.placementId, request.placementId);
    assert.equal(created.packageId, appPackageId);
    assert.equal(created.desiredPackageGeneration, 1n);
    assert.equal(created.revision, 1n);
    assert.ok(created.createdAt instanceof Date);
    assert.deepEqual(created.updatedAt, created.createdAt);
    assert.deepEqual(
      await getApp(context.client, appId),
      created);
  }
});

test("retries identical App creation and rejects conflicting reuse",
  async () => {
    const context = getPkgdTestContext();
    await ensureAppPackage();
    const request = createAppRequest(
      "app_creation_retry",
      { tenant: { tenantId: "tenant_retry" } });
    const created = await createApp(context.client, request);

    assert.deepEqual(
      await createApp(context.client, request),
      created);

    const conflict = createAppRequest(
      request.appId,
      { tenant: { tenantId: "tenant_other" } });
    await assert.rejects(
      createApp(context.client, conflict),
      matchGrpcStatus(status.ALREADY_EXISTS));
  });

test("returns not found for absent Apps and Package generations",
  async () => {
    const context = getPkgdTestContext();
    await assert.rejects(
      getApp(context.client, "app_absent"),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      createApp(
        context.client,
        createAppRequest(
          "app_missing_package",
          { global: {} },
          "package_missing")),
      matchGrpcStatus(status.NOT_FOUND));
  });

test("validates App identity, scope, placement, Package, and generation",
  async () => {
    const context = getPkgdTestContext();
    await ensureAppPackage();
    const invalid: CreateAppRequest[] = [
      createAppRequest("", { global: {} }),
      createAppRequest("Invalid", { global: {} }),
      createAppRequest("app_missing_scope", undefined),
      createAppRequest(
        "app_invalid_tenant",
        { tenant: { tenantId: "Invalid" } }),
      createAppRequest(
        "app_invalid_workspace",
        {
          workspace: {
            tenantId: "tenant_a",
            workspaceId: "Invalid"
          }
        }),
      createAppRequest(
        "app_invalid_user",
        {
          user: {
            tenantId: "tenant_a",
            accountPrincipalId: "agent:alice"
          }
        }),
      {
        ...createAppRequest("app_invalid_placement", { global: {} }),
        placementId: "Invalid"
      },
      {
        ...createAppRequest("app_invalid_package", { global: {} }),
        packageId: "Invalid"
      },
      {
        ...createAppRequest("app_invalid_generation", { global: {} }),
        desiredPackageGeneration: 0n
      }
    ];

    for (const request of invalid) {
      await assert.rejects(
        createApp(context.client, request),
        matchGrpcStatus(status.INVALID_ARGUMENT));
    }
  });

test("handles App generation no-op, change, retry, and conflicts",
  async () => {
    const context = getPkgdTestContext();
    await ensureAppPackage();
    const app = await createApp(
      context.client,
      createAppRequest(
        "app_generation",
        { global: {} }));

    assert.deepEqual(
      await setAppPackageGeneration(
        context.client,
        app.appId,
        app.revision,
        1n),
      app);

    const changed = await setAppPackageGeneration(
      context.client,
      app.appId,
      app.revision,
      2n);
    assert.equal(changed.desiredPackageGeneration, 2n);
    assert.equal(changed.revision, 2n);
    assert.deepEqual(changed.createdAt, app.createdAt);
    assert.ok(changed.updatedAt!.getTime() >= app.updatedAt!.getTime());

    assert.deepEqual(
      await setAppPackageGeneration(
        context.client,
        app.appId,
        app.revision,
        2n),
      changed);

    await assert.rejects(
      setAppPackageGeneration(
        context.client,
        app.appId,
        app.revision,
        1n),
      matchGrpcStatus(status.ABORTED));
    await assert.rejects(
      setAppPackageGeneration(
        context.client,
        app.appId,
        changed.revision,
        3n),
      matchGrpcStatus(status.NOT_FOUND));
    await assert.rejects(
      setAppPackageGeneration(
        context.client,
        app.appId,
        0n,
        1n),
      matchGrpcStatus(status.INVALID_ARGUMENT));
    await assert.rejects(
      setAppPackageGeneration(
        context.client,
        "app_generation_absent",
        1n,
        1n),
      matchGrpcStatus(status.NOT_FOUND));
  });

test("returns the current App on creation retry after later updates",
  async () => {
    const context = getPkgdTestContext();
    await ensureAppPackage();
    const request = createAppRequest(
      "app_retry_after_update",
      { global: {} });
    const created = await createApp(context.client, request);
    const updated = await setAppPackageGeneration(
      context.client,
      created.appId,
      created.revision,
      2n);

    assert.deepEqual(
      await createApp(context.client, request),
      updated);
  });

test("does not advance an App already at maximum revision", async () => {
  const context = getPkgdTestContext();
  await ensureAppPackage();
  const app = await createApp(
    context.client,
    createAppRequest("app_max_revision", { global: {} }));
  await context.database.connection.raw(
    "UPDATE apps SET revision = 9223372036854775807 "
    + "WHERE app_id = ?",
    [app.appId]);

  await assert.rejects(
    setAppPackageGeneration(
      context.client,
      app.appId,
      9_223_372_036_854_775_807n,
      2n),
    matchGrpcStatus(status.FAILED_PRECONDITION));
});

function createAppRequest(
  appId: string,
  scope: AppScope | undefined,
  packageId = appPackageId
): CreateAppRequest {
  return {
    appId,
    scope,
    placementId: "placement_primary",
    packageId,
    desiredPackageGeneration: 1n
  };
}

async function ensureAppPackage(): Promise<void> {
  const context = getPkgdTestContext();
  await declarePackage(context, createPackageRequest({
    packageId: appPackageId
  }));
  await declarePackage(context, createPackageRequest({
    packageId: appPackageId,
    generation: 2n,
    version: "2.0.0"
  }));
}
