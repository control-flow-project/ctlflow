import type {
  Knex
} from "knex";
import {
  readPolicySeed
} from "./read-policy-seed.js";
import type {
  PolicySeed
} from "./policy-seed.js";

export async function provisionPolicy(database: Knex): Promise<void> {
  const seed = await readPolicySeed();
  await database.transaction(async (transaction) => {
    await transaction("access_grants").delete();
    await transaction("role_bindings").delete();
    await transaction("role_rules").delete();
    await transaction("roles").delete();
    await insertPolicy(transaction, seed);
  });
}

async function insertPolicy(
  transaction: Knex.Transaction,
  seed: PolicySeed
): Promise<void> {
  await insertBatches(
    transaction,
    "roles",
    seed.roles.map((role) => ({
      role_id: role.roleId,
      target_kind: role.target.workspaceId === undefined ? 1 : 2,
      tenant_id: role.target.tenantId,
      workspace_id: role.target.workspaceId ?? null
    })));
  await insertBatches(
    transaction,
    "role_rules",
    seed.roles.flatMap((role) => role.rules.map((rule) => ({
      role_id: role.roleId,
      operation: rule.operation,
      base_path: rule.basePath,
      match_kind: rule.match === "exact" ? 1 : 2
    }))));
  await insertBatches(
    transaction,
    "role_bindings",
    seed.roleBindings.map((binding) => ({
      role_id: binding.roleId,
      subject_kind: binding.subject.kind === "principal" ? 1 : 2,
      subject_id: binding.subject.id
    })));
  await insertBatches(
    transaction,
    "access_grants",
    seed.accessGrants.map((grant) => ({
      target_kind: grant.target.workspaceId === undefined ? 1 : 2,
      tenant_id: grant.target.tenantId,
      workspace_id: grant.target.workspaceId ?? null,
      subject_kind: grant.subject.kind === "principal" ? 1 : 2,
      subject_id: grant.subject.id,
      operation: grant.operation,
      base_path: grant.basePath,
      match_kind: grant.match === "exact" ? 1 : 2
    })));
}

async function insertBatches(
  transaction: Knex.Transaction,
  table: string,
  rows: readonly Record<string, unknown>[]
): Promise<void> {
  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await transaction(table).insert(rows.slice(offset, offset + batchSize));
  }
}
