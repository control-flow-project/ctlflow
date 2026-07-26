import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  publishCSharpService,
  runCommand
} from "../../../../testing/mesh/dist/index.js";

const testsRoot = path.dirname(fileURLToPath(import.meta.url));
const csharpRoot = path.resolve(testsRoot, "..");
const serviceRoot = path.resolve(csharpRoot, "..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const outputRoot = path.join(
  repositoryRoot,
  ".temp",
  "tests",
  "tenantd",
  "model-audit");
await mkdir(outputRoot, { recursive: true });
const directory = await mkdtemp(path.join(outputRoot, "audit-"));
const databasePath = path.join(directory, "tenantd.sqlite");
const modelAuditProject = path.join(
  testsRoot,
  "CtlFlow.Tenancy.Tenantd.IntegrationTests",
  "CtlFlow.Tenancy.Tenantd.IntegrationTests.csproj");
const modelAuditDiagnostics = path.join(
  testsRoot,
  "nativeaot-diagnostics.json");
const serviceProject = path.join(
  csharpRoot,
  "src",
  "CtlFlow.Tenancy.Tenantd.Service",
  "CtlFlow.Tenancy.Tenantd.Service.csproj");
const serviceDiagnostics = path.join(
  csharpRoot,
  "nativeaot-diagnostics.json");

await runCommand("node", [
  path.join(
    serviceRoot,
    ".generated",
    "migrations",
    "tooling",
    "migrations",
    "run.js")
], {
  cwd: repositoryRoot,
  environment: {
    CTLFLOW_DATABASE_PATH: databasePath
  }
});
const modelAuditPublication = await publishCSharpService({
  repositoryRoot,
  projectPath: modelAuditProject,
  diagnosticsManifestPath: modelAuditDiagnostics,
  executableName: "CtlFlow.Tenancy.Tenantd.IntegrationTests"
});
const result = await runCommand(
  modelAuditPublication.executablePath,
  [databasePath],
  { cwd: repositoryRoot });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
const servicePublication = await publishCSharpService({
  repositoryRoot,
  projectPath: serviceProject,
  diagnosticsManifestPath: serviceDiagnostics,
  executableName: "CtlFlow.Tenancy.Tenantd.Service"
});
await assert.rejects(
  runCommand(
    servicePublication.executablePath,
    [],
    {
      cwd: repositoryRoot,
      environment: {
        CTLFLOW_GRPC_URL: "https://127.0.0.1:50051",
        CTLFLOW_PROBE_URL: "http://127.0.0.1:8080",
        CTLFLOW_DATABASE_PROVIDER: "postgresql",
        CTLFLOW_DATABASE_PATH: databasePath
      }
    }),
  /Database provider must name an implemented provider/);
process.stdout.write("tenantd rejected an unimplemented database provider\n");
await modelAuditPublication.stop();
await servicePublication.stop();
