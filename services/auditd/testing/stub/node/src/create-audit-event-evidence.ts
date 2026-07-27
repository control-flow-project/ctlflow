import {
  AppMutationAction,
  ExecutionDesiredState,
  IdentitySessionAction,
  PlacementMutationAction,
  ProjectionMutationAction,
  RunMutationAction,
  TenancyResourceState,
  TenantMutationAction,
  WorkloadMutationAction,
  WorkspaceMutationAction,
  type AuditAttribution,
  type AuditEvent,
  type ConsumerBindingAuditDetail,
  type PlacementAuditTarget
} from "../generated/v1/auditd.js";
import type {
  AppMutationAuditEventEvidence,
  AuditAttributionEvidence,
  AuditEventEvidence,
  AuditPartitionEvidence,
  ConsumerBindingAuditEvidence,
  IdentitySessionAuditEventEvidence,
  PlacementMutationAuditEventEvidence,
  PlacementAuditTargetEvidence,
  ProjectionMutationAuditEventEvidence,
  RunMutationAuditEventEvidence,
  TenantMutationAuditEventEvidence,
  TenancyAuditEventEvidence,
  WorkspaceMutationAuditEventEvidence,
  WorkloadMutationAuditEventEvidence
} from "./audit-event-evidence.js";

export function createAuditEventEvidence(
  event: AuditEvent,
  receivedTraceparent: string | undefined
): AuditEventEvidence {
  if (!/^evt_[0-9a-f]{32}$/u.test(event.sourceEventId)
      || event.occurredAt === undefined
      || Number.isNaN(event.occurredAt.getTime())
      || event.attribution === undefined
      || event.partition === undefined
      || !/^(?!0{32}$)[0-9a-f]{32}$/u.test(event.traceId)
      || !/^(?!0{16}$)[0-9a-f]{16}$/u.test(event.spanId)) {
    throw new Error("invalid audit event");
  }

  const common = {
    sourceEventId: event.sourceEventId,
    occurredAt: event.occurredAt.toISOString(),
    attribution: createAttributionEvidence(event.attribution),
    partition: createPartitionEvidence(event.partition),
    traceId: event.traceId,
    spanId: event.spanId,
    ...(receivedTraceparent === undefined
      ? {}
      : { receivedTraceparent })
  } as const;
  const details = [
    event.tenantMutation,
    event.workspaceMutation,
    event.identitySession,
    event.packageDeclaration,
    event.appMutation,
    event.configurationPublication,
    event.secretPublication,
    event.projectionMutation,
    event.placementMutation,
    event.workloadMutation,
    event.runMutation
  ].filter((detail) => detail !== undefined);
  if (details.length !== 1) {
    throw new Error("exactly one audit detail is required");
  }

  if (event.tenantMutation !== undefined) {
    return {
      ...common,
      detailKind: "tenant_mutation",
      action: mapTenantAction(event.tenantMutation.action),
      resourceRevision:
        requirePositive(event.tenantMutation.resourceRevision),
      resultingState:
        mapTenancyState(event.tenantMutation.resultingState)
    };
  }
  if (event.workspaceMutation !== undefined) {
    return {
      ...common,
      detailKind: "workspace_mutation",
      workspaceId: requireText(event.workspaceMutation.workspaceId),
      action: mapWorkspaceAction(event.workspaceMutation.action),
      resourceRevision:
        requirePositive(event.workspaceMutation.resourceRevision),
      resultingState:
        mapTenancyState(event.workspaceMutation.resultingState)
    };
  }
  if (event.identitySession !== undefined) {
    return {
      ...common,
      detailKind: "identity_session",
      sessionId: requireText(event.identitySession.sessionId),
      humanAccountPrincipalId: requireText(
        event.identitySession.humanAccountPrincipalId),
      sessionRevision:
        requirePositive(event.identitySession.sessionRevision),
      action: mapSessionAction(event.identitySession.action)
    };
  }
  if (event.packageDeclaration !== undefined) {
    return {
      ...common,
      detailKind: "package_declaration",
      packageId: requireText(event.packageDeclaration.packageId),
      generation: requirePositive(event.packageDeclaration.generation)
    };
  }
  if (event.appMutation !== undefined) {
    return {
      ...common,
      detailKind: "app_mutation",
      appId: requireText(event.appMutation.appId),
      scope: createPlacementTargetEvidence(event.appMutation.scope),
      placementId: requireText(event.appMutation.placementId),
      packageId: requireText(event.appMutation.packageId),
      packageGeneration:
        requirePositive(event.appMutation.packageGeneration),
      appRevision: requirePositive(event.appMutation.appRevision),
      action: mapAppAction(event.appMutation.action)
    };
  }
  if (event.configurationPublication !== undefined) {
    const detail = event.configurationPublication;
    if (detail.target === undefined) {
      throw new Error("configuration target is required");
    }
    return {
      ...common,
      detailKind: "configuration_publication",
      configurationId: requireText(detail.target.configurationId),
      configurationVersionId: requireText(
        detail.target.configurationVersionId),
      binding: createConsumerBindingEvidence(detail.binding),
      identityRevision: requirePositive(detail.identityRevision),
      ...createDependencyClaimEvidence(
        detail.dependencyClaimId,
        detail.dependencyClaimRevision,
        common.attribution)
    };
  }
  if (event.secretPublication !== undefined) {
    const detail = event.secretPublication;
    if (detail.target === undefined) {
      throw new Error("secret target is required");
    }
    return {
      ...common,
      detailKind: "secret_publication",
      secretId: requireText(detail.target.secretId),
      secretVersionId: requireText(detail.target.secretVersionId),
      binding: createConsumerBindingEvidence(detail.binding),
      identityRevision: requirePositive(detail.identityRevision),
      ...createDependencyClaimEvidence(
        detail.dependencyClaimId,
        detail.dependencyClaimRevision,
        common.attribution)
    };
  }
  if (event.projectionMutation !== undefined) {
    const detail = event.projectionMutation;
    const targetCount = [
      detail.configuration,
      detail.secret
    ].filter((target) => target !== undefined).length;
    if (targetCount !== 1) {
      throw new Error("exactly one projection target is required");
    }
    const target = detail.configuration === undefined
      ? {
          kind: "secret" as const,
          secretId: requireText(detail.secret!.secretId),
          secretVersionId: requireText(detail.secret!.secretVersionId)
        }
      : {
          kind: "configuration" as const,
          configurationId: requireText(detail.configuration.configurationId),
          configurationVersionId: requireText(
            detail.configuration.configurationVersionId)
        };
    return {
      ...common,
      detailKind: "projection_mutation",
      projectionId: requireText(detail.projectionId),
      action: mapProjectionAction(detail.action),
      projectionRevision: requirePositive(detail.projectionRevision),
      target,
      binding: createConsumerBindingEvidence(detail.binding)
    };
  }
  if (event.placementMutation !== undefined) {
    const detail = event.placementMutation;
    return {
      ...common,
      detailKind: "placement_mutation",
      placementId: requireText(detail.placementId),
      target: createPlacementTargetEvidence(detail.target),
      action: mapPlacementAction(detail.action),
      placementRevision: requirePositive(detail.placementRevision),
      resultingDesiredState:
        mapExecutionState(detail.resultingDesiredState)
    };
  }
  if (event.workloadMutation !== undefined) {
    const detail = event.workloadMutation;
    return {
      ...common,
      detailKind: "workload_mutation",
      workloadId: requireText(detail.workloadId),
      placementId: requireText(detail.placementId),
      placementTarget:
        createPlacementTargetEvidence(detail.placementTarget),
      action: mapWorkloadAction(detail.action),
      workloadRevision: requirePositive(detail.workloadRevision),
      resultingDesiredState:
        mapExecutionState(detail.resultingDesiredState),
      appId: requireText(detail.appId),
      appRevision: requirePositive(detail.appRevision),
      packageId: requireText(detail.packageId),
      packageGeneration: requirePositive(detail.packageGeneration),
      componentId: requireText(detail.componentId)
    };
  }
  if (event.runMutation !== undefined) {
    const detail = event.runMutation;
    return {
      ...common,
      detailKind: "run_mutation",
      runId: requireText(detail.runId),
      workloadId: requireText(detail.workloadId),
      placementId: requireText(detail.placementId),
      placementTarget:
        createPlacementTargetEvidence(detail.placementTarget),
      action: mapRunAction(detail.action),
      runRevision: requirePositive(detail.runRevision),
      ...(detail.configuredActorPrincipalId === undefined
        ? {}
        : {
            configuredActorPrincipalId:
              requireText(detail.configuredActorPrincipalId)
          })
    };
  }
  throw new Error("audit detail is required");
}

