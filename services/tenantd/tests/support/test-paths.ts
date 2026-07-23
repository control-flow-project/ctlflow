import path from "node:path";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));

export const serviceRoot = path.resolve(directory, "../../..");
export const repositoryRoot = path.resolve(serviceRoot, "../..");
export const serviceProjectPath = path.join(
  serviceRoot,
  "csharp/src/CtlFlow.Tenancy.Tenantd.Service/"
    + "CtlFlow.Tenancy.Tenantd.Service.csproj");

export const diagnosticsManifestPath = path.join(
  serviceRoot,
  "csharp/nativeaot-diagnostics.json");
