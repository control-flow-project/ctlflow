import {
  publishContainerizedCSharpService,
  startCSharpStatelessService
} from "@ctlflow/test-mesh";
import type {
  AuthdTestRuntime
} from "./authd-test-runtime.js";
import {
  diagnosticsManifestPath,
  kustomizeBasePath,
  repositoryRoot,
  serviceContainerfilePath,
  serviceProjectPath
} from "../support/test-paths.js";

const executableName = "CtlFlow.Auth.Authd.Service";

export async function loadAuthdTestRuntime():
Promise<AuthdTestRuntime> {
  const implementation =
    process.env.CTLFLOW_TEST_IMPLEMENTATION ?? "csharp";
  if (implementation !== "csharp") {
    throw new Error(
      `Unsupported Authd implementation: ${implementation}`);
  }
  const publication = await publishContainerizedCSharpService({
    repositoryRoot,
    projectPath: serviceProjectPath,
    diagnosticsManifestPath,
    containerfilePath: serviceContainerfilePath,
    executableName
  });
  return {
    implementation,
    start: async (options) =>
      await startCSharpStatelessService({
        repositoryRoot,
        publication,
        kubernetes: options.kubernetes,
        name: "authd",
        imageName: "authd",
        containerfilePath: serviceContainerfilePath,
        kustomizeBasePath,
        environment: options.environment,
        files: options.files
      }),
    stop: publication.stop
  };
}
