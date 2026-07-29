import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
  "CtlFlow.Egress.Egressd.Domain");
const serviceSourceRoot = path.join(
  sourceRoot,
  "CtlFlow.Egress.Egressd.Service");
const sourceFiles = await walk(sourceRoot);

assertSame(
  sourceFiles
    .filter((file) => file.endsWith(".csproj"))
    .map((file) => path.relative(sourceRoot, file)),
  [
    "CtlFlow.Egress.Egressd.Domain/CtlFlow.Egress.Egressd.Domain.csproj",
    "CtlFlow.Egress.Egressd.Service/CtlFlow.Egress.Egressd.Service.csproj"
  ],
  "C# production project inventory");
assert(
  !sourceFiles.some((file) =>
    /(?:^|[/\\])(?:Db|Migrations?)(?:[/\\]|$)/u.test(file)),
  "Stateless Egressd must not contain Db or migration source");

const domainProject = await read(path.join(
  domainRoot,
  "CtlFlow.Egress.Egressd.Domain.csproj"));
assert(
  !domainProject.includes("PackageReference")
    && !domainProject.includes("ProjectReference"),
  "Egressd Domain must remain BCL-only");
const serviceProject = await read(path.join(
  serviceSourceRoot,
  "CtlFlow.Egress.Egressd.Service.csproj"));
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
    `Egressd Service is missing NativeAOT property ${property}`);
}
assert(
  serviceProject.includes(
    "../CtlFlow.Egress.Egressd.Domain/"
      + "CtlFlow.Egress.Egressd.Domain.csproj"),
  "Egressd Service must reference Egressd Domain");
assert(
  !/(?:EntityFramework|DbContext|SQLite|Sqlite|Grpc\.)/u
    .test(serviceProject),
  "Stateless HTTP Egressd has an incompatible package");

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
  "Egressd Domain contains a wire or hosting dependency");
assert(
  !/(?:EnsureCreated|Database\.Migrate|DbContext|EntityFramework)/u
    .test(serviceSource),
  "Egressd shipping source contains a persistence path");
assert(
  !/(?:NotImplementedException|\bTODO\b|\bFIXME\b)/u.test(serviceSource),
  "Egressd shipping source contains unfinished behavior");
assert(
  !/(?:\bmock\b|\bfake\b|\bsubstitute\b|in[-_ ]?memory)/iu
    .test(serviceSource),
  "Egressd shipping source contains a substitute production path");
assert(
  !/(?:AuditService|PolicyService|RecordAudit|CheckCapability)/u
    .test(serviceSource),
  "Egressd must not call Auditd or Policyd");
assert(
  (serviceSource.match(/upstream\.SendAsync\(/gu) ?? []).length === 1,
  "Egressd must have exactly one upstream request path");

const runEgressd = await read(path.join(
  serviceSourceRoot,
  "Hosting/RunEgressd.cs"));
assert(
  (runEgressd.match(/application\.Run\(/gu) ?? []).length === 1
    && runEgressd.includes("options.AddServerHeader = false")
    && !/\bMap(?:Get|Methods|Post|Put|Patch|Delete)\s*\(/u
      .test(runEgressd),
  "Egressd must expose one header-minimal catch-all boundary");
const probeHandler = await read(path.join(
  serviceSourceRoot,
  "Http/HandleProbeRequest.cs"));
assert(
  probeHandler.includes('context.Request.Path == "/healthz"')
    && probeHandler.includes('context.Request.Path == "/readyz"'),
  "Egressd probe route inventory is invalid");
const privateHandler = await read(path.join(
  serviceSourceRoot,
  "Http/HandlePrivateRequest.cs"));
for (const value of [
  "MaximumTargetBytes = 16 * 1024",
  "MaximumHeaderBytes = 32 * 1024",
  '"GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS"'
]) {
  assert(
    privateHandler.includes(value),
    `Egressd private boundary is missing ${value}`);
}
const settings = await read(path.join(
  serviceSourceRoot,
  "Configuration/LoadServiceSettings.cs"));
assert(
  settings.includes("MaximumConcurrency = 256")
    && settings.includes(
      "MaximumUpstreamTimeoutMilliseconds = 300_000"),
  "Egressd concurrency or upstream lifetime is invalid");
const client = await read(path.join(
  serviceSourceRoot,
  "Proxy/CreateUpstreamClient.cs"));
assert(
  client.includes("AllowAutoRedirect = false")
    && client.includes("UseCookies = false")
    && client.includes("UseProxy = false")
    && client.includes("CreateNoOutputPropagator"),
  "Egressd upstream isolation is invalid");
const secretValue = await read(path.join(
  serviceSourceRoot,
  "Configuration/SecretValue.cs"));
const signedJwt = await read(path.join(
  serviceSourceRoot,
  "Security/Tokens/SignedJwt.cs"));
const program = await read(path.join(
  serviceSourceRoot,
  "Program.cs"));

const claimChecks = new Map([
  [
    "boundary-unexpected-failure-502",
    /catch \(Exception\)\s*\{\s*outcome = "boundary_failure";[\s\S]*?StatusCodes\.Status502BadGateway/u
      .test(privateHandler)
  ],
  [
    "sensitive-formatting-redacted",
    secretValue.includes('[DebuggerDisplay("[REDACTED]")]')
      && secretValue.includes(
        "[DebuggerBrowsable(DebuggerBrowsableState.Never)]")
      && secretValue.includes(
        'public override string ToString() => "[REDACTED]";')
      && signedJwt.includes('[DebuggerDisplay("[REDACTED JWT]")]')
      && signedJwt.includes(
        'public override string ToString() => "[REDACTED JWT]";')
  ],
  [
    "startup-failure-bounded",
    /catch \(Exception\)\s*\{\s*Console\.Error\.WriteLine\("Egressd startup failed\."\);\s*return 1;\s*\}/u
      .test(program)
  ],
  [
    "upstream-unexpected-failure-502",
    /catch \(Exception\)\s*\{\s*dependencyOutcome = "upstream_failure";[\s\S]*?StatusCodes\.Status502BadGateway/u
      .test(privateHandler)
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
      "services/egressd/csharp/nativeaot-diagnostics.json")
    && containerfile.includes(
      'ENTRYPOINT ["/app/CtlFlow.Egress.Egressd.Service"]'),
  "Egressd Containerfile must package the gated NativeAOT executable");
await verifyLineLimits();
process.stdout.write("egressd implementation architecture verified\n");

async function verifyLineLimits() {
  const roots = [
    serviceRoot,
    path.join(repositoryRoot, "testing/mesh/src/platforms/csharp")
  ];
  for (const root of roots) {
    for (const file of await walk(root)) {
      if (!/\.(?:cs|mjs|ts)$/u.test(file)
          || /[/\\](?:bin|dist|generated|obj|\.generated)[/\\]/u
            .test(file)) {
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
      if (!["bin", "dist", "generated", "obj", ".generated"]
        .includes(entry.name)) {
        files.push(...await walk(item));
      }
    } else if (entry.isFile()) {
      files.push(item);
    }
  }
  return files.sort();
}

async function readSources(files) {
  const values = [];
  for (const file of files) {
    values.push(await read(file));
  }
  return values.join("\n");
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
