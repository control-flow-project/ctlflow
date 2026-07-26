import {
  runCommand,
  type RunCommandOptions
} from "../processes/run-command.js";
import type { CommandResult } from "../processes/command-result.js";
import type { TestMinikube } from "./test-minikube.js";

export async function runKubectl(
  repositoryRoot: string,
  minikube: TestMinikube,
  arguments_: readonly string[],
  options: Omit<RunCommandOptions, "cwd"> = {}
): Promise<CommandResult> {
  return await runCommand(
    minikube.executable,
    [
      "--profile",
      minikube.toolchain.profile,
      "kubectl",
      "--",
      ...arguments_
    ],
    {
      cwd: repositoryRoot,
      ...options
    });
}
