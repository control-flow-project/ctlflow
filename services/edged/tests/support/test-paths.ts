import path from "node:path";
import { fileURLToPath } from "node:url";

const supportDirectory =
  path.dirname(fileURLToPath(import.meta.url));

export const serviceRoot = path.resolve(
  supportDirectory,
  "../../..");
export const repositoryRoot = path.resolve(serviceRoot, "../..");
export const csharpRoot = path.join(serviceRoot, "csharp");
export const serviceProjectPath = path.join(
  csharpRoot,
  "src",
  "CtlFlow.Edge.Edged.Service",
  "CtlFlow.Edge.Edged.Service.csproj");
export const serviceContainerfilePath = path.join(
  csharpRoot,
  "Containerfile");
export const diagnosticsManifestPath = path.join(
  csharpRoot,
  "nativeaot-diagnostics.json");
export const kustomizeBasePath = path.join(
  serviceRoot,
  "tests/kubernetes/base");
export const applicationContainerfilePath = path.join(
  serviceRoot,
  "testing/application/node/Containerfile");
