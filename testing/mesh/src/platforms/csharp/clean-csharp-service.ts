import { runCommand } from "../../processes/run-command.js";

export async function cleanCSharpService(
  repositoryRoot: string,
  projectPath: string
): Promise<void> {
  await runCommand(
    "dotnet",
    [
      "clean",
      projectPath,
      "--configuration",
      "Release",
      "--runtime",
      "linux-x64",
      "--disable-build-servers",
      "-m:1",
      "-p:UseSharedCompilation=false"
    ],
    { cwd: repositoryRoot });
}
