import { readFile } from "node:fs/promises";
import path from "node:path";
import type { TestToolchain } from "./test-toolchain.js";

export async function loadTestToolchain(
  repositoryRoot: string
): Promise<TestToolchain> {
  const source = await readFile(
    path.join(
      repositoryRoot,
      "testing/mesh/test-toolchain.json"),
    "utf8");
  const value = JSON.parse(source) as Partial<TestToolchain>;
  if (
    value.minikube?.version !== "v1.38.1"
    || value.minikube.linuxAmd64Sha256
      !== "099477eaf248bcb5bcea8ce78a2898e93ac01461c35189da1848c3de82ecd22e"
    || value.kubernetesVersion !== "v1.34.0"
    || value.profile !== "ctlflow-test-mesh"
    || value.driver !== "docker"
    || value.containerRuntime !== "containerd"
    || value.cpus !== 4
    || value.memoryMiB !== 4096
  ) {
    throw new Error("Test toolchain manifest is invalid");
  }

  return value as TestToolchain;
}