function createAttributionEvidence(
  attribution: AuditAttribution
): AuditAttributionEvidence {
  const attributionCount = [
    attribution.operatorCommonName,
    attribution.workloadSubject,
    attribution.invocation
  ].filter((value) => value !== undefined).length;
  if (attributionCount !== 1) {
    throw new Error("exactly one audit attribution is required");
  }
  if (attribution.operatorCommonName !== undefined) {
    return {
      kind: "operator",
      operatorCommonName:
        requireOperatorCommonName(attribution.operatorCommonName)
    };
  }
  if (attribution.workloadSubject !== undefined) {
    return {
      kind: "workload",
      workloadSubject: requireText(attribution.workloadSubject)
    };
  }
  const invocation = attribution.invocation!;
  return {
    kind: "invocation",
    actorPrincipalId: requireText(invocation.actorPrincipalId),
    attachedAccountPrincipalId:
      requireText(invocation.attachedAccountPrincipalId),
    workloadSubject: requireText(invocation.workloadSubject)
  };
}

function createPartitionEvidence(
  partition: NonNullable<AuditEvent["partition"]>
): AuditPartitionEvidence {
  const partitionCount = [
    partition.global,
    partition.tenant
  ].filter((value) => value !== undefined).length;
  if (partitionCount !== 1) {
    throw new Error("exactly one audit partition is required");
  }
  if (partition.global !== undefined) {
    return { kind: "global" };
  }
  return {
    kind: "tenant",
    tenantId: requireText(partition.tenant!.tenantId)
  };
}

