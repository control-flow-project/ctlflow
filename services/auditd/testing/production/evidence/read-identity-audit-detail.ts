import type {
  Knex
} from "knex";
import type {
  IdentityAdministrationAuditEventEvidence
} from "../audit-event-evidence.js";

type AuditEnvelopeKey =
  | "sourceEventId"
  | "occurredAt"
  | "attribution"
  | "partition"
  | "traceId"
  | "spanId";

type IdentityAuditDetailEvidence =
  IdentityAdministrationAuditEventEvidence extends infer Event
    ? Event extends IdentityAdministrationAuditEventEvidence
      ? Omit<Event, AuditEnvelopeKey>
      : never
    : never;

interface EventDetailRow {
  readonly event_key: string;
}

interface IdentityMembershipRow extends EventDetailRow {
  readonly account_principal_id: string;
  readonly workspace_id: string | null;
  readonly membership_revision: number;
  readonly action: number;
  readonly account_created: number;
}

interface IdentityGroupRow extends EventDetailRow {
  readonly group_id: string;
  readonly workspace_id: string | null;
  readonly action: number;
}

interface IdentityGroupMemberRow extends EventDetailRow {
  readonly group_id: string;
  readonly principal_id: string;
  readonly workspace_id: string | null;
  readonly action: number;
}

interface IdentityVirtualPrincipalRow extends EventDetailRow {
  readonly principal_id: string;
  readonly attached_account_principal_id: string;
  readonly workspace_id: string | null;
  readonly principal_revision: number;
  readonly enabled: number;
  readonly action: number;
}

interface IdentityExternalLinkRow extends EventDetailRow {
  readonly provider_id: string;
  readonly human_account_principal_id: string;
  readonly action: number;
}

interface IdentityLoginProviderRow extends EventDetailRow {
  readonly provider_id: string;
  readonly provider_revision: number;
  readonly resulting_state: number;
  readonly action: number;
}

interface IdentityWorkspaceProviderAdmissionRow extends EventDetailRow {
  readonly workspace_id: string;
  readonly provider_id: string;
  readonly action: number;
}

export async function readIdentityAuditDetail(
  database: Knex,
  eventKey: string,
  detailKind: number
): Promise<IdentityAuditDetailEvidence> {
  switch (detailKind) {
    case 12:
      return mapIdentityMembership(
        await readRow<IdentityMembershipRow>(
          database,
          "audit_identity_memberships",
          eventKey));
    case 13:
      return mapIdentityGroup(
        await readRow<IdentityGroupRow>(
          database,
          "audit_identity_groups",
          eventKey));
    case 14:
      return mapIdentityGroupMember(
        await readRow<IdentityGroupMemberRow>(
          database,
          "audit_identity_group_members",
          eventKey));
    case 15:
      return mapIdentityVirtualPrincipal(
        await readRow<IdentityVirtualPrincipalRow>(
          database,
          "audit_identity_virtual_principals",
          eventKey));
    case 16:
      return mapIdentityExternalLink(
        await readRow<IdentityExternalLinkRow>(
          database,
          "audit_identity_external_links",
          eventKey));
    case 17:
      return mapIdentityLoginProvider(
        await readRow<IdentityLoginProviderRow>(
          database,
          "audit_identity_login_providers",
          eventKey));
    case 18:
      return mapIdentityWorkspaceProviderAdmission(
        await readRow<IdentityWorkspaceProviderAdmissionRow>(
          database,
          "audit_identity_workspace_provider_admissions",
          eventKey));
    default:
      throw new Error("Stored Identity audit detail kind is invalid");
  }
}

async function readRow<Row extends EventDetailRow>(
  database: Knex,
  table: string,
  eventKey: string
): Promise<Row> {
  const rows = await database<Row>(table)
    .select("*")
    .where("event_key", eventKey)
    .limit(1);
  const row = rows[0] as Row | undefined;
  if (row === undefined) {
    throw new Error("Stored audit event has no Identity detail row");
  }
  return row;
}

function mapIdentityMembership(
  row: IdentityMembershipRow
): IdentityAuditDetailEvidence {
  return {
    detailKind: "identity_membership",
    accountPrincipalId: row.account_principal_id,
    ...mapWorkspaceId(row.workspace_id),
    membershipRevision: BigInt(row.membership_revision),
    action: mapAddedRemoved(row.action, "membership"),
    accountCreated: mapBoolean(row.account_created, "account-created")
  };
}

