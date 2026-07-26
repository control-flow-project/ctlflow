import type {
  TestKubernetes
} from "../test-kubernetes.js";

export async function renderKustomizeService(
  kubernetes: TestKubernetes,
  overlayPath: string
): Promise<string> {
  const result = await kubernetes.runKubectl([
    "kustomize",
    overlayPath,
    "--load-restrictor=LoadRestrictionsNone"
  ]);
  if (result.stdout.trim().length === 0) {
    throw new Error("Kustomize rendered an empty service manifest");
  }

  return result.stdout;
}