function createPlacementTargetEvidence(
  target: PlacementAuditTarget | undefined
): PlacementAuditTargetEvidence {
  if (target === undefined) {
    throw new Error("Placement target is required");
  }
  const targetCount = [
    target.global,
    target.tenant,
    target.workspace,
    target.user
  ].filter((value) => value !== undefined).length;
  if (targetCount !== 1) {
    throw new Error("exactly one Placement target is required");
  }
  if (target.global !== undefined) {
    return { kind: "global" };
  }
  if (target.tenant !== undefined) {
    return {
      kind: "tenant",
      tenantId: requireText(target.tenant.tenantId)
    };
  }
  if (target.workspace !== undefined) {
    return {
      kind: "workspace",
      tenantId: requireText(target.workspace.tenantId),
      workspaceId: requireText(target.workspace.workspaceId)
    };
  }
  return {
    kind: "user",
    tenantId: requireText(target.user!.tenantId),
    accountPrincipalId: requireText(target.user!.accountPrincipalId)
  };
}

function createConsumerBindingEvidence(
  binding: ConsumerBindingAuditDetail | undefined
): ConsumerBindingAuditEvidence {
  if (binding === undefined) {
    throw new Error("consumer binding is required");
  }
  return {
    placementId: requireText(binding.placementId),
    placementTarget:
      createPlacementTargetEvidence(binding.placementTarget),
    consumerId: requireText(binding.consumerId),
    purpose: requireText(binding.purpose)
  };
}

function createDependencyClaimEvidence(
  dependencyClaimId: string | undefined,
  dependencyClaimRevision: bigint | undefined,
  attribution: AuditAttributionEvidence
): {
  readonly dependencyClaimId?: string;
  readonly dependencyClaimRevision?: bigint;
} {
  const hasId = dependencyClaimId !== undefined;
  const hasRevision = dependencyClaimRevision !== undefined;
  const isProvisioner = attribution.kind === "workload";
  if (hasId !== hasRevision || hasId !== isProvisioner) {
    throw new Error(
      "dependency claim identity and attribution are inconsistent");
  }
  if (!hasId) {
    return {};
  }
  return {
    dependencyClaimId: requireText(dependencyClaimId),
    dependencyClaimRevision: requirePositive(dependencyClaimRevision!)
  };
}

function requireText(value: string): string {
  if (value.length === 0) {
    throw new Error("audit text is required");
  }
  return value;
}

function requireOperatorCommonName(value: string): string {
  if (value.length < 1
      || value.length > 253
      || /[\p{White_Space}\p{Cc}]/u.test(value)) {
    throw new Error("operator common name is invalid");
  }
  return value;
}

function requirePositive(value: bigint): bigint {
  if (value <= 0n || value > 9_223_372_036_854_775_807n) {
    throw new Error("audit integer is invalid");
  }
  return value;
}

function mapTenantAction(
  action: TenantMutationAction
): TenantMutationAuditEventEvidence["action"] {
  switch (action) {
    case TenantMutationAction.TENANT_MUTATION_ACTION_CREATE_TENANT:
      return "create_tenant";
    case TenantMutationAction.TENANT_MUTATION_ACTION_UPDATE_TENANT:
      return "update_tenant";
    case TenantMutationAction.TENANT_MUTATION_ACTION_SET_TENANT_STATE:
      return "set_tenant_state";
    default:
      throw new Error("Tenant mutation action is invalid");
  }
}

