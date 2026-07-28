import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import {
  projectionOwnerNamespaceState
} from "./projection-owner-namespace-state.js";

export async function cleanupProjectionOwners(
  kubernetes: TestKubernetes
): Promise<void> {
  const namespaceNames = [...projectionOwnerNamespaceState.names];
  projectionOwnerNamespaceState.names.clear();
  if (namespaceNames.length === 0) {
    return;
  }

  await kubernetes.runKubectl([
    "delete",
    "namespace",
    ...namespaceNames,
    "--ignore-not-found=true",
    "--wait=true",
    "--timeout=30s"
  ]);
}
