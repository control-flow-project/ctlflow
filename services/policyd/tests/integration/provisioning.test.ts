import assert from "node:assert/strict";
import { test } from "node:test";
import { execFile } from "node:child_process";
import {
  mkdir,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { DatabaseSync } from "node:sqlite";
import {
  serviceRoot
} from "../support/test-paths.js";

const run = promisify(execFile);
const migrationEntry = path.join(
  serviceRoot,
  ".generated/migrations/tooling/migrations/run.js");
const scratch = path.join(serviceRoot, ".temp", "provisioning-test");

// The production provisioning path is the migration-container entrypoint:
// migrate, validate the seed, and replace stored policy in one transaction.
// These tests run that exact compiled entry as a separate process against a
// fresh database, the way the migration Job runs it in a deployment.
test("provisions tagged kernel and package policy through the seed path",
  async () => {
    const database = await provision({
      roles: [{
        roleId: "role_operators",
        target: { tenantId: "tenant-a" },
        rules: [{
          owner: { kind: "kernel", id: "svc_tenantd" },
          operation: "tenants.read",
          basePath: "/tenants/tenant-a",
          match: "exact"
        }]
      }],
      roleBindings: [{
        roleId: "role_operators",
        subject: { kind: "principal", id: "user:alice" }
      }],
      accessGrants: [
        {
          owner: { kind: "kernel", id: "svc_pkgd" },
          operation: "apps.read",
          basePath: "/tenants/tenant-a/workspaces/main/apps/chat",
          match: "exact",
          target: { tenantId: "tenant-a", workspaceId: "main" },
          subject: { kind: "principal", id: "user:alice" }
        },
        {
          owner: { kind: "package", id: "package.chat" },
          operation: "messages.post",
          basePath:
            "/tenants/tenant-a/workspaces/main/apps/chat/topics",
          match: "subtree",
          target: { tenantId: "tenant-a", workspaceId: "main" },
          subject: { kind: "principal", id: "user:alice" }
        }
      ]
    });
    try {
      const rules = database.prepare(
        `SELECT role_id, operation_owner_kind, operation_owner_id,
                operation
           FROM role_rules
           ORDER BY operation`).all()
        .map((row) => ({ ...row }));
      assert.deepEqual(rules, [{
        role_id: "role_operators",
        operation_owner_kind: 1,
        operation_owner_id: "svc_tenantd",
        operation: "tenants.read"
      }]);
      const grants = database.prepare(
        `SELECT operation_owner_kind, operation_owner_id, operation
           FROM access_grants
           ORDER BY operation`).all()
        .map((row) => ({ ...row }));
      assert.deepEqual(grants, [
        {
          operation_owner_kind: 1,
          operation_owner_id: "svc_pkgd",
          operation: "apps.read"
        },
        {
          operation_owner_kind: 2,
          operation_owner_id: "package.chat",
          operation: "messages.post"
        }
      ]);
    } finally {
      database.close();
    }
  });

test("rejects a seed whose operation owner is not canonical", async () => {
  const invalidOwners: readonly {
    readonly owner: unknown;
    readonly failure: RegExp;
  }[] = [
    {
      owner: { kind: "kernel", id: "svc_unknown" },
      failure: /kernel policy rule must name a catalog operation/u
    },
    {
      owner: { kind: "kernel", id: "" },
      failure: /owner ID is not canonical/u
    },
    {
      owner: { kind: "package", id: "Package.Chat" },
      failure: /owner ID is not canonical/u
    },
    {
      owner: { kind: "product", id: "package.chat" },
      failure: /owner kind must be kernel or package/u
    }
  ];
  for (const { owner, failure } of invalidOwners) {
    await assert.rejects(
      provision({
        roles: [],
        roleBindings: [],
        accessGrants: [{
          owner,
          operation: "messages.post",
          basePath: "/tenants/tenant-a/apps/chat",
          match: "exact",
          target: { tenantId: "tenant-a" },
          subject: { kind: "principal", id: "user:alice" }
        }]
      }),
      failure,
      JSON.stringify(owner));
  }
});

test("rejects a kernel-owned seed rule for a foreign operation", async () => {
  // The kernel catalog binds each operation to its one owning service; the
  // seed may not re-home it.
  await assert.rejects(
    provision({
      roles: [],
      roleBindings: [],
      accessGrants: [{
        owner: { kind: "kernel", id: "svc_tenantd" },
        operation: "apps.read",
        basePath: "/tenants/tenant-a/workspaces/main/apps/chat",
        match: "exact",
        target: { tenantId: "tenant-a", workspaceId: "main" },
        subject: { kind: "principal", id: "user:alice" }
      }]
    }),
    /kernel policy rule must name a catalog operation and its owner/u);
});

async function provision(seed: unknown): Promise<DatabaseSync> {
  await rm(scratch, { recursive: true, force: true });
  await mkdir(scratch, { recursive: true });
  const seedPath = path.join(scratch, "policy-seed.json");
  const databasePath = path.join(scratch, "policy.sqlite");
  await writeFile(seedPath, JSON.stringify(seed), { mode: 0o600 });
  await run(
    process.execPath,
    [migrationEntry],
    {
      env: {
        ...process.env,
        CTLFLOW_DATABASE_PATH: databasePath,
        CTLFLOW_POLICY_SEED_PATH: seedPath
      }
    });
  return new DatabaseSync(databasePath, { readOnly: true });
}