function mapWorkspaceAction(
  action: WorkspaceMutationAction
): WorkspaceMutationAuditEventEvidence["action"] {
  switch (action) {
    case WorkspaceMutationAction.WORKSPACE_MUTATION_ACTION_CREATE_WORKSPACE:
      return "create_workspace";
    case WorkspaceMutationAction.WORKSPACE_MUTATION_ACTION_UPDATE_WORKSPACE:
      return "update_workspace";
    case WorkspaceMutationAction
      .WORKSPACE_MUTATION_ACTION_SET_WORKSPACE_STATE:
      return "set_workspace_state";
    default:
      throw new Error("Workspace audit action is invalid");
  }
}

function mapTenancyState(
  state: TenancyResourceState
): TenancyAuditEventEvidence["resultingState"] {
  switch (state) {
    case TenancyResourceState.TENANCY_RESOURCE_STATE_ACTIVE:
      return "active";
    case TenancyResourceState.TENANCY_RESOURCE_STATE_SUSPENDED:
      return "suspended";
    case TenancyResourceState.TENANCY_RESOURCE_STATE_DELETED:
      return "deleted";
    default:
      throw new Error("tenancy state is invalid");
  }
}

function mapSessionAction(
  action: IdentitySessionAction
): IdentitySessionAuditEventEvidence["action"] {
  switch (action) {
    case IdentitySessionAction.IDENTITY_SESSION_ACTION_CREATED:
      return "created";
    case IdentitySessionAction.IDENTITY_SESSION_ACTION_REVOKED:
      return "revoked";
    default:
      throw new Error("identity Session action is invalid");
  }
}

function mapAppAction(
  action: AppMutationAction
): AppMutationAuditEventEvidence["action"] {
  switch (action) {
    case AppMutationAction.APP_MUTATION_ACTION_CREATED:
      return "created";
    case AppMutationAction.APP_MUTATION_ACTION_PACKAGE_GENERATION_CHANGED:
      return "package_generation_changed";
    default:
      throw new Error("App mutation action is invalid");
  }
}

function mapProjectionAction(
  action: ProjectionMutationAction
): ProjectionMutationAuditEventEvidence["action"] {
  switch (action) {
    case ProjectionMutationAction.PROJECTION_MUTATION_ACTION_CREATED:
      return "created";
    case ProjectionMutationAction
      .PROJECTION_MUTATION_ACTION_VERSION_CHANGED:
      return "version_changed";
    default:
      throw new Error("Projection mutation action is invalid");
  }
}

function mapPlacementAction(
  action: PlacementMutationAction
): PlacementMutationAuditEventEvidence["action"] {
  switch (action) {
    case PlacementMutationAction.PLACEMENT_MUTATION_ACTION_DECLARED:
      return "declared";
    case PlacementMutationAction.PLACEMENT_MUTATION_ACTION_UPDATED:
      return "updated";
    default:
      throw new Error("Placement mutation action is invalid");
  }
}

function mapWorkloadAction(
  action: WorkloadMutationAction
): WorkloadMutationAuditEventEvidence["action"] {
  switch (action) {
    case WorkloadMutationAction.WORKLOAD_MUTATION_ACTION_DECLARED:
      return "declared";
    case WorkloadMutationAction.WORKLOAD_MUTATION_ACTION_UPDATED:
      return "updated";
    default:
      throw new Error("Workload mutation action is invalid");
  }
}

function mapRunAction(
  action: RunMutationAction
): RunMutationAuditEventEvidence["action"] {
  switch (action) {
    case RunMutationAction.RUN_MUTATION_ACTION_CREATED:
      return "created";
    case RunMutationAction.RUN_MUTATION_ACTION_CANCELLATION_REQUESTED:
      return "cancellation_requested";
    default:
      throw new Error("Run mutation action is invalid");
  }
}

function mapExecutionState(
  state: ExecutionDesiredState
): PlacementMutationAuditEventEvidence["resultingDesiredState"] {
  switch (state) {
    case ExecutionDesiredState.EXECUTION_DESIRED_STATE_ACTIVE:
      return "active";
    case ExecutionDesiredState.EXECUTION_DESIRED_STATE_SUSPENDED:
      return "suspended";
    case ExecutionDesiredState.EXECUTION_DESIRED_STATE_RETIRED:
      return "retired";
    default:
      throw new Error("execution desired state is invalid");
  }
}
