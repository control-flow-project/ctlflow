import type {
  KustomizeServiceOptions
} from "./kustomize-service.js";

export async function resetKustomizeService(
  options: KustomizeServiceOptions
): Promise<void> {
  const persistentVolumeName =
    `${options.kubernetes.namespace}-${options.name}-data`;
  await options.kubernetes.runKubectl([
    "delete",
    `statefulset/${options.name}`,
    `job/${options.name}-migrate`,
    `job/${options.name}-test-storage-access`,
    `pvc/${options.name}-data`,
    "--namespace",
    options.kubernetes.namespace,
    "--ignore-not-found=true",
    "--wait=true"
  ]);
  await options.kubernetes.runKubectl([
    "delete",
    `persistentvolume/${persistentVolumeName}`,
    "--ignore-not-found=true",
    "--wait=true"
  ]);
}
