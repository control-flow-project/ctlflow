import assert from "node:assert/strict";
import { test } from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
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
import {
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";

test("readiness and RPCs fail closed when a mapped table is missing", async () => {
  const context = getTenantdTestContext();
  const tenant = await createTenant(context, {
    tenantId: "schema_tenant",
    address: "schema-tenant",
    displayName: "Schema Tenant"
  });

  await context.database.connection.schema.renameTable(
    "tenants",
    "tenants_incompatible");
  try {
    await waitForProbeStatus(context.probePort, 503);
    await assert.rejects(
      getTenant(tenant.tenantId),
      matchGrpcStatus(status.UNAVAILABLE));
  } finally {
    await context.database.connection.schema.renameTable(
      "tenants_incompatible",
      "tenants");
  }
  await waitForProbeStatus(context.probePort, 204);
  assert.equal((await getTenant(tenant.tenantId)).tenantId, tenant.tenantId);
});

test("readiness rejects an ahead or locked migration ledger", async () => {
  const context = getTenantdTestContext();
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

test("SQLite contains only migration metadata and tenantd domain tables", async () => {
  const context = getTenantdTestContext();
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
      "knex_migrations",
      "knex_migrations_lock",
      "sqlite_sequence",
      "tenants",
      "workspaces"
    ]);
  assert.deepEqual(
    objects.filter((object) => object.type === "view"),
    []);
  assert.deepEqual(
    objects.filter((object) => object.type === "trigger"),
    []);
});

test("persists Tenant state across a production-process restart", async () => {
  const context = getTenantdTestContext();
  const created = await createTenant(context, {
    tenantId: "restart_tenant",
    address: "restart-tenant",
    displayName: "Restart Tenant"
  });

  await context.service.restart();
  const loaded = await callUnary<Tenant>((done) =>
    context.client.getTenant(
      { tenantId: created.tenantId },
      done));
  assert.deepEqual(loaded, created);
});

async function getTenant(tenantId: string): Promise<Tenant> {
  const context = getTenantdTestContext();
  return await callUnary<Tenant>((done) =>
    context.client.getTenant(
      { tenantId },
      done));
}
