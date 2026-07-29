import {
  DesiredState,
  WorkloadMode,
  type DeclarePlacementRequest,
  type PlacementConstraints,
  type PlacementTarget
} from "../../generated/v1/execd.js";

export interface CreatePlacementRequestOptions {
  readonly placementId: string;
  readonly target: PlacementTarget;
  readonly parentPlacementId?: string;
  readonly expectedRevision?: bigint;
  readonly desiredState?: DesiredState;
  readonly constraints?: PlacementConstraints;
}

export function createPlacementRequest(
  options: CreatePlacementRequestOptions
): DeclarePlacementRequest {
  return {
    placementId: options.placementId,
    target: options.target,
    parentPlacementId: options.parentPlacementId,
    constraints: options.constraints ?? createDefaultConstraints(),
    desiredState: options.desiredState
      ?? DesiredState.DESIRED_STATE_ACTIVE,
    expectedRevision: options.expectedRevision
  };
}

function createDefaultConstraints(): PlacementConstraints {
  return {
    admittedModes: [
      WorkloadMode.WORKLOAD_MODE_CONTINUOUS,
      WorkloadMode.WORKLOAD_MODE_FINITE
    ],
    maxReplicasPerContinuousWorkload: 4,
    maxRunDurationSeconds: 600n,
    maxRunAttempts: 3,
    maxResourcesPerExecution: {
      cpuMillis: 1_000,
      memoryBytes: 256n * 1_024n * 1_024n
    },
    maxPersistentStorageBytesPerWorkload:
      1n * 1_024n * 1_024n * 1_024n,
    dependencyProvisioners: [{
      dependencyTypeId: "postgresql",
      provisionerId: "test-provisioner"
    }]
  };
}
