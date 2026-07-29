import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export const serviceRoot = path.resolve(directory, "../../..");
export const repositoryRoot = path.resolve(serviceRoot, "../..");

export interface ServicePaths {
  readonly serviceRoot: string;
  readonly projectPath: string;
  readonly diagnosticsManifestPath: string;
  readonly serviceContainerfilePath: string;
  readonly migrationContainerfilePath: string;
  readonly kustomizeBasePath: string;
  readonly executableName: string;
  readonly storageFilePath: string;
}

export const execdPaths = createServicePaths(
  "execd",
  "CtlFlow.Execution.Execd.Service",
  "execd.sqlite");
export const pkgdPaths = createServicePaths(
  "pkgd",
  "CtlFlow.Packages.Pkgd.Service",
  "pkgd.sqlite");
export const configdPaths = createServicePaths(
    "configd",
    "CtlFlow.Configuration.Configd.Service",
    "configd.sqlite");

export const edgedProjectPath = path.join(
  repositoryRoot,
  "services",
  "edged",
  "csharp",
  "src",
  "CtlFlow.Edge.Edged.Service",
  "CtlFlow.Edge.Edged.Service.csproj");
export const edgedDiagnosticsManifestPath = path.join(
  repositoryRoot,
  "services",
  "edged",
  "csharp",
  "nativeaot-diagnostics.json");
export const edgedContainerfilePath = path.join(
  repositoryRoot,
  "services",
  "edged",
  "csharp",
  "Containerfile");
export const applicationContainerfilePath = path.join(
  serviceRoot,
  "testing",
  "application",
  "node",
  "Containerfile");

function createServicePaths(
  serviceName: string,
  executableName: string,
  storageFileName: string
): ServicePaths {
  const currentRoot = path.join(
    repositoryRoot,
    "services",
    serviceName);
  return {
    serviceRoot: currentRoot,
    projectPath: path.join(
      currentRoot,
      "csharp",
      "src",
      executableName,
      `${executableName}.csproj`),
    diagnosticsManifestPath: path.join(
      currentRoot,
      "csharp",
      "nativeaot-diagnostics.json"),
    serviceContainerfilePath: path.join(
      currentRoot,
      "csharp",
      "Containerfile"),
    migrationContainerfilePath: path.join(
      currentRoot,
      "migrations",
      "Containerfile"),
    kustomizeBasePath: path.join(
      currentRoot,
      "kubernetes",
      "base"),
    executableName,
    storageFilePath: `/var/lib/ctlflow/${storageFileName}`
  };
}
