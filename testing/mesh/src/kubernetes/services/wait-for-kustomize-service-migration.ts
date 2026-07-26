import type {
  KustomizeServiceOptions
} from "./kustomize-service.js";

export async function waitForKustomizeServiceMigration(
  options: KustomizeServiceOptions
): Promise<void> {
  await options.kubernetes.runKubectl([
    "wait",
    "--for=condition=complete",
    `job/${options.name}-migrate`,
    "--namespace",
    options.kubernetes.namespace,
    "--timeout=60s"
  ]);
}
