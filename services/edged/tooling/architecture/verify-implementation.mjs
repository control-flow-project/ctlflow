import {
  readdir,
  readFile
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  architectureClaims
} from "./architecture-claims.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const csharpRoot = path.join(serviceRoot, "csharp");
const sourceRoot = path.join(csharpRoot, "src");
const domainRoot = path.join(
  sourceRoot,
  "CtlFlow.Edge.Edged.Domain");
const serviceSourceRoot = path.join(
  sourceRoot,
  "CtlFlow.Edge.Edged.Service");

const sourceFiles = await walk(sourceRoot);
assertSame(
  sourceFiles
    .filter((file) => file.endsWith(".csproj"))
    .map((file) => path.relative(sourceRoot, file)),
  [
    "CtlFlow.Edge.Edged.Domain/CtlFlow.Edge.Edged.Domain.csproj",
    "CtlFlow.Edge.Edged.Service/CtlFlow.Edge.Edged.Service.csproj"
  ],
  "C# production project inventory");
assert(
  !sourceFiles.some((file) =>
    /(?:^|[/\\])(?:Db|Migrations?)(?:[/\\]|$)/u.test(file)),
  "Stateless Edged must not contain Db or migration source");

const domainProject = await read(path.join(
  domainRoot,
  "CtlFlow.Edge.Edged.Domain.csproj"));
assert(
  !domainProject.includes("PackageReference")
    && !domainProject.includes("ProjectReference"),
  "Edged Domain must remain BCL-only");

const serviceProject = await read(path.join(
  serviceSourceRoot,
  "CtlFlow.Edge.Edged.Service.csproj"));
for (const property of [
  "<PublishAot>true</PublishAot>",
  "<PublishTrimmed>true</PublishTrimmed>",
  "<TrimMode>full</TrimMode>",
  "<SelfContained>true</SelfContained>",
  "<OptimizationPreference>Speed</OptimizationPreference>",
  "<IsAotCompatible>true</IsAotCompatible>",
  "<EnableAotAnalyzer>true</EnableAotAnalyzer>",
  "<EnableTrimAnalyzer>true</EnableTrimAnalyzer>",
  "<IlcTreatWarningsAsErrors>true</IlcTreatWarningsAsErrors>"
]) {
  assert(
    serviceProject.includes(property),
    `Edged Service is missing NativeAOT property ${property}`);
}
assert(
  serviceProject.includes(
    "../CtlFlow.Edge.Edged.Domain/CtlFlow.Edge.Edged.Domain.csproj"),
  "Edged Service must reference Edged Domain");
assert(
  !/(?:EntityFramework|DbContext|SQLite|Sqlite)/u.test(serviceProject),
  "Stateless Edged must not reference a database provider");

const domainSource = await readSources(
  sourceFiles.filter((file) =>
    file.startsWith(`${domainRoot}${path.sep}`)
      && file.endsWith(".cs")));
const serviceSource = await readSources(
  sourceFiles.filter((file) =>
    file.startsWith(`${serviceSourceRoot}${path.sep}`)
      && file.endsWith(".cs")));
assert(
  !/(?:Google\.Protobuf|Grpc\.|Microsoft\.AspNetCore)/u.test(domainSource),
  "Edged Domain contains a wire or hosting dependency");
assert(
  !/(?:EnsureCreated|Database\.Migrate|DbContext|EntityFramework)/u
    .test(serviceSource),
  "Edged shipping source contains a persistence path");
assert(
  !/(?:NotImplementedException|\bTODO\b|\bFIXME\b)/u.test(serviceSource),
  "Edged shipping source contains unfinished behavior");
assert(
  !/(?:\bmock\b|\bfake\b|\bsubstitute\b|in[-_ ]?memory)/iu
    .test(serviceSource),
  "Edged shipping source contains a substitute production path");
assert(
  !/(?:AuditService|PolicyService|RecordAudit|CheckCapability)/u
    .test(serviceSource),
  "Edged must not call Auditd or Policyd");
assert(
  (serviceSource.match(/\.ExchangeSessionAsync\(/gu) ?? []).length === 1,
  "Edged must have exactly one Identityd Session exchange path");
assert(
  (serviceSource.match(/application\.SendAsync\(/gu) ?? []).length === 1,
  "Edged must have exactly one loopback application request path");

const runEdged = await read(path.join(
  serviceSourceRoot,
  "Hosting/RunEdged.cs"));
assert(
  (runEdged.match(/application\.Run\(/gu) ?? []).length === 1
    && !/\bMap(?:Get|Methods|Post|Put|Patch|Delete)\s*\(/u
      .test(runEdged),
  "Edged must expose one catch-all public boundary");
const probeHandler = await read(path.join(
  serviceSourceRoot,
  "Http/HandleProbeRequest.cs"));
assert(
  probeHandler.includes('context.Request.Path == "/healthz"')
    && probeHandler.includes('context.Request.Path == "/readyz"'),
  "Edged probe route inventory is invalid");

const publicHandler = await read(path.join(
  serviceSourceRoot,
  "Http/HandlePublicRequest.cs"));
for (const value of [
  "MaximumTargetBytes = 16 * 1024",
  "MaximumHeaderBytes = 32 * 1024",
  "MaximumCookieBytes = 8 * 1024",
  "MaximumBodyBytes = 64L * 1024 * 1024",
  '"GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"'
]) {
  assert(
    publicHandler.includes(value),
    `Edged public boundary is missing ${value}`);
}

const settings = await read(path.join(
  serviceSourceRoot,
  "Configuration/LoadServiceSettings.cs"));
assert(
  settings.includes("MaximumConcurrency = 256")
    && settings.includes(
      "MaximumApplicationTimeoutMilliseconds = 3_600_000")
    && settings.includes(
      '$"http://127.0.0.1:{binding.ApplicationPort.Value}"'),
  "Edged concurrency, lifetime, or loopback binding is invalid");

const claimChecks = new Map([
  [
    "application-unexpected-failure-502",
    /catch \(Exception\)\s*\{\s*dependencyOutcome = "application_failure";[\s\S]*?StatusCodes\.Status502BadGateway/u
      .test(publicHandler)
  ],
  [
    "boundary-unexpected-failure-502",
    /catch \(Exception\)\s*\{\s*outcome = "boundary_failure";[\s\S]*?StatusCodes\.Status502BadGateway/u
      .test(publicHandler)
  ]
]);
assertSame(
  [...claimChecks.keys()],
  architectureClaims,
  "architecture claim inventory");
for (const [claim, satisfied] of claimChecks) {
  assert(satisfied, `Architecture claim is not satisfied: ${claim}`);
}

const containerfile = await read(path.join(csharpRoot, "Containerfile"));
assert(
  containerfile.includes("tooling/native/gated-publish.mjs")
    && containerfile.includes(
      "services/edged/csharp/nativeaot-diagnostics.json")
    && containerfile.includes(
      'ENTRYPOINT ["/app/CtlFlow.Edge.Edged.Service"]'),
  "Edged Containerfile must package the gated NativeAOT executable");

await verifyLineLimits();
process.stdout.write("edged implementation architecture verified\n");

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
