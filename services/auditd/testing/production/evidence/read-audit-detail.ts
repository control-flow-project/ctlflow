import type {
  Knex
} from "knex";
import type {
  AuditEventEvidence
} from "../audit-event-evidence.js";
import {
  mapConsumerBinding,
  type StoredConsumerBinding
} from "./map-consumer-binding.js";
import {
  mapPlacementTarget
} from "./map-placement-target.js";
import {
  readIdentityAuditDetail
} from "./read-identity-audit-detail.js";

type AuditEnvelopeKey =
  | "sourceEventId"
  | "occurredAt"
  | "attribution"
  | "partition"
  | "traceId"
  | "spanId";

type AuditDetailEvidence =
  AuditEventEvidence extends infer Event
    ? Event extends AuditEventEvidence
      ? Omit<Event, AuditEnvelopeKey>
      : never
    : never;

interface EventDetailRow {
  readonly event_key: string;
}

interface TenantMutationRow extends EventDetailRow {
  readonly action: number;
  readonly resource_revision: number;
  readonly resulting_state: number;
}

interface WorkspaceMutationRow extends TenantMutationRow {
  readonly workspace_id: string;
}

interface IdentitySessionRow extends EventDetailRow {
  readonly session_id: string;
  readonly human_account_principal_id: string;
  readonly session_revision: number;
  readonly action: number;
}

interface PackageDeclarationRow extends EventDetailRow {
  readonly package_id: string;
  readonly generation: number;
}

interface AppMutationRow extends EventDetailRow {
  readonly app_id: string;
  readonly scope_kind: number;
  readonly scope_tenant_id: string | null;
  readonly scope_workspace_id: string | null;
  readonly scope_account_principal_id: string | null;
  readonly placement_id: string;
  readonly package_id: string;
  readonly package_generation: number;
  readonly app_revision: number;
  readonly action: number;
}

interface PublicationRow
extends EventDetailRow, StoredConsumerBinding {
  readonly identity_revision: number;
  readonly dependency_claim_id: string | null;
  readonly dependency_claim_revision: number | null;
}

interface ConfigurationPublicationRow extends PublicationRow {
  readonly configuration_id: string;
  readonly configuration_version_id: string;
}

interface SecretPublicationRow extends PublicationRow {
  readonly secret_id: string;
  readonly secret_version_id: string;
}

interface ProjectionMutationRow
extends EventDetailRow, StoredConsumerBinding {
  readonly projection_id: string;
  readonly action: number;
  readonly projection_revision: number;
  readonly target_kind: number;
  readonly configuration_id: string | null;
  readonly configuration_version_id: string | null;
  readonly secret_id: string | null;
  readonly secret_version_id: string | null;
}

interface PlacementMutationRow extends EventDetailRow {
  readonly placement_id: string;
  readonly target_kind: number;
  readonly target_tenant_id: string | null;
  readonly target_workspace_id: string | null;
  readonly target_account_principal_id: string | null;
  readonly action: number;
  readonly placement_revision: number;
  readonly resulting_desired_state: number;
}

interface WorkloadMutationRow extends EventDetailRow {
  readonly workload_id: string;
  readonly placement_id: string;
  readonly placement_target_kind: number;
  readonly placement_target_tenant_id: string | null;
  readonly placement_target_workspace_id: string | null;
  readonly placement_target_account_principal_id: string | null;
  readonly action: number;
  readonly workload_revision: number;
  readonly resulting_desired_state: number;
  readonly app_id: string;
  readonly app_revision: number;
  readonly package_id: string;
  readonly package_generation: number;
  readonly component_id: string;
}

interface RunMutationRow extends EventDetailRow {
  readonly run_id: string;
  readonly workload_id: string;
  readonly placement_id: string;
  readonly placement_target_kind: number;
  readonly placement_target_tenant_id: string | null;
  readonly placement_target_workspace_id: string | null;
  readonly placement_target_account_principal_id: string | null;
  readonly action: number;
  readonly run_revision: number;
  readonly configured_actor_principal_id: string | null;
}

