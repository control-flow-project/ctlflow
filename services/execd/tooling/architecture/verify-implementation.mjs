import {
  readdir,
  readFile
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const csharpRoot = path.join(serviceRoot, "csharp");
const sourceRoot = path.join(csharpRoot, "src");
const domainRoot = path.join(
  sourceRoot,
  "CtlFlow.Execution.Execd.Domain");
const databaseRoot = path.join(
  sourceRoot,
  "CtlFlow.Execution.Execd.Db");
const hostRoot = path.join(
  sourceRoot,
  "CtlFlow.Execution.Execd.Service");

const sourceFiles = await walk(sourceRoot);
assertSame(
  sourceFiles
    .filter((file) => file.endsWith(".csproj"))
    .map((file) => path.relative(sourceRoot, file)),
  [
    "CtlFlow.Execution.Execd.Db/CtlFlow.Execution.Execd.Db.csproj",
    "CtlFlow.Execution.Execd.Domain/CtlFlow.Execution.Execd.Domain.csproj",
    "CtlFlow.Execution.Execd.Service/CtlFlow.Execution.Execd.Service.csproj"
  ],
  "C# production project inventory");

const domainProject = await read(path.join(
  domainRoot,
  "CtlFlow.Execution.Execd.Domain.csproj"));
assert(
  !domainProject.includes("PackageReference")
    && !domainProject.includes("ProjectReference"),
  "Execd Domain must remain BCL-only");

const databaseProject = await read(path.join(
  databaseRoot,
  "CtlFlow.Execution.Execd.Db.csproj"));
for (const dependency of [
  "Microsoft.EntityFrameworkCore",
  "Microsoft.EntityFrameworkCore.Design",
  "Microsoft.EntityFrameworkCore.Sqlite",
  "Microsoft.EntityFrameworkCore.Tasks"
]) {
  assert(
    databaseProject.includes(dependency),
    `Execd Db is missing ${dependency}`);
}
assert(
  databaseProject.includes(
    "../CtlFlow.Execution.Execd.Domain/CtlFlow.Execution.Execd.Domain.csproj"),
  "Execd Db must reference Execd Domain");

const hostProject = await read(path.join(
  hostRoot,
  "CtlFlow.Execution.Execd.Service.csproj"));
for (const property of [
  "<PublishAot>true</PublishAot>",
  "<PublishTrimmed>true</PublishTrimmed>",
  "<TrimMode>full</TrimMode>",
  "<SelfContained>true</SelfContained>",
  "<OptimizationPreference>Speed</OptimizationPreference>",
  "<IsAotCompatible>true</IsAotCompatible>",
  "<EnableAotAnalyzer>true</EnableAotAnalyzer>",
  "<EnableTrimAnalyzer>true</EnableTrimAnalyzer>",
  "<IlcTreatWarningsAsErrors>true</IlcTreatWarningsAsErrors>",
  "<EFScaffoldModelStage>none</EFScaffoldModelStage>",
  "<EFPrecompileQueriesStage>none</EFPrecompileQueriesStage>"
]) {
  assert(
    hostProject.includes(property),
    `Execd Service is missing required property ${property}`);
}
for (const project of [
  "../CtlFlow.Execution.Execd.Domain/CtlFlow.Execution.Execd.Domain.csproj",
  "../CtlFlow.Execution.Execd.Db/CtlFlow.Execution.Execd.Db.csproj"
]) {
  assert(
    hostProject.includes(project),
    `Execd Service is missing project reference ${project}`);
}

const domainSource = await readSources(
  sourceFiles.filter((file) =>
    file.startsWith(`${domainRoot}${path.sep}`)
      && file.endsWith(".cs")));
const databaseSource = await readSources(
  sourceFiles.filter((file) =>
    file.startsWith(`${databaseRoot}${path.sep}`)
      && file.endsWith(".cs")));
const hostSource = await readSources(
  sourceFiles.filter((file) =>
    file.startsWith(`${hostRoot}${path.sep}`)
      && file.endsWith(".cs")));
const allSource = `${domainSource}\n${databaseSource}\n${hostSource}`;

assert(
  !/(?:Google\.Protobuf|Grpc\.|Microsoft\.EntityFrameworkCore|using\s+.*\.Kubernetes(?:\.|;)|namespace\s+.*\.Kubernetes(?:\.|;))/u.test(
    domainSource),
  "Execd Domain contains a wire, persistence, or Kubernetes dependency");
assert(
  !/(?:FromSql|SqlQuery|ExecuteSql|SqliteCommand|DbCommand)/u
    .test(databaseSource),
  "Execd Db contains a forbidden raw-SQL or ADO.NET path");
assert(
  !/\bnew\s+(?:Placement|Workload|Run)\s*\(/u.test(databaseSource),
  "Execd Db directly constructs a mapped aggregate");
assert(
  !/(?:EnsureCreated|Database\.Migrate)\s*\(/u.test(allSource),
  "Execd shipping source must not create or migrate schema");
assert(
  !/(?:NotImplementedException|\bTODO\b|\bFIXME\b)/u.test(allSource),
  "Execd shipping source contains unfinished behavior");
assert(
  !/(?:\bmock\b|\bfake\b|\bsubstitute\b|in[-_ ]?memory)/iu.test(allSource),
  "Execd shipping source contains a substitute production path");

const migrationSource = await read(path.join(
  serviceRoot,
  "migrations/0001_create_execution.ts"));
assert(
  !/(?:createTrigger|CREATE\s+TRIGGER|stored\s+procedure)/iu
    .test(migrationSource),
  "Execd migration contains database-resident domain behavior");

const proto = await read(path.join(
  serviceRoot,
  "api/proto/v1/execd.proto"));
assertSame(
  [...proto.matchAll(/\brpc\s+([A-Za-z0-9]+)\s*\(/gu)]
    .map((match) => match[1]),
  [
    "DeclarePlacement",
    "GetPlacement",
    "ListPlacements",
    "DeclareWorkload",
    "GetWorkload",
    "ListWorkloads",
    "CreateRun",
    "GetRun",
    "ListRuns",
    "CancelRun",
    "ResolveWorkloadOperationBinding"
  ],
  "Execd RPC inventory");
assert(
  !/\brpc\s+\w+\s*\([^)]*\)\s+returns\s*\(\s*stream\b/gu.test(proto),
  "Execd RPC surface must remain unary");

assertSame(
  [...hostSource.matchAll(
    /public\s+override\s+(?:async\s+)?Task<[^>]+>\s+([A-Za-z0-9]+)\s*\(/gu)]
    .map((match) => match[1])
    .sort(),
  [
    "CancelRun",
    "CreateRun",
    "DeclarePlacement",
    "DeclareWorkload",
    "GetPlacement",
    "GetRun",
    "GetWorkload",
    "ListPlacements",
    "ListRuns",
    "ListWorkloads",
    "ResolveWorkloadOperationBinding"
  ],
  "shipping gRPC operation inventory");

const runExecd = await read(path.join(
  hostRoot,
  "Hosting/RunExecd.cs"));
assertSame(
  [...runExecd.matchAll(/application\.MapGet\(\s*"([^"]+)"/gu)]
    .map((match) => match[1]),
  ["/healthz", "/readyz"],
  "probe route inventory");
assert(
  (runExecd.match(/MapGrpcService<ExecutionGrpcService>/gu) ?? [])
    .length === 1,
  "Execd must map one ExecutionService implementation");
assert(
  !/\bMap(?:Methods|Post|Put|Patch|Delete)\s*\(/u.test(hostSource),
  "Execd must not expose an HTTP domain API");

const containerfile = await read(path.join(csharpRoot, "Containerfile"));
assert(
  containerfile.includes("tooling/native/gated-publish.mjs")
    && containerfile.includes(
      "services/execd/csharp/nativeaot-diagnostics.json")
    && containerfile.includes(
      'ENTRYPOINT ["/app/CtlFlow.Execution.Execd.Service"]'),
  "Execd Containerfile must package the gated NativeAOT executable");

await verifyLineLimits();
process.stdout.write("execd implementation architecture verified\n");

async function verifyLineLimits() {
  const roots = [
    serviceRoot,
    path.join(repositoryRoot, "testing/mesh/src/platforms/csharp")
  ];
  for (const root of roots) {
    for (const file of await walk(root)) {
      if (!/\.(?:cs|mjs|ts)$/u.test(file)
          || /[/\\](?:bin|dist|generated|obj|\.generated)[/\\]/u.test(file)) {
        continue;
      }
      const lines = (await read(file)).split("\n").length - 1;
      assert(
        lines <= 600,
        `${path.relative(repositoryRoot, file)} has ${String(lines)} lines`);
    }
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, {
    withFileTypes: true
  })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (![
        "bin",
        "dist",
        "generated",
        "obj",
        ".generated"
      ].includes(entry.name)) {
        files.push(...await walk(item));
      }
    } else if (entry.isFile()) {
      files.push(item);
    }
  }
  return files.sort();
}

async function readSources(files) {
  return (await Promise.all(files.map(read))).join("\n");
}

async function read(file) {
  return await readFile(file, "utf8");
}

function assertSame(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} mismatch: expected ${JSON.stringify(expected)}, `
      + `found ${JSON.stringify(actual)}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
