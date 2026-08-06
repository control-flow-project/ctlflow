import assert from "node:assert/strict";
import { test } from "node:test";
import { status } from "@grpc/grpc-js";
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
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";

test("readiness and RPCs fail closed when a mapped table is missing",
  async () => {
    const context = getPkgdTestContext();
    const packageId = "schema_package";
    await declarePackage(context, createPackageRequest({ packageId }));
    const app = await createApp(context.client, {
      appId: "schema_app",
      scope: { global: {} },
      placementId: "schema_placement",
      packageId,
      desiredPackageGeneration: 1n
    });

    await context.database.connection.schema.renameTable(
      "apps",
      "apps_incompatible");
    try {
      await waitForProbeStatus(context.probePort, 503);
      await assert.rejects(
        getApp(context.client, app.appId),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.database.connection.schema.renameTable(
        "apps_incompatible",
        "apps");
    }
    await waitForProbeStatus(context.probePort, 204);
    assert.equal(
      (await getApp(context.client, app.appId)).appId,
      app.appId);
  });

test("readiness rejects an ahead or locked migration ledger", async () => {
  const context = getPkgdTestContext();
  await context.database.connection("knex_migrations").insert({
    name: "9999_unexpected.js",
    batch: 2,
    migration_time: new Date().toISOString()
  });
  try {
    await waitForProbeStatus(context.probePort, 503);
  } finally {
    await context.database.connection("knex_migrations")
      .where({ name: "9999_unexpected.js" })
      .delete();
  }
  await waitForProbeStatus(context.probePort, 204);

  await context.database.connection("knex_migrations_lock")
    .update({ is_locked: 1 });
  try {
    await waitForProbeStatus(context.probePort, 503);
  } finally {
    await context.database.connection("knex_migrations_lock")
      .update({ is_locked: 0 });
  }
  await waitForProbeStatus(context.probePort, 204);
});

test("SQLite contains only migration metadata and Pkgd domain tables",
  async () => {
    const context = getPkgdTestContext();
    const objects = await context.database.connection("sqlite_master")
      .select("type", "name")
      .whereIn("type", ["table", "view", "trigger"])
      .orderBy(["type", "name"]) as Array<{
        readonly type: string;
        readonly name: string;
      }>;

    assert.deepEqual(
      objects.filter((object) => object.type === "table")
        .map((object) => object.name),
      [
        "apps",
        "knex_migrations",
        "knex_migrations_lock",
        "package_component_operations",
        "package_components",
        "package_dependencies",
        "package_dependency_options",
        "package_exposures",
        "package_generations",
        "package_interfaces",
        "sqlite_sequence"
      ]);
    assert.deepEqual(
      objects.filter((object) => object.type === "view"),
      []);
    assert.deepEqual(
      objects.filter((object) => object.type === "trigger"),
      []);
  });

test("persists Package and App state across a production restart",
  async () => {
    const context = getPkgdTestContext();
    const packageId = "restart_package";
    const declared = await declarePackage(
      context,
      createPackageRequest({ packageId }));
    const app = await createApp(context.client, {
      appId: "restart_app",
      scope: {
        user: {
          tenantId: "restart_tenant",
          accountPrincipalId: "service:restart"
        }
      },
      placementId: "restart_placement",
      packageId,
      desiredPackageGeneration: 1n
    });

    await context.service.restart();
    assert.deepEqual(
      await getPackage(context.client, packageId, 1n),
      declared);
    assert.deepEqual(
      await getApp(context.client, app.appId),
      app);
  });
