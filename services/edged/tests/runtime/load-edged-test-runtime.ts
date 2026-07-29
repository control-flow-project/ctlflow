import {
  publishContainerizedCSharpService,
  startCSharpStatelessService
} from "@ctlflow/test-mesh";
import type {
  EdgedTestRuntime
} from "./edged-test-runtime.js";
import {
  diagnosticsManifestPath,
  kustomizeBasePath,
  repositoryRoot,
  serviceContainerfilePath,
  serviceProjectPath
} from "../support/test-paths.js";

const executableName = "CtlFlow.Edge.Edged.Service";

export async function loadEdgedTestRuntime():
Promise<EdgedTestRuntime> {
  const implementation =
    process.env.CTLFLOW_TEST_IMPLEMENTATION ?? "csharp";
  if (implementation !== "csharp") {
    throw new Error(
      `Unsupported Edged implementation: ${implementation}`);
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
        name: "edged",
        imageName: "edged",
        containerfilePath: serviceContainerfilePath,
        kustomizeBasePath,
        environment: options.environment,
        files: options.files,
        additionalImages: [{
          name: "edged-test-application",
          image: options.applicationImage
        }]
      }),
    stop: publication.stop
  };
}
