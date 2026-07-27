import type {
  TestWorkloadCredentials
} from "@ctlflow/test-mesh";
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
  type AuditEvent,
  type PlacementAuditTarget
} from "../../generated/v1/auditd.js";
import type {
  AuditdTestContext
} from "../create-auditd-test-context.js";
import {
  createAuditEvent
} from "./create-audit-event.js";
import {
  globalPartition
} from "./global-partition.js";
import {
  globalTarget
} from "./global-target.js";
import {
  invocationAttribution
} from "./invocation-attribution.js";
import {
  operatorAttribution
} from "./operator-attribution.js";
import {
  tenantPartition
} from "./tenant-partition.js";
import {
  tenantTarget
} from "./tenant-target.js";
import {
  userTarget
} from "./user-target.js";
import {
  workloadAttribution
} from "./workload-attribution.js";
import {
  workspaceTarget
} from "./workspace-target.js";

export interface AdmittedAuditBatch {
  readonly name: string;
  readonly sourcePrincipal: string;
  readonly sourceSubject: string;
  readonly workload: TestWorkloadCredentials;
  readonly events: readonly AuditEvent[];
}

export function createAdmittedAuditBatches(
  context: AuditdTestContext
): readonly AdmittedAuditBatch[] {
  return [
    {
      name: "tenantd",
      sourcePrincipal: "SERVICE/svc_tenantd",
      sourceSubject: context.workloads.tenantd.callerSubject,
      workload: context.workloads.tenantd,
      events: tenantEvents(context.workloads.tenantd.callerSubject)
    },
    {
      name: "identityd",
      sourcePrincipal: "SERVICE/svc_identityd",
      sourceSubject: context.workloads.identityd.callerSubject,
      workload: context.workloads.identityd,
      events: identityEvents(context.workloads.identityd.callerSubject)
    },
    {
      name: "pkgd",
      sourcePrincipal: "SERVICE/svc_pkgd",
      sourceSubject: context.workloads.pkgd.callerSubject,
      workload: context.workloads.pkgd,
      events: packageEvents(context.workloads.pkgd.callerSubject)
    },
    {
      name: "configd",
      sourcePrincipal: "SERVICE/svc_configd",
      sourceSubject: context.workloads.configd.callerSubject,
      workload: context.workloads.configd,
      events: configurationEvents(context.workloads.configd.callerSubject)
    },
    {
      name: "execd",
      sourcePrincipal: "SERVICE/svc_execd",
      sourceSubject: context.workloads.execd.callerSubject,
      workload: context.workloads.execd,
      events: executionEvents(context.workloads.execd.callerSubject)
    }
  ];
}

