import {
  buildNodeTestImage,
  publishContainerizedCSharpService,
  startCSharpService
} from "@ctlflow/test-mesh";
import {
  diagnosticsManifestPath,
  kustomizeBasePath,
  migrationContainerfilePath,
  repositoryRoot,
  serviceContainerfilePath,
  serviceProjectPath,
  serviceRoot
} from "../support/test-paths.js";
import type {
  ConfigdTestRuntime
} from "./configd-test-runtime.js";

const csharpExecutableName =
  "CtlFlow.Configuration.Configd.Service";

export async function loadConfigdTestRuntime():
Promise<ConfigdTestRuntime> {
  const implementation =
    process.env.CTLFLOW_TEST_IMPLEMENTATION ?? "csharp";
  if (implementation !== "csharp") {
    throw new Error(
      `Unsupported configd implementation: ${implementation}`);
  }

  const publication = await publishContainerizedCSharpService({
    repositoryRoot,
    projectPath: serviceProjectPath,
    diagnosticsManifestPath,
    containerfilePath: serviceContainerfilePath,
    executableName: csharpExecutableName
  });
  return {
    implementation,
    start: async (options) => {
      const migrationImage = await buildNodeTestImage({
        repositoryRoot,
        kubernetes: options.kubernetes,
        imageName: "configd-migrations",
        containerfilePath: migrationContainerfilePath,
        sourcePaths: [
          `${serviceRoot}/knexfile.ts`,
          `${serviceRoot}/migrations`,
          `${serviceRoot}/package.json`,
          `${serviceRoot}/schema-manifest.txt`,
          `${serviceRoot}/tooling`,
          `${serviceRoot}/tsconfig.migrations.json`,
          `${repositoryRoot}/tooling/clean-directories.mjs`
        ]
      });
      return await startCSharpService({
        repositoryRoot,
        publication,
        kubernetes: options.kubernetes,
        name: options.name,
        imageName: "configd",
        containerfilePath: serviceContainerfilePath,
        migrationImage,
        kustomizeBasePath,
        storageDirectory: options.storageDirectory,
        storageFilePath: "/var/lib/ctlflow/configd.sqlite",
        environment: options.environment,
        files: options.files
      });
    },
    stop: publication.stop
  };
}
