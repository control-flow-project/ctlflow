export type AuditAttributionEvidence =
  | {
      readonly kind: "operator";
      readonly operatorCommonName: string;
    }
  | {
      readonly kind: "workload";
      readonly workloadSubject: string;
    }
  | {
      readonly kind: "invocation";
      readonly actorPrincipalId: string;
      readonly attachedAccountPrincipalId: string;
      readonly workloadSubject: string;
    };

export type AuditPartitionEvidence =
  | { readonly kind: "global" }
  | {
      readonly kind: "tenant";
      readonly tenantId: string;
    };

export type PlacementAuditTargetEvidence =
  | { readonly kind: "global" }
  | {
      readonly kind: "tenant";
      readonly tenantId: string;
    }
  | {
      readonly kind: "workspace";
      readonly tenantId: string;
      readonly workspaceId: string;
    }
  | {
      readonly kind: "user";
      readonly tenantId: string;
      readonly accountPrincipalId: string;
    };

export interface ConsumerBindingAuditEvidence {
  readonly placementId: string;
  readonly placementTarget: PlacementAuditTargetEvidence;
  readonly consumerId: string;
  readonly purpose: string;
}

interface AuditEventEvidenceBase {
  readonly sourceEventId: string;
  readonly occurredAt: string;
  readonly attribution: AuditAttributionEvidence;
  readonly partition: AuditPartitionEvidence;
  readonly traceId: string;
  readonly spanId: string;
}

export interface TenantMutationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "tenant_mutation";
  readonly action:
    | "create_tenant"
    | "update_tenant"
    | "set_tenant_state";
  readonly resourceRevision: bigint;
  readonly resultingState: "active" | "suspended" | "deleted";
}

export interface WorkspaceMutationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "workspace_mutation";
  readonly workspaceId: string;
  readonly action:
    | "create_workspace"
    | "update_workspace"
    | "set_workspace_state";
  readonly resourceRevision: bigint;
  readonly resultingState: "active" | "suspended" | "deleted";
}

export type TenancyAuditEventEvidence =
  | TenantMutationAuditEventEvidence
  | WorkspaceMutationAuditEventEvidence;

export interface IdentitySessionAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_session";
  readonly sessionId: string;
  readonly humanAccountPrincipalId: string;
  readonly sessionRevision: bigint;
  readonly action: "created" | "revoked";
}

export interface IdentityMembershipAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_membership";
  readonly accountPrincipalId: string;
  readonly workspaceId?: string;
  readonly membershipRevision: bigint;
  readonly action: "added" | "removed";
  readonly accountCreated: boolean;
}

export interface IdentityGroupAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_group";
  readonly groupId: string;
  readonly workspaceId?: string;
  readonly action: "created" | "deleted";
}

export interface IdentityGroupMemberAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_group_member";
  readonly groupId: string;
  readonly principalId: string;
  readonly workspaceId?: string;
  readonly action: "added" | "removed";
}

export interface IdentityVirtualPrincipalAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_virtual_principal";
  readonly principalId: string;
  readonly attachedAccountPrincipalId: string;
  readonly workspaceId?: string;
  readonly principalRevision: bigint;
  readonly enabled: boolean;
  readonly action: "created" | "enabled_state_changed";
}

export interface IdentityExternalLinkAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_external_link";
  readonly externalLinkId: string;
  readonly providerId: string;
  readonly humanAccountPrincipalId: string;
  readonly action: "created" | "deleted";
}

export interface IdentityLoginProviderAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_login_provider";
  readonly providerId: string;
  readonly providerRevision: bigint;
  readonly resultingState: "active" | "disabled" | "deleted";
  readonly action: "created" | "updated" | "state_changed";
}

export interface IdentityWorkspaceProviderAdmissionAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "identity_workspace_provider_admission";
  readonly workspaceId: string;
  readonly providerId: string;
  readonly action: "admitted" | "removed";
}

export type IdentityAdministrationAuditEventEvidence =
  | IdentityMembershipAuditEventEvidence
  | IdentityGroupAuditEventEvidence
  | IdentityGroupMemberAuditEventEvidence
  | IdentityVirtualPrincipalAuditEventEvidence
  | IdentityExternalLinkAuditEventEvidence
  | IdentityLoginProviderAuditEventEvidence
  | IdentityWorkspaceProviderAdmissionAuditEventEvidence;

export interface PackageDeclarationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "package_declaration";
  readonly packageId: string;
  readonly generation: bigint;
}

export interface AppMutationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "app_mutation";
  readonly appId: string;
  readonly scope: PlacementAuditTargetEvidence;
  readonly placementId: string;
  readonly packageId: string;
  readonly packageGeneration: bigint;
  readonly appRevision: bigint;
  readonly action: "created" | "package_generation_changed";
}

export interface ConfigurationPublicationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "configuration_publication";
  readonly configurationId: string;
  readonly configurationVersionId: string;
  readonly binding: ConsumerBindingAuditEvidence;
  readonly identityRevision: bigint;
  readonly dependencyClaimId?: string;
  readonly dependencyClaimRevision?: bigint;
}

export interface SecretPublicationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "secret_publication";
  readonly secretId: string;
  readonly secretVersionId: string;
  readonly binding: ConsumerBindingAuditEvidence;
  readonly identityRevision: bigint;
  readonly dependencyClaimId?: string;
  readonly dependencyClaimRevision?: bigint;
}

export interface ProjectionMutationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "projection_mutation";
  readonly projectionId: string;
  readonly action: "created" | "version_changed";
  readonly projectionRevision: bigint;
  readonly target:
    | {
        readonly kind: "configuration";
        readonly configurationId: string;
        readonly configurationVersionId: string;
      }
    | {
        readonly kind: "secret";
        readonly secretId: string;
        readonly secretVersionId: string;
      };
  readonly binding: ConsumerBindingAuditEvidence;
}

export interface PlacementMutationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "placement_mutation";
  readonly placementId: string;
  readonly target: PlacementAuditTargetEvidence;
  readonly action: "declared" | "updated";
  readonly placementRevision: bigint;
  readonly resultingDesiredState: "active" | "suspended" | "retired";
}

export interface WorkloadMutationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "workload_mutation";
  readonly workloadId: string;
  readonly placementId: string;
  readonly placementTarget: PlacementAuditTargetEvidence;
  readonly action: "declared" | "updated";
  readonly workloadRevision: bigint;
  readonly resultingDesiredState: "active" | "suspended" | "retired";
  readonly appId: string;
  readonly appRevision: bigint;
  readonly packageId: string;
  readonly packageGeneration: bigint;
  readonly componentId: string;
}

export interface RunMutationAuditEventEvidence
extends AuditEventEvidenceBase {
  readonly detailKind: "run_mutation";
  readonly runId: string;
  readonly workloadId: string;
  readonly placementId: string;
  readonly placementTarget: PlacementAuditTargetEvidence;
  readonly action: "created" | "cancellation_requested";
  readonly runRevision: bigint;
  readonly configuredActorPrincipalId?: string;
}

export type AuditEventEvidence =
  | TenancyAuditEventEvidence
  | IdentitySessionAuditEventEvidence
  | IdentityAdministrationAuditEventEvidence
  | PackageDeclarationAuditEventEvidence
  | AppMutationAuditEventEvidence
  | ConfigurationPublicationAuditEventEvidence
  | SecretPublicationAuditEventEvidence
  | ProjectionMutationAuditEventEvidence
  | PlacementMutationAuditEventEvidence
  | WorkloadMutationAuditEventEvidence
  | RunMutationAuditEventEvidence;
