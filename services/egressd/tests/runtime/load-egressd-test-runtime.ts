import {
  publishContainerizedCSharpService,
  startCSharpStatelessService
} from "@ctlflow/test-mesh";
import type {
  EgressdTestRuntime
} from "./egressd-test-runtime.js";
import {
  diagnosticsManifestPath,
  kustomizeBasePath,
  repositoryRoot,
  serviceContainerfilePath,
  serviceProjectPath
} from "../support/test-paths.js";

const executableName = "CtlFlow.Egress.Egressd.Service";

export async function loadEgressdTestRuntime():
Promise<EgressdTestRuntime> {
  const implementation =
    process.env.CTLFLOW_TEST_IMPLEMENTATION ?? "csharp";
  if (implementation !== "csharp") {
    throw new Error(
      `Unsupported Egressd implementation: ${implementation}`);
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
        name: "egressd",
        imageName: "egressd",
        containerfilePath: serviceContainerfilePath,
        kustomizeBasePath,
        environment: options.environment,
        files: options.files
      }),
    stop: publication.stop
  };
}
