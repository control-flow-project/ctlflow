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
const project = path.join(
  testsRoot,
  "CtlFlow.Tenancy.Tenantd.IntegrationTests",
  "CtlFlow.Tenancy.Tenantd.IntegrationTests.csproj");
const diagnosticsManifest = path.join(
  testsRoot,
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
const publication = await publishCSharpService({
  repositoryRoot,
  projectPath: project,
  diagnosticsManifestPath: diagnosticsManifest,
  executableName: "CtlFlow.Tenancy.Tenantd.IntegrationTests"
});
const result = await runCommand(
  publication.executablePath,
  [databasePath],
  { cwd: repositoryRoot });
process.stdout.write(result.stdout);
process.stderr.write(result.stderr);
await publication.stop();