function tenantEvents(subject: string): readonly AuditEvent[] {
  return [
    createAuditEvent({
      tenantMutation: {
        action: TenantMutationAction
          .TENANT_MUTATION_ACTION_CREATE_TENANT,
        resourceRevision: 1n,
        resultingState: TenancyResourceState
          .TENANCY_RESOURCE_STATE_ACTIVE
      }
    }, {
      partition: tenantPartition("matrix_tenant_create")
    }),
    createAuditEvent({
      tenantMutation: {
        action: TenantMutationAction
          .TENANT_MUTATION_ACTION_UPDATE_TENANT,
        resourceRevision: 2n,
        resultingState: TenancyResourceState
          .TENANCY_RESOURCE_STATE_ACTIVE
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_tenant_update")
    }),
    createAuditEvent({
      tenantMutation: {
        action: TenantMutationAction
          .TENANT_MUTATION_ACTION_SET_TENANT_STATE,
        resourceRevision: 3n,
        resultingState: TenancyResourceState
          .TENANCY_RESOURCE_STATE_SUSPENDED
      }
    }, {
      partition: tenantPartition("matrix_tenant_state")
    }),
    createAuditEvent({
      workspaceMutation: {
        workspaceId: "matrix_workspace_create",
        action: WorkspaceMutationAction
          .WORKSPACE_MUTATION_ACTION_CREATE_WORKSPACE,
        resourceRevision: 1n,
        resultingState: TenancyResourceState
          .TENANCY_RESOURCE_STATE_ACTIVE
      }
    }, {
      partition: tenantPartition("matrix_workspace_parent_a")
    }),
    createAuditEvent({
      workspaceMutation: {
        workspaceId: "matrix_workspace_update",
        action: WorkspaceMutationAction
          .WORKSPACE_MUTATION_ACTION_UPDATE_WORKSPACE,
        resourceRevision: 2n,
        resultingState: TenancyResourceState
          .TENANCY_RESOURCE_STATE_ACTIVE
      }
    }, {
      attribution: invocationAttribution(subject),
      partition: tenantPartition("matrix_workspace_parent_b")
    }),
    createAuditEvent({
      workspaceMutation: {
        workspaceId: "matrix_workspace_state",
        action: WorkspaceMutationAction
          .WORKSPACE_MUTATION_ACTION_SET_WORKSPACE_STATE,
        resourceRevision: 3n,
        resultingState: TenancyResourceState
          .TENANCY_RESOURCE_STATE_DELETED
      }
    }, {
      partition: tenantPartition("matrix_workspace_parent_c")
    })
  ];
}

function identityEvents(subject: string): readonly AuditEvent[] {
  return [
    createAuditEvent({
      identitySession: {
        sessionId: "a".repeat(32),
        humanAccountPrincipalId: "user:matrix_a",
        sessionRevision: 1n,
        action: IdentitySessionAction.IDENTITY_SESSION_ACTION_CREATED
      }
    }, {
      attribution: workloadAttribution(subject),
      partition: tenantPartition("matrix_identity_a")
    }),
    createAuditEvent({
      identitySession: {
        sessionId: "b".repeat(32),
        humanAccountPrincipalId: "user:matrix_b",
        sessionRevision: 2n,
        action: IdentitySessionAction.IDENTITY_SESSION_ACTION_REVOKED
      }
    }, {
      attribution: workloadAttribution(subject),
      partition: tenantPartition("matrix_identity_b")
    })
  ];
}

function packageEvents(subject: string): readonly AuditEvent[] {
  return [
    createAuditEvent({
      packageDeclaration: {
        packageId: "matrix.package",
        generation: 1n
      }
    }, {
      partition: globalPartition()
    }),
    appEvent(
      globalTarget(),
      globalPartition(),
      operatorAttribution(),
      AppMutationAction.APP_MUTATION_ACTION_CREATED,
      1n),
    appEvent(
      tenantTarget("matrix_app_tenant"),
      tenantPartition("matrix_app_tenant"),
      operatorAttribution(),
      AppMutationAction
        .APP_MUTATION_ACTION_PACKAGE_GENERATION_CHANGED,
      2n),
    appEvent(
      workspaceTarget("matrix_app_workspace", "workspace_a"),
      tenantPartition("matrix_app_workspace"),
      invocationAttribution(subject),
      AppMutationAction.APP_MUTATION_ACTION_CREATED,
      1n),
    appEvent(
      userTarget("matrix_app_user", "service:matrix"),
      tenantPartition("matrix_app_user"),
      invocationAttribution(
        subject,
        "agent:matrix",
        "service:matrix"),
      AppMutationAction
        .APP_MUTATION_ACTION_PACKAGE_GENERATION_CHANGED,
      2n)
  ];
}

function configurationEvents(subject: string): readonly AuditEvent[] {
  const claimId = `dpc-${"c".repeat(32)}`;
  return [
    configurationPublication(
      globalTarget(),
      globalPartition(),
      operatorAttribution()),
    configurationPublication(
      tenantTarget("matrix_config_tenant"),
      tenantPartition("matrix_config_tenant"),
      operatorAttribution()),
    configurationPublication(
      workspaceTarget("matrix_config_workspace", "workspace_b"),
      tenantPartition("matrix_config_workspace"),
      invocationAttribution(subject)),
    configurationPublication(
      userTarget("matrix_config_user", "user:matrix"),
      tenantPartition("matrix_config_user"),
      workloadAttribution(subject),
      claimId,
      2n),
    secretPublication(
      globalTarget(),
      globalPartition(),
      operatorAttribution()),
    secretPublication(
      tenantTarget("matrix_secret_tenant"),
      tenantPartition("matrix_secret_tenant"),
      operatorAttribution()),
    secretPublication(
      workspaceTarget("matrix_secret_workspace", "workspace_c"),
      tenantPartition("matrix_secret_workspace"),
      invocationAttribution(subject)),
    secretPublication(
      userTarget("matrix_secret_user", "service:matrix"),
      tenantPartition("matrix_secret_user"),
      workloadAttribution(subject),
      `dpc-${"d".repeat(32)}`,
      3n),
    projectionEvent(
      globalTarget(),
      globalPartition(),
      workloadAttribution(subject),
      true),
    projectionEvent(
      tenantTarget("matrix_projection_tenant"),
      tenantPartition("matrix_projection_tenant"),
      workloadAttribution(subject),
      false)
  ];
}

function executionEvents(subject: string): readonly AuditEvent[] {
  return [
    placementEvent(
      globalTarget(),
      globalPartition(),
      operatorAttribution(),
      PlacementMutationAction.PLACEMENT_MUTATION_ACTION_DECLARED,
      1n),
    placementEvent(
      tenantTarget("matrix_placement_tenant"),
      tenantPartition("matrix_placement_tenant"),
      operatorAttribution(),
      PlacementMutationAction.PLACEMENT_MUTATION_ACTION_UPDATED,
      2n),
    placementEvent(
      workspaceTarget("matrix_placement_workspace", "workspace_d"),
      tenantPartition("matrix_placement_workspace"),
      invocationAttribution(subject),
      PlacementMutationAction.PLACEMENT_MUTATION_ACTION_DECLARED,
      1n),
    placementEvent(
      userTarget("matrix_placement_user", "user:matrix"),
      tenantPartition("matrix_placement_user"),
      invocationAttribution(subject),
      PlacementMutationAction.PLACEMENT_MUTATION_ACTION_UPDATED,
      2n),
    workloadEvent(
      globalTarget(),
      globalPartition(),
      operatorAttribution(),
      WorkloadMutationAction.WORKLOAD_MUTATION_ACTION_DECLARED,
      1n),
    workloadEvent(
      tenantTarget("matrix_workload_tenant"),
      tenantPartition("matrix_workload_tenant"),
      operatorAttribution(),
      WorkloadMutationAction.WORKLOAD_MUTATION_ACTION_UPDATED,
      2n),
    workloadEvent(
      workspaceTarget("matrix_workload_workspace", "workspace_e"),
      tenantPartition("matrix_workload_workspace"),
      invocationAttribution(subject),
      WorkloadMutationAction.WORKLOAD_MUTATION_ACTION_DECLARED,
      1n),
    workloadEvent(
      userTarget("matrix_workload_user", "service:matrix"),
      tenantPartition("matrix_workload_user"),
      invocationAttribution(subject),
      WorkloadMutationAction.WORKLOAD_MUTATION_ACTION_UPDATED,
      2n),
    runEvent(
      globalTarget(),
      globalPartition(),
      operatorAttribution(),
      RunMutationAction.RUN_MUTATION_ACTION_CREATED,
      1n),
    runEvent(
      tenantTarget("matrix_run_tenant"),
      tenantPartition("matrix_run_tenant"),
      operatorAttribution(),
      RunMutationAction
        .RUN_MUTATION_ACTION_CANCELLATION_REQUESTED,
      2n),
    runEvent(
      workspaceTarget("matrix_run_workspace", "workspace_f"),
      tenantPartition("matrix_run_workspace"),
      invocationAttribution(subject),
      RunMutationAction.RUN_MUTATION_ACTION_CREATED,
      1n),
    runEvent(
      userTarget("matrix_run_user", "user:matrix"),
      tenantPartition("matrix_run_user"),
      invocationAttribution(subject),
      RunMutationAction
        .RUN_MUTATION_ACTION_CANCELLATION_REQUESTED,
      2n)
  ];
}

function appEvent(
  target: PlacementAuditTarget,
  partition: ReturnType<typeof tenantPartition>,
  attribution: ReturnType<typeof operatorAttribution>,
  action: AppMutationAction,
  revision: bigint
): AuditEvent {
  return createAuditEvent({
    appMutation: {
      appId: `matrix_app_${revision.toString()}`,
      scope: target,
      placementId: "matrix_placement",
      packageId: "matrix.package",
      packageGeneration: revision,
      appRevision: revision,
      action
    }
  }, { partition, attribution });
}

function configurationPublication(
  target: PlacementAuditTarget,
  partition: ReturnType<typeof tenantPartition>,
  attribution: ReturnType<typeof operatorAttribution>,
  dependencyClaimId?: string,
  dependencyClaimRevision?: bigint
): AuditEvent {
  return createAuditEvent({
    configurationPublication: {
      target: {
        configurationId: "matrix_configuration",
        configurationVersionId: "version_a"
      },
      binding: binding(target),
      identityRevision: 1n,
      dependencyClaimId,
      dependencyClaimRevision
    }
  }, { partition, attribution });
}

function secretPublication(
  target: PlacementAuditTarget,
  partition: ReturnType<typeof tenantPartition>,
  attribution: ReturnType<typeof operatorAttribution>,
  dependencyClaimId?: string,
  dependencyClaimRevision?: bigint
): AuditEvent {
  return createAuditEvent({
    secretPublication: {
      target: {
        secretId: "matrix_secret",
        secretVersionId: "version_a"
      },
      binding: binding(target),
      identityRevision: 1n,
      dependencyClaimId,
      dependencyClaimRevision
    }
  }, { partition, attribution });
}

function projectionEvent(
  target: PlacementAuditTarget,
  partition: ReturnType<typeof tenantPartition>,
  attribution: ReturnType<typeof workloadAttribution>,
  configuration: boolean
): AuditEvent {
  return createAuditEvent({
    projectionMutation: {
      projectionId: `prj_${"a".repeat(52)}`,
      action: ProjectionMutationAction
        .PROJECTION_MUTATION_ACTION_CREATED,
      projectionRevision: 1n,
      configuration: configuration
        ? {
            configurationId: "matrix_configuration",
            configurationVersionId: "version_a"
          }
        : undefined,
      secret: configuration
        ? undefined
        : {
            secretId: "matrix_secret",
            secretVersionId: "version_a"
          },
      binding: binding(target)
    }
  }, { partition, attribution });
}

function placementEvent(
  target: PlacementAuditTarget,
  partition: ReturnType<typeof tenantPartition>,
  attribution: ReturnType<typeof operatorAttribution>,
  action: PlacementMutationAction,
  revision: bigint
): AuditEvent {
  return createAuditEvent({
    placementMutation: {
      placementId: `matrix_placement_${revision.toString()}`,
      target,
      action,
      placementRevision: revision,
      resultingDesiredState:
        ExecutionDesiredState.EXECUTION_DESIRED_STATE_ACTIVE
    }
  }, { partition, attribution });
}

function workloadEvent(
  target: PlacementAuditTarget,
  partition: ReturnType<typeof tenantPartition>,
  attribution: ReturnType<typeof operatorAttribution>,
  action: WorkloadMutationAction,
  revision: bigint
): AuditEvent {
  return createAuditEvent({
    workloadMutation: {
      workloadId: `matrix_workload_${revision.toString()}`,
      placementId: "matrix_placement",
      placementTarget: target,
      action,
      workloadRevision: revision,
      resultingDesiredState:
        ExecutionDesiredState.EXECUTION_DESIRED_STATE_SUSPENDED,
      appId: "matrix_app",
      appRevision: 1n,
      packageId: "matrix.package",
      packageGeneration: 1n,
      componentId: "matrix_component"
    }
  }, { partition, attribution });
}

function runEvent(
  target: PlacementAuditTarget,
  partition: ReturnType<typeof tenantPartition>,
  attribution: ReturnType<typeof operatorAttribution>,
  action: RunMutationAction,
  revision: bigint
): AuditEvent {
  return createAuditEvent({
    runMutation: {
      runId: `matrix.run.${revision.toString()}`,
      workloadId: "matrix_workload",
      placementId: "matrix_placement",
      placementTarget: target,
      action,
      runRevision: revision,
      configuredActorPrincipalId: "agent:matrix"
    }
  }, { partition, attribution });
}

function binding(target: PlacementAuditTarget): {
  placementId: string;
  placementTarget: PlacementAuditTarget;
  consumerId: string;
  purpose: string;
} {
  return {
    placementId: "matrix_placement",
    placementTarget: target,
    consumerId: "matrix_consumer",
    purpose: "database"
  };
}
