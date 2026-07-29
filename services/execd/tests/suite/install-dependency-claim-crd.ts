import {
  readFile
} from "node:fs/promises";
import path from "node:path";
import type {
  TestKubernetes
} from "@ctlflow/test-mesh";

export async function installDependencyClaimCrd(
  repositoryRoot: string,
  kubernetes: TestKubernetes
): Promise<void> {
  const manifest = await readFile(
    path.join(
      repositoryRoot,
      "services",
      "execd",
      "api",
      "kubernetes",
      "v1",
      "dependency-claim-crd.yaml"),
    "utf8");
  await kubernetes.runKubectl(["apply", "-f", "-"], manifest);
}