export async function readAuditDetail(
  database: Knex,
  eventKey: string,
  detailKind: number
): Promise<AuditDetailEvidence> {
  switch (detailKind) {
    case 1:
      return mapTenantMutation(
        await readRow<TenantMutationRow>(
          database,
          "audit_tenant_mutations",
          eventKey));
    case 2:
      return mapWorkspaceMutation(
        await readRow<WorkspaceMutationRow>(
          database,
          "audit_workspace_mutations",
          eventKey));
    case 3:
      return mapIdentitySession(
        await readRow<IdentitySessionRow>(
          database,
          "audit_identity_sessions",
          eventKey));
    case 4:
      return mapPackageDeclaration(
        await readRow<PackageDeclarationRow>(
          database,
          "audit_package_declarations",
          eventKey));
    case 5:
      return mapAppMutation(
        await readRow<AppMutationRow>(
          database,
          "audit_app_mutations",
          eventKey));
    case 6:
      return mapConfigurationPublication(
        await readRow<ConfigurationPublicationRow>(
          database,
          "audit_configuration_publications",
          eventKey));
    case 7:
      return mapSecretPublication(
        await readRow<SecretPublicationRow>(
          database,
          "audit_secret_publications",
          eventKey));
    case 8:
      return mapProjectionMutation(
        await readRow<ProjectionMutationRow>(
          database,
          "audit_projection_mutations",
          eventKey));
    case 9:
      return mapPlacementMutation(
        await readRow<PlacementMutationRow>(
          database,
          "audit_placement_mutations",
          eventKey));
    case 10:
      return mapWorkloadMutation(
        await readRow<WorkloadMutationRow>(
          database,
          "audit_workload_mutations",
          eventKey));
    case 11:
      return mapRunMutation(
        await readRow<RunMutationRow>(
          database,
          "audit_run_mutations",
          eventKey));
    case 12:
    case 13:
    case 14:
    case 15:
    case 16:
    case 17:
    case 18:
      return await readIdentityAuditDetail(
        database,
        eventKey,
        detailKind);
    default:
      throw new Error("Stored audit detail kind is invalid");
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
    throw new Error("Stored audit event has no detail row");
  }
  return row;
}

function mapTenantMutation(
  row: TenantMutationRow
): AuditDetailEvidence {
  return {
    detailKind: "tenant_mutation",
    action: mapTenantAction(row.action),
    resourceRevision: BigInt(row.resource_revision),
    resultingState: mapTenancyState(row.resulting_state)
  };
}

function mapWorkspaceMutation(
  row: WorkspaceMutationRow
): AuditDetailEvidence {
  return {
    detailKind: "workspace_mutation",
    workspaceId: row.workspace_id,
    action: mapWorkspaceAction(row.action),
    resourceRevision: BigInt(row.resource_revision),
    resultingState: mapTenancyState(row.resulting_state)
  };
}

function mapIdentitySession(
  row: IdentitySessionRow
): AuditDetailEvidence {
  return {
    detailKind: "identity_session",
    sessionId: row.session_id,
    humanAccountPrincipalId: row.human_account_principal_id,
    sessionRevision: BigInt(row.session_revision),
    action: mapIdentitySessionAction(row.action)
  };
}

function mapPackageDeclaration(
  row: PackageDeclarationRow
): AuditDetailEvidence {
  return {
    detailKind: "package_declaration",
    packageId: row.package_id,
    generation: BigInt(row.generation)
  };
}

function mapAppMutation(row: AppMutationRow): AuditDetailEvidence {
  return {
    detailKind: "app_mutation",
    appId: row.app_id,
    scope: mapPlacementTarget(
      row.scope_kind,
      row.scope_tenant_id,
      row.scope_workspace_id,
      row.scope_account_principal_id),
    placementId: row.placement_id,
    packageId: row.package_id,
    packageGeneration: BigInt(row.package_generation),
    appRevision: BigInt(row.app_revision),
    action: mapAppMutationAction(row.action)
  };
}

function mapConfigurationPublication(
  row: ConfigurationPublicationRow
): AuditDetailEvidence {
  return {
    detailKind: "configuration_publication",
    configurationId: row.configuration_id,
    configurationVersionId: row.configuration_version_id,
    binding: mapConsumerBinding(row),
    identityRevision: BigInt(row.identity_revision),
    ...mapDependencyClaim(row)
  };
}

function mapSecretPublication(
  row: SecretPublicationRow
): AuditDetailEvidence {
  return {
    detailKind: "secret_publication",
    secretId: row.secret_id,
    secretVersionId: row.secret_version_id,
    binding: mapConsumerBinding(row),
    identityRevision: BigInt(row.identity_revision),
    ...mapDependencyClaim(row)
  };
}

function mapDependencyClaim(row: PublicationRow): {
  readonly dependencyClaimId?: string;
  readonly dependencyClaimRevision?: bigint;
} {
  return row.dependency_claim_id === null
    || row.dependency_claim_revision === null
    ? {}
    : {
        dependencyClaimId: row.dependency_claim_id,
        dependencyClaimRevision:
          BigInt(row.dependency_claim_revision)
      };
}

function mapProjectionMutation(
  row: ProjectionMutationRow
): AuditDetailEvidence {
  const target = mapProjectionTarget(row);
  return {
    detailKind: "projection_mutation",
    projectionId: row.projection_id,
    action: mapProjectionMutationAction(row.action),
    projectionRevision: BigInt(row.projection_revision),
    target,
    binding: mapConsumerBinding(row)
  };
}

