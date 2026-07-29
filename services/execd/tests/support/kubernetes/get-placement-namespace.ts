import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import {
  listOwnedKubernetesObjects
} from "./list-owned-kubernetes-objects.js";

export async function getPlacementNamespace(
  kubernetes: TestKubernetes,
  placementId: string
): Promise<string> {
  const namespaces = await listOwnedKubernetesObjects(
    kubernetes,
    "namespaces",
    {
      "execution.ctlflow.io/owner-service": "execd",
      "execution.ctlflow.io/placement-id": placementId
    });
  if (namespaces.length !== 1) {
    throw new Error(
      `Expected one namespace for Placement ${placementId}`);
  }
  return namespaces[0]!.metadata.name;
}
