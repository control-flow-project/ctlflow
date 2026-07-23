import { runCommand } from "../processes/run-command.js";
import type { CommandResult } from "../processes/command-result.js";

export async function runKubectl(
  repositoryRoot: string,
  controlPlaneContainer: string,
  arguments_: readonly string[]
): Promise<CommandResult> {
  return await runCommand(
    "docker",
    [
      "exec",
      controlPlaneContainer,
      "kubectl",
      "--kubeconfig=/etc/kubernetes/admin.conf",
      ...arguments_
    ],
    { cwd: repositoryRoot });
}
