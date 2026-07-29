import type {
  TestKubernetes
} from "@ctlflow/test-mesh";
import {
  listOwnedKubernetesObjects
} from "../support/kubernetes/list-owned-kubernetes-objects.js";

export async function cleanupExecdKubernetesResources(
  kubernetes: TestKubernetes
): Promise<void> {
  const namespaces = await listOwnedKubernetesObjects(
    kubernetes,
    "namespaces",
    {
      "execution.ctlflow.io/owner-service": "execd"
    });
  if (namespaces.length === 0) {
    return;
  }

  await kubernetes.runKubectl([
    "delete",
    "namespaces",
    ...namespaces.map((item) => item.metadata.name),
    "--ignore-not-found=true",
    "--wait=false"
  ]);
}