function mapIdentityGroup(
  row: IdentityGroupRow
): IdentityAuditDetailEvidence {
  return {
    detailKind: "identity_group",
    groupId: row.group_id,
    ...mapWorkspaceId(row.workspace_id),
    action: mapCreatedDeleted(row.action, "group")
  };
}

function mapIdentityGroupMember(
  row: IdentityGroupMemberRow
): IdentityAuditDetailEvidence {
  return {
    detailKind: "identity_group_member",
    groupId: row.group_id,
    principalId: row.principal_id,
    ...mapWorkspaceId(row.workspace_id),
    action: mapAddedRemoved(row.action, "group-member")
  };
}

function mapIdentityVirtualPrincipal(
  row: IdentityVirtualPrincipalRow
): IdentityAuditDetailEvidence {
  return {
    detailKind: "identity_virtual_principal",
    principalId: row.principal_id,
    attachedAccountPrincipalId: row.attached_account_principal_id,
    ...mapWorkspaceId(row.workspace_id),
    principalRevision: BigInt(row.principal_revision),
    enabled: mapBoolean(row.enabled, "virtual-principal enabled"),
    action: mapVirtualPrincipalAction(row.action)
  };
}

function mapIdentityExternalLink(
  row: IdentityExternalLinkRow
): IdentityAuditDetailEvidence {
  return {
    detailKind: "identity_external_link",
    providerId: row.provider_id,
    humanAccountPrincipalId: row.human_account_principal_id,
    action: mapCreatedDeleted(row.action, "external-link")
  };
}

function mapIdentityLoginProvider(
  row: IdentityLoginProviderRow
): IdentityAuditDetailEvidence {
  return {
    detailKind: "identity_login_provider",
    providerId: row.provider_id,
    providerRevision: BigInt(row.provider_revision),
    resultingState: mapLoginProviderState(row.resulting_state),
    action: mapLoginProviderAction(row.action)
  };
}

function mapIdentityWorkspaceProviderAdmission(
  row: IdentityWorkspaceProviderAdmissionRow
): IdentityAuditDetailEvidence {
  return {
    detailKind: "identity_workspace_provider_admission",
    workspaceId: row.workspace_id,
    providerId: row.provider_id,
    action: mapWorkspaceProviderAdmissionAction(row.action)
  };
}

function mapWorkspaceId(workspaceId: string | null): {
  readonly workspaceId?: string;
} {
  return workspaceId === null ? {} : { workspaceId };
}

function mapAddedRemoved(value: number, name: string) {
  switch (value) {
    case 1:
      return "added" as const;
    case 2:
      return "removed" as const;
    default:
      throw invalidStoredValue(`${name} action`);
  }
}

function mapCreatedDeleted(value: number, name: string) {
  switch (value) {
    case 1:
      return "created" as const;
    case 2:
      return "deleted" as const;
    default:
      throw invalidStoredValue(`${name} action`);
  }
}

function mapVirtualPrincipalAction(value: number) {
  switch (value) {
    case 1:
      return "created" as const;
    case 2:
      return "enabled_state_changed" as const;
    default:
      throw invalidStoredValue("virtual-principal action");
  }
}

function mapLoginProviderAction(value: number) {
  switch (value) {
    case 1:
      return "created" as const;
    case 2:
      return "updated" as const;
    case 3:
      return "state_changed" as const;
    default:
      throw invalidStoredValue("login-provider action");
  }
}

function mapLoginProviderState(value: number) {
  switch (value) {
    case 1:
      return "active" as const;
    case 2:
      return "disabled" as const;
    case 3:
      return "deleted" as const;
    default:
      throw invalidStoredValue("login-provider state");
  }
}

function mapWorkspaceProviderAdmissionAction(value: number) {
  switch (value) {
    case 1:
      return "admitted" as const;
    case 2:
      return "removed" as const;
    default:
      throw invalidStoredValue("workspace-provider admission action");
  }
}

function mapBoolean(value: number, name: string): boolean {
  switch (value) {
    case 0:
      return false;
    case 1:
      return true;
    default:
      throw invalidStoredValue(name);
  }
}

function invalidStoredValue(name: string): Error {
  return new Error(`Stored audit ${name} is invalid`);
}
