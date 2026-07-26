import { startProcess } from "../processes/start-process.js";
import type { ManagedProcess } from "../processes/managed-process.js";

export function startKubectl(
  repositoryRoot: string,
  executable: string,
  kubeconfigPath: string,
  arguments_: readonly string[]
): ManagedProcess {
  return startProcess(
    executable,
    [
      "--kubeconfig",
      kubeconfigPath,
      ...arguments_
    ],
    {
      cwd: repositoryRoot,
      environment: {}
    });
}
