import type {
  KustomizeServiceOptions
} from "./kustomize-service.js";

export async function waitForKustomizeServiceRollout(
  options: KustomizeServiceOptions
): Promise<void> {
  await options.kubernetes.runKubectl([
    "rollout",
    "status",
    `statefulset/${options.name}`,
    "--namespace",
    options.kubernetes.namespace,
    "--timeout=60s"
  ]);
}
