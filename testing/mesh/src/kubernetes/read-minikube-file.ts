import { runMinikube } from "./run-minikube.js";
import type { TestMinikube } from "./test-minikube.js";

export async function readMinikubeFile(
  repositoryRoot: string,
  minikube: TestMinikube,
  filePath: string
): Promise<string> {
  if (!filePath.startsWith("/") || filePath.includes("\n")) {
    throw new Error("Minikube file path is invalid");
  }

  return (await runMinikube(
    repositoryRoot,
    minikube,
    ["ssh", "--", "sudo", "cat", filePath])).stdout;
}