function mapPlacementMutation(
  row: PlacementMutationRow
): AuditDetailEvidence {
  return {
    detailKind: "placement_mutation",
    placementId: row.placement_id,
    target: mapPlacementTarget(
      row.target_kind,
      row.target_tenant_id,
      row.target_workspace_id,
      row.target_account_principal_id),
    action: mapMutationAction(row.action),
    placementRevision: BigInt(row.placement_revision),
    resultingDesiredState: mapDesiredState(
      row.resulting_desired_state)
  };
}

function mapWorkloadMutation(
  row: WorkloadMutationRow
): AuditDetailEvidence {
  return {
    detailKind: "workload_mutation",
    workloadId: row.workload_id,
    placementId: row.placement_id,
    placementTarget: mapPlacementTarget(
      row.placement_target_kind,
      row.placement_target_tenant_id,
      row.placement_target_workspace_id,
      row.placement_target_account_principal_id),
    action: mapMutationAction(row.action),
    workloadRevision: BigInt(row.workload_revision),
    resultingDesiredState: mapDesiredState(
      row.resulting_desired_state),
    appId: row.app_id,
    appRevision: BigInt(row.app_revision),
    packageId: row.package_id,
    packageGeneration: BigInt(row.package_generation),
    componentId: row.component_id
  };
}

function mapRunMutation(row: RunMutationRow): AuditDetailEvidence {
  return {
    detailKind: "run_mutation",
    runId: row.run_id,
    workloadId: row.workload_id,
    placementId: row.placement_id,
    placementTarget: mapPlacementTarget(
      row.placement_target_kind,
      row.placement_target_tenant_id,
      row.placement_target_workspace_id,
      row.placement_target_account_principal_id),
    action: mapRunMutationAction(row.action),
    runRevision: BigInt(row.run_revision),
    ...(row.configured_actor_principal_id === null
      ? {}
      : {
          configuredActorPrincipalId:
            row.configured_actor_principal_id
        })
  };
}

function mapTenantAction(value: number) {
  switch (value) {
    case 1:
      return "create_tenant" as const;
    case 2:
      return "update_tenant" as const;
    case 3:
      return "set_tenant_state" as const;
    default:
      throw invalidStoredValue("tenant action");
  }
}

function mapWorkspaceAction(value: number) {
  switch (value) {
    case 1:
      return "create_workspace" as const;
    case 2:
      return "update_workspace" as const;
    case 3:
      return "set_workspace_state" as const;
    default:
      throw invalidStoredValue("workspace action");
  }
}

function mapTenancyState(value: number) {
  switch (value) {
    case 1:
      return "active" as const;
    case 2:
      return "suspended" as const;
    case 3:
      return "deleted" as const;
    default:
      throw invalidStoredValue("tenancy state");
  }
}

function mapMutationAction(value: number) {
  switch (value) {
    case 1:
      return "declared" as const;
    case 2:
      return "updated" as const;
    default:
      throw invalidStoredValue("mutation action");
  }
}

function mapDesiredState(value: number) {
  switch (value) {
    case 1:
      return "active" as const;
    case 2:
      return "suspended" as const;
    case 3:
      return "retired" as const;
    default:
      throw invalidStoredValue("desired state");
  }
}

function mapIdentitySessionAction(value: number) {
  switch (value) {
    case 1:
      return "created" as const;
    case 2:
      return "revoked" as const;
    default:
      throw invalidStoredValue("identity Session action");
  }
}

function mapAppMutationAction(value: number) {
  switch (value) {
    case 1:
      return "created" as const;
    case 2:
      return "package_generation_changed" as const;
    default:
      throw invalidStoredValue("App mutation action");
  }
}

function mapProjectionMutationAction(value: number) {
  switch (value) {
    case 1:
      return "created" as const;
    case 2:
      return "version_changed" as const;
    default:
      throw invalidStoredValue("Projection mutation action");
  }
}

function mapRunMutationAction(value: number) {
  switch (value) {
    case 1:
      return "created" as const;
    case 2:
      return "cancellation_requested" as const;
    default:
      throw invalidStoredValue("Run mutation action");
  }
}

function mapProjectionTarget(row: ProjectionMutationRow) {
  switch (row.target_kind) {
    case 1:
      return {
        kind: "configuration" as const,
        configurationId: requireValue(row.configuration_id),
        configurationVersionId: requireValue(
          row.configuration_version_id)
      };
    case 2:
      return {
        kind: "secret" as const,
        secretId: requireValue(row.secret_id),
        secretVersionId: requireValue(row.secret_version_id)
      };
    default:
      throw invalidStoredValue("Projection target kind");
  }
}

function invalidStoredValue(name: string): Error {
  return new Error(`Stored audit ${name} is invalid`);
}

function requireValue(value: string | null): string {
  if (value === null) {
    throw new Error("Stored audit detail is incomplete");
  }
  return value;
}
