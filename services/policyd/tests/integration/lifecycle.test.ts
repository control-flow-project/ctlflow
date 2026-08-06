import assert from "node:assert/strict";
import {
  test
} from "node:test";
import {
  status
} from "@grpc/grpc-js";
import {
  AccessDecision
} from "../generated/v1/policyd.js";
import {
  getPolicydTestContext
} from "../suite/get-policyd-test-context.js";
import {
  callCheckAccess
} from "../support/call-check-access.js";
import {
  directGrant
} from "../support/direct-grant.js";
import {
  matchGrpcStatus
} from "../support/match-grpc-status.js";
import {
  principalFact
} from "../support/principal-fact.js";
import {
  readProbeStatus
} from "../support/read-probe-status.js";
import {
  waitForProbeStatus
} from "../support/wait-for-probe-status.js";

const request = {
  operation: "tenants.read",
  resourcePath: "/tenants/acme",
  tenantId: "acme"
};

test("serves finite-purpose health and readiness endpoints", async () => {
  const context = getPolicydTestContext();
  assert.equal(
    await readProbeStatus(context.policyd.process.probePort, "/healthz"),
    204);
  assert.equal(
    await readProbeStatus(context.policyd.process.probePort, "/readyz"),
    204);
  assert.equal(
    await readProbeStatus(context.policyd.process.probePort, "/other"),
    404);
});

test("preserves provisioned policy across restart", async () => {
  const context = await arrangeAllow();
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
  await context.policyd.process.restart();
  assert.equal(
    (await callCheckAccess(request)).decision,
    AccessDecision.ACCESS_DECISION_ALLOW);
});

test("fails readiness and calls when mapped policy storage is absent",
  async () => {
    const context = await arrangeAllow();
    await context.policyd.database.schema.renameTable(
      "access_grants",
      "access_grants_missing");
    try {
      await waitForProbeStatus(context.policyd.process.probePort, 503);
      await assert.rejects(
        callCheckAccess(request),
        matchGrpcStatus(status.UNAVAILABLE));
    } finally {
      await context.policyd.database.schema.renameTable(
        "access_grants_missing",
        "access_grants");
      await waitForProbeStatus(context.policyd.process.probePort, 204);
    }
  });

test("fails readiness for migration-ledger drift", async () => {
  const context = getPolicydTestContext();
  const original = await context.policyd.database("knex_migrations")
    .select("id", "name");
  await context.policyd.database("knex_migrations")
    .update({ name: "9999_unapproved.js" });
  try {
    await waitForProbeStatus(context.policyd.process.probePort, 503);
  } finally {
    for (const row of original) {
      await context.policyd.database("knex_migrations")
        .where({ id: row.id })
        .update({ name: row.name });
    }
    await waitForProbeStatus(context.policyd.process.probePort, 204);
  }
});

test("schema enforces exact policy representations and uniqueness", async () => {
  const context = getPolicydTestContext();
  await context.reset();
  const valid = {
    target_kind: 1,
    tenant_id: "acme",
    workspace_id: null,
    subject_kind: 1,
    subject_id: "user:alice",
    operation_owner_kind: 1,
    operation_owner_id: "svc_tenantd",
    operation: "tenants.read",
    base_path: "/tenants/acme",
    match_kind: 1
  };
  await context.policyd.database("access_grants").insert(valid);
  await assert.rejects(
    context.policyd.database("access_grants").insert(valid));
  for (const invalid of [
    { ...valid, operation: "tenants.*" },
    { ...valid, base_path: "/tenants//acme" },
    { ...valid, subject_id: "user:Alice" },
    { ...valid, operation_owner_kind: 3 },
    { ...valid, operation_owner_id: "" },
    { ...valid, operation_owner_id: "Svc_Tenantd" },
    {
      ...valid,
      target_kind: 2,
      workspace_id: null
    }
  ]) {
    await assert.rejects(
      context.policyd.database("access_grants").insert(invalid));
  }

  // The tagged identity participates in uniqueness: the same token under a
  // different owner is a distinct grant.
  await context.policyd.database("access_grants").insert({
    ...valid,
    operation_owner_kind: 2,
    operation_owner_id: "package.chat"
  });
});

test("owns no mutation journal, audit state, or decision cache tables",
  async () => {
    const context = getPolicydTestContext();
    const rows: readonly { readonly name: string }[] =
      await context.policyd.database("sqlite_schema")
      .select("name")
      .where({ type: "table" })
      .whereRaw("name NOT LIKE ?", ["sqlite_%"])
      .orderBy("name");
    assert.deepEqual(
      rows.map((row) => row.name),
      [
        "access_grants",
        "knex_migrations",
        "knex_migrations_lock",
        "role_bindings",
        "role_rules",
        "roles"
      ]);
});

async function arrangeAllow() {
  const context = getPolicydTestContext();
  await context.reset();
  await context.policyd.setPrincipalFacts([principalFact()]);
  await context.policyd.replacePolicy({
    roles: [],
    grants: [directGrant("svc_tenantd", "tenants.read", "/tenants/acme")]
  });
  return context;
}
