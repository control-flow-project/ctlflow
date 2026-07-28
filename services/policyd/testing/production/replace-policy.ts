import type {
  Knex
} from "knex";
import type {
  PolicyState
} from "./policy-state.js";

export async function replacePolicy(
  database: Knex,
  state: PolicyState
): Promise<void> {
  await database.transaction(async (transaction) => {
    await transaction("access_grants").delete();
    await transaction("role_bindings").delete();
    await transaction("role_rules").delete();
    await transaction("roles").delete();

    await insertRows(
      transaction,
      "roles",
      state.roles.map((role) => ({
        role_id: role.roleId,
        ...targetColumns(role.target)
      })));
    await insertRows(
      transaction,
      "role_rules",
      state.roles.flatMap((role) =>
        role.rules.map((rule) => ({
          role_id: role.roleId,
          operation: rule.operation,
          base_path: rule.basePath,
          match_kind: matchKind(rule.match)
        }))));
    await insertRows(
      transaction,
      "role_bindings",
      state.roles.flatMap((role) =>
        role.subjects.map((subject) => ({
          role_id: role.roleId,
          subject_kind: subjectKind(subject.kind),
          subject_id: subject.id
        }))));
    await insertRows(
      transaction,
      "access_grants",
      state.grants.map((grant) => ({
        ...targetColumns(grant.target),
        subject_kind: subjectKind(grant.subject.kind),
        subject_id: grant.subject.id,
        operation: grant.operation,
        base_path: grant.basePath,
        match_kind: matchKind(grant.match)
      })));
  });
}

function targetColumns(target: {
  readonly tenantId: string;
  readonly workspaceId?: string;
}): Readonly<Record<string, unknown>> {
  return {
    target_kind: target.workspaceId === undefined ? 1 : 2,
    tenant_id: target.tenantId,
    workspace_id: target.workspaceId ?? null
  };
}

function subjectKind(kind: "principal" | "group"): number {
  return kind === "principal" ? 1 : 2;
}

function matchKind(kind: "exact" | "subtree"): number {
  return kind === "exact" ? 1 : 2;
}

async function insertRows(
  transaction: Knex.Transaction,
  table: string,
  rows: readonly Record<string, unknown>[]
): Promise<void> {
  const batchSize = 100;
  for (let offset = 0; offset < rows.length; offset += batchSize) {
    await transaction(table).insert(rows.slice(offset, offset + batchSize));
  }
}
