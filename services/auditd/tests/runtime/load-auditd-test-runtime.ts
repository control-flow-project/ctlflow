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
  AuditdTestRuntime
} from "./auditd-test-runtime.js";

const csharpExecutableName =
  "CtlFlow.Audit.Auditd.Service";

export async function loadAuditdTestRuntime():
Promise<AuditdTestRuntime> {
  const implementation =
    process.env.CTLFLOW_TEST_IMPLEMENTATION ?? "csharp";
  if (implementation !== "csharp") {
    throw new Error(
      `Unsupported auditd implementation: ${implementation}`);
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
        imageName: "auditd-migrations",
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
        imageName: "auditd",
        containerfilePath: serviceContainerfilePath,
        migrationImage,
        kustomizeBasePath,
        storageDirectory: options.storageDirectory,
        storageFilePath: "/var/lib/ctlflow/auditd.sqlite",
        environment: options.environment,
        files: options.files,
        provision: options.provision
      });
    },
    stop: publication.stop
  };
}
