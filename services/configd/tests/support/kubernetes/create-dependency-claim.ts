import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import type {
  ProjectionOwners
} from "./provision-projection-owners.js";

export interface CreateDependencyClaimOptions {
  readonly claimId: string;
  readonly claimRevision: bigint;
  readonly placementId: string;
  readonly workloadId: string;
  readonly provisionerSubject: string;
}

export async function createDependencyClaim(
  kubernetes: TestKubernetes,
  owners: ProjectionOwners,
  options: CreateDependencyClaimOptions
): Promise<void> {
  const manifest = `apiVersion: execution.ctlflow.io/v1
kind: DependencyClaim
metadata:
  name: ${options.claimId}
  namespace: ${owners.namespaceName}
  annotations:
    execution.ctlflow.io/owner-service: execd
spec:
  claimRevision: ${String(options.claimRevision)}
  placementId: ${options.placementId}
  workloadId: ${options.workloadId}
  provisionerSubject: ${options.provisionerSubject}
`;
  await kubernetes.runKubectl(["apply", "-f", "-"], manifest);
}
