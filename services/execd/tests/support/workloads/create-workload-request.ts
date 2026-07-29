import {
  DesiredState,
  type ConfigdTargetReference,
  type DeclareWorkloadRequest,
  type DependencySelection,
  type ExecutionResources,
  type PersistentStorage
} from "../../generated/v1/execd.js";

export interface CreateWorkloadRequestOptions {
  readonly workloadId: string;
  readonly placementId: string;
  readonly appId: string;
  readonly mode: "continuous" | "finite";
  readonly componentId?: string;
  readonly expectedRevision?: bigint;
  readonly desiredState?: DesiredState;
  readonly resources?: ExecutionResources;
  readonly configdTargets?: readonly ConfigdTargetReference[];
  readonly dependencies?: readonly DependencySelection[];
  readonly persistentStorage?: readonly PersistentStorage[];
  readonly replicas?: number;
  readonly interfaceIds?: readonly string[];
  readonly actorPrincipalId?: string;
  readonly runDurationSeconds?: bigint;
  readonly maxAttempts?: number;
}

export function createWorkloadRequest(
  options: CreateWorkloadRequestOptions
): DeclareWorkloadRequest {
  return {
    workloadId: options.workloadId,
    placementId: options.placementId,
    expectedRevision: options.expectedRevision,
    declaration: {
      desiredState: options.desiredState
        ?? DesiredState.DESIRED_STATE_ACTIVE,
      packageComponent: {
        appId: options.appId,
        componentId: options.componentId
          ?? (options.mode === "continuous" ? "service" : "finite")
      },
      resources: options.resources ?? {
        cpuMillis: 100,
        memoryBytes: 32n * 1_024n * 1_024n
      },
      configdTargets: [...(options.configdTargets ?? [])],
      dependencies: [...(options.dependencies ?? [])],
      persistentStorage: [...(options.persistentStorage ?? [])],
      continuous: options.mode === "continuous"
        ? {
            replicas: options.replicas ?? 1,
            interfaceIds: [...(options.interfaceIds ?? [])]
          }
        : undefined,
      finite: options.mode === "finite"
        ? {
            actorPrincipalId: options.actorPrincipalId,
            runDurationSeconds: options.runDurationSeconds ?? 60n,
            maxAttempts: options.maxAttempts ?? 1
          }
        : undefined
    }
  };
}
