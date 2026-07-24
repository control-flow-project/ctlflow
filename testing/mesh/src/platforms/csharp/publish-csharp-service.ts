import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../../processes/run-command.js";

export async function publishCSharpService(
  repositoryRoot: string,
  projectPath: string,
  diagnosticsManifestPath: string
): Promise<string> {
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "ctlflow-csharp-publish-"));

  try {
    // The repository owns one gated NativeAOT publisher; the canonical suite,
    // local verification, and container release all run the same command.
    await runCommand(
      "node",
      [
        path.join(repositoryRoot, "tooling/native/gated-publish.mjs"),
        projectPath,
        diagnosticsManifestPath,
        outputDirectory
      ],
      { cwd: repositoryRoot });

    return outputDirectory;
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}
