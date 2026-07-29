import {
  buildNodeTestImage,
  publishContainerizedCSharpService,
  startCSharpService
} from "@ctlflow/test-mesh";
import type {
  ServicePaths
} from "../support/test-paths.js";
import {
  repositoryRoot
} from "../support/test-paths.js";
import type {
  ServiceTestRuntime
} from "./service-test-runtime.js";

export async function loadServiceTestRuntime(
  serviceName: string,
  paths: ServicePaths
): Promise<ServiceTestRuntime> {
  const publication = await publishContainerizedCSharpService({
    repositoryRoot,
    projectPath: paths.projectPath,
    diagnosticsManifestPath: paths.diagnosticsManifestPath,
    containerfilePath: paths.serviceContainerfilePath,
    executableName: paths.executableName
  });

  return {
    start: async (options) => {
      const migrationImage = await buildNodeTestImage({
        repositoryRoot,
        kubernetes: options.kubernetes,
        imageName: `${serviceName}-migrations`,
        containerfilePath: paths.migrationContainerfilePath,
        sourcePaths: [
          `${paths.serviceRoot}/knexfile.ts`,
          `${paths.serviceRoot}/migrations`,
          `${paths.serviceRoot}/package.json`,
          `${paths.serviceRoot}/schema-manifest.txt`,
          `${paths.serviceRoot}/tooling`,
          `${paths.serviceRoot}/tsconfig.migrations.json`,
          `${repositoryRoot}/tooling/clean-directories.mjs`
        ]
      });
      return await startCSharpService({
        repositoryRoot,
        publication,
        kubernetes: options.kubernetes,
        name: options.name,
        imageName: serviceName,
        containerfilePath: paths.serviceContainerfilePath,
        migrationImage,
        kustomizeBasePath: paths.kustomizeBasePath,
        storageDirectory: options.storageDirectory,
        storageFilePath: paths.storageFilePath,
        environment: options.environment,
        files: options.files,
        ...(options.provision === undefined
          ? {}
          : { provision: options.provision })
      });
    },
    stop: publication.stop
  };
}
