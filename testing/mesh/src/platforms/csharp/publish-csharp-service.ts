import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../../processes/run-command.js";
import {
  extractNativeAotDiagnostics
} from "./diagnostics/extract-native-aot-diagnostics.js";
import {
  readNativeAotDiagnosticManifest
} from "./diagnostics/read-native-aot-diagnostic-manifest.js";
import {
  verifyNativeAotDiagnostics
} from "./diagnostics/verify-native-aot-diagnostics.js";
import { cleanCSharpService } from "./clean-csharp-service.js";

export async function publishCSharpService(
  repositoryRoot: string,
  projectPath: string,
  diagnosticsManifestPath: string
): Promise<string> {
  const outputDirectory = await mkdtemp(
    path.join(os.tmpdir(), "ctlflow-csharp-publish-"));

  try {
    await cleanCSharpService(repositoryRoot, projectPath);
    const result = await runCommand(
      "dotnet",
      [
        "publish",
        projectPath,
        "--disable-build-servers",
        "--configuration",
        "Release",
        "--runtime",
        "linux-x64",
        "--output",
        outputDirectory,
        "-m:1",
        "-p:UseSharedCompilation=false",
        "-p:TreatWarningsAsErrors=false",
        "-p:ILLinkTreatWarningsAsErrors=false",
        "-p:TrimmerTreatWarningsAsErrors=false",
        "-p:IlcTreatWarningsAsErrors=false"
      ],
      { cwd: repositoryRoot });
    const manifest = await readNativeAotDiagnosticManifest(
      diagnosticsManifestPath);
    const diagnostics = extractNativeAotDiagnostics(
      `${result.stdout}\n${result.stderr}`,
      {
        repository: repositoryRoot,
        publication: outputDirectory
      });
    verifyNativeAotDiagnostics(manifest.diagnostics, diagnostics);

    return outputDirectory;
  } catch (error) {
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }
}
