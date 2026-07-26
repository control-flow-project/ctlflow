import { access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { constants } from "node:fs";
import type { TestMinikube } from "./test-minikube.js";
import { runMinikube } from "./run-minikube.js";

export async function resolveKubectl(
  repositoryRoot: string,
  minikube: TestMinikube
): Promise<string> {
  await runMinikube(
    repositoryRoot,
    minikube,
    ["kubectl", "--", "version", "--client=true"]);
  const home = process.env.MINIKUBE_HOME === undefined
    ? path.join(os.homedir(), ".minikube")
    : path.resolve(process.env.MINIKUBE_HOME);
  const architecture = process.arch === "x64"
    ? "amd64"
    : process.arch === "arm64"
      ? "arm64"
      : undefined;
  if (process.platform !== "linux" || architecture === undefined) {
    throw new Error("The pinned test kubectl supports Linux x64 or arm64");
  }

  const executable = path.join(
    home,
    "cache",
    "linux",
    architecture,
    minikube.toolchain.kubernetesVersion,
    "kubectl");
  await access(executable, constants.X_OK).catch(() => {
    throw new Error(`Minikube kubectl is not executable: ${executable}`);
  });
  return executable;
}
