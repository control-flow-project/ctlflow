import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export const serviceRoot = path.resolve(directory, "../../..");
export const repositoryRoot = path.resolve(serviceRoot, "../..");
export const serviceProjectPath = path.join(
  serviceRoot,
  "csharp/src/CtlFlow.Configuration.Configd.Service/"
    + "CtlFlow.Configuration.Configd.Service.csproj");
export const diagnosticsManifestPath = path.join(
  serviceRoot,
  "csharp/nativeaot-diagnostics.json");
export const serviceContainerfilePath = path.join(
  serviceRoot,
  "csharp/Containerfile");
export const migrationContainerfilePath = path.join(
  serviceRoot,
  "migrations/Containerfile");
export const kustomizeBasePath = path.join(
  serviceRoot,
  "kubernetes/base");
