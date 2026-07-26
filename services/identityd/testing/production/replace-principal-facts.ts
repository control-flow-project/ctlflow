import type {
  Knex
} from "knex";
import type {
  PrincipalAuthorizationFacts
} from "./principal-authorization-facts.js";

export async function replacePrincipalFacts(
  database: Knex,
  facts: readonly PrincipalAuthorizationFacts[]
): Promise<void> {
  const records = collectRecords(facts);
  await database.transaction(async (transaction) => {
    await clearFacts(transaction);
    await insertRecords(transaction, records);
  });
}

interface IdentityRecords {
  readonly accounts: ReadonlyMap<string, Record<string, unknown>>;
  readonly virtualPrincipals: ReadonlyMap<string, Record<string, unknown>>;
  readonly tenantMemberships: ReadonlyMap<string, Record<string, unknown>>;
  readonly workspaceMemberships: ReadonlyMap<string, Record<string, unknown>>;
  readonly groups: ReadonlyMap<string, Record<string, unknown>>;
  readonly accountGroups: ReadonlyMap<string, Record<string, unknown>>;
  readonly virtualGroups: ReadonlyMap<string, Record<string, unknown>>;
}

function collectRecords(
  facts: readonly PrincipalAuthorizationFacts[]
): IdentityRecords {
  const accounts = new Map<string, Record<string, unknown>>();
  const virtualPrincipals = new Map<string, Record<string, unknown>>();
  const tenantMemberships = new Map<string, Record<string, unknown>>();
  const workspaceMemberships = new Map<string, Record<string, unknown>>();
  const groups = new Map<string, Record<string, unknown>>();
  const accountGroups = new Map<string, Record<string, unknown>>();
  const virtualGroups = new Map<string, Record<string, unknown>>();

  for (const fact of facts) {
    accounts.set(
      fact.subjectAccountId,
      accountRecord(
        fact.subjectAccountId,
        accountKind(fact.subjectAccountId),
        fact.subjectAccountEnabled,
        fact.subjectAccountRevision));
    if (fact.principalKind === "virtual") {
      virtualPrincipals.set(fact.principalId, {
        principal_id: fact.principalId,
        subject_account_id: fact.subjectAccountId,
        enabled: fact.principalEnabled ? 1 : 0,
        revision: fact.principalRevision,
        tenant_fence_id: fact.tenantId,
        workspace_fence_id: fact.workspaceId ?? null
      });
    } else {
      accounts.set(
        fact.principalId,
        accountRecord(
          fact.principalId,
          fact.principalKind === "human" ? 1 : 2,
          fact.principalEnabled,
          fact.principalRevision));
    }

    tenantMemberships.set(
      `${fact.subjectAccountId}\u0000${fact.tenantId}`,
      {
        account_id: fact.subjectAccountId,
        tenant_id: fact.tenantId,
        revision: fact.membershipRevision
      });
    if (fact.workspaceId !== undefined) {
      workspaceMemberships.set(
        [
          fact.subjectAccountId,
          fact.tenantId,
          fact.workspaceId
        ].join("\u0000"),
        {
          account_id: fact.subjectAccountId,
          tenant_id: fact.tenantId,
          workspace_id: fact.workspaceId,
          revision: fact.membershipRevision
        });
    }

    for (const groupId of fact.groupIds) {
      groups.set(groupId, {
        group_id: groupId,
        tenant_id: fact.tenantId,
        workspace_id: fact.workspaceId ?? null
      });
      if (fact.principalKind === "virtual") {
        virtualGroups.set(
          `${fact.principalId}\u0000${groupId}`,
          {
            principal_id: fact.principalId,
            group_id: groupId
          });
      } else {
        accountGroups.set(
          `${fact.principalId}\u0000${groupId}`,
          {
            account_id: fact.principalId,
            group_id: groupId
          });
      }
    }
  }

  return {
    accounts,
    virtualPrincipals,
    tenantMemberships,
    workspaceMemberships,
    groups,
    accountGroups,
    virtualGroups
  };
}

function accountRecord(
  accountId: string,
  kind: number,
  enabled: boolean,
  revision: number
): Record<string, unknown> {
  return {
    account_id: accountId,
    kind,
    enabled: enabled ? 1 : 0,
    revision
  };
}

function accountKind(accountId: string): number {
  return accountId.startsWith("user:") ? 1 : 2;
}

async function clearFacts(transaction: Knex.Transaction): Promise<void> {
  for (const table of [
    "virtual_principal_group_memberships",
    "account_group_memberships",
    "groups",
    "workspace_memberships",
    "tenant_memberships",
    "virtual_principals",
    "accounts"
  ]) {
    await transaction(table).delete();
  }
}

async function insertRecords(
  transaction: Knex.Transaction,
  records: IdentityRecords
): Promise<void> {
  await insertValues(transaction, "accounts", records.accounts);
  await insertValues(
    transaction,
    "virtual_principals",
    records.virtualPrincipals);
  await insertValues(
    transaction,
    "tenant_memberships",
    records.tenantMemberships);
  await insertValues(
    transaction,
    "workspace_memberships",
    records.workspaceMemberships);
  await insertValues(transaction, "groups", records.groups);
  await insertValues(
    transaction,
    "account_group_memberships",
    records.accountGroups);
  await insertValues(
    transaction,
    "virtual_principal_group_memberships",
    records.virtualGroups);
}

async function insertValues(
  transaction: Knex.Transaction,
  table: string,
  records: ReadonlyMap<string, Record<string, unknown>>
): Promise<void> {
  if (records.size > 0) {
    await transaction(table).insert([...records.values()]);
  }
}
