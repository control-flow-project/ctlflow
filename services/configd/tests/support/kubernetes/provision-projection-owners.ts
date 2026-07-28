import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import {
  deriveNativeName
} from "./derive-native-name.js";
import {
  projectionOwnerNamespaceState
} from "./projection-owner-namespace-state.js";

export interface ProjectionOwners {
  readonly namespaceName: string;
  readonly serviceAccountName: string;
  readonly serviceAccountUid: string;
}

export async function provisionProjectionOwners(
  kubernetes: TestKubernetes,
  placementId: string,
  workloadId: string
): Promise<ProjectionOwners> {
  const namespaceName = deriveNativeName(
    "ctlflow.execution.v1.PlacementNamespace",
    "plc-",
    placementId);
  const serviceAccountName = deriveNativeName(
    "ctlflow.execution.v1.WorkloadServiceAccount",
    "wld-",
    workloadId);
  if (!projectionOwnerNamespaceState.names.has(namespaceName)) {
    await kubernetes.runKubectl([
      "delete",
      "namespace",
      namespaceName,
      "--ignore-not-found=true",
      "--wait=true",
      "--timeout=30s"
    ]);
    projectionOwnerNamespaceState.names.add(namespaceName);
  }
  const manifest = `apiVersion: v1
kind: Namespace
metadata:
  name: ${namespaceName}
  annotations:
    execution.ctlflow.io/owner-service: execd
    execution.ctlflow.io/placement-id: ${placementId}
---
apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${serviceAccountName}
  namespace: ${namespaceName}
  annotations:
    execution.ctlflow.io/owner-service: execd
    execution.ctlflow.io/placement-id: ${placementId}
    execution.ctlflow.io/workload-id: ${workloadId}
automountServiceAccountToken: false
`;
  await kubernetes.runKubectl(["apply", "-f", "-"], manifest);
  const account = JSON.parse((await kubernetes.runKubectl([
    "get",
    "serviceaccount",
    serviceAccountName,
    "--namespace",
    namespaceName,
    "--output=json"
  ])).stdout) as {
    readonly metadata?: {
      readonly uid?: unknown;
    };
  };
  const serviceAccountUid = account.metadata?.uid;
  if (typeof serviceAccountUid !== "string"
      || serviceAccountUid.length === 0) {
    throw new Error("Projection ServiceAccount has no UID");
  }

  return {
    namespaceName,
    serviceAccountName,
    serviceAccountUid
  };
}
