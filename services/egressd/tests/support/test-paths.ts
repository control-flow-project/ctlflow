import path from "node:path";
import {
  fileURLToPath
} from "node:url";

export const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..");
export const repositoryRoot = path.resolve(serviceRoot, "../..");
export const serviceProjectPath = path.join(
  serviceRoot,
  "csharp/src/CtlFlow.Egress.Egressd.Service/"
    + "CtlFlow.Egress.Egressd.Service.csproj");
export const diagnosticsManifestPath = path.join(
  serviceRoot,
  "csharp/nativeaot-diagnostics.json");
export const serviceContainerfilePath = path.join(
  serviceRoot,
  "csharp/Containerfile");
export const kustomizeBasePath = path.join(
  serviceRoot,
  "kubernetes/base");
