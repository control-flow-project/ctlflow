import { rm } from "node:fs/promises";
import path from "node:path";
import { startProcess } from "../../processes/start-process.js";
import { stopProcess } from "../../processes/stop-process.js";
import { waitForReadiness } from "../../processes/wait-for-readiness.js";
import type {
  CSharpService,
  CSharpServiceOptions
} from "./csharp-service.js";
import { publishCSharpService } from "./publish-csharp-service.js";

export async function startCSharpService(
  options: CSharpServiceOptions
): Promise<CSharpService> {
  const outputDirectory = await publishCSharpService(
    options.repositoryRoot,
    options.projectPath,
    options.diagnosticsManifestPath);
  const executablePath = path.join(
    outputDirectory,
    options.executableName);
  let process_ = start(options.environment);
  let disposed = false;

  try {
    await waitUntilReady();
  } catch (error) {
    await stopProcess(process_);
    await rm(outputDirectory, { recursive: true, force: true });
    throw error;
  }

  return {
    executablePath,
    diagnostics: () => process_.diagnostics(),
    restart: async (environment = {}) => {
      if (disposed) {
        throw new Error("Cannot restart a disposed C# service");
      }

      await stopProcess(process_);
      process_ = start({
        ...options.environment,
        ...environment
      });
      try {
        await waitUntilReady();
      } catch (error) {
        await stopProcess(process_);
        throw error;
      }
    },
    stop: async () => {
      if (disposed) {
        return;
      }

      disposed = true;
      await stopProcess(process_);
      await rm(outputDirectory, { recursive: true, force: true });
    }
  };

  function start(
    environment: Readonly<Record<string, string>>
  ) {
    return startProcess(executablePath, [], {
      cwd: outputDirectory,
      environment
    });
  }

  async function waitUntilReady(): Promise<void> {
    await waitForReadiness(
      options.probeHost,
      options.probePort,
      process_);
  }
}
