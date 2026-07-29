import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  TestKubernetes
} from "@ctlflow/test-mesh";

export async function installDependencyClaimCrd(
  kubernetes: TestKubernetes,
  repositoryRoot: string
): Promise<void> {
  const manifest = await readFile(
    path.join(
      repositoryRoot,
      "services/execd/api/kubernetes/v1/dependency-claim-crd.yaml"),
    "utf8");
  await kubernetes.runKubectl(["apply", "-f", "-"], manifest);
  await kubernetes.runKubectl([
    "wait",
    "--for=condition=Established",
    "crd/dependencyclaims.execution.ctlflow.io",
    "--timeout=30s"
  ]);
}
