import {
  readdir,
  readFile
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  parseDocument
} from "yaml";
import {
  architectureClaims
} from "./architecture-claims.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const csharpRoot = path.join(serviceRoot, "csharp");
const sourceRoot = path.join(csharpRoot, "src");
const serviceSource = path.join(
  sourceRoot,
  "CtlFlow.Auth.Authd.Service");
const domainSource = path.join(
  sourceRoot,
  "CtlFlow.Auth.Authd.Domain");

const sourceFiles = await walk(sourceRoot);
assertSame(
  sourceFiles
    .filter((file) => file.endsWith(".csproj"))
    .map((file) => path.relative(sourceRoot, file)),
  [
    "CtlFlow.Auth.Authd.Domain/CtlFlow.Auth.Authd.Domain.csproj",
    "CtlFlow.Auth.Authd.Service/CtlFlow.Auth.Authd.Service.csproj"
  ],
  "C# production project inventory");
assert(
  !sourceFiles.some((file) =>
    /(?:^|[/\\])(?:Db|Migrations?)(?:[/\\]|$)/u.test(file)),
  "Authd must not contain Db or migration source");

const domainProject = await read(
  path.join(
    domainSource,
    "CtlFlow.Auth.Authd.Domain.csproj"));
assert(
  !domainProject.includes("PackageReference"),
  "Authd Domain must remain BCL-only");
const serviceProject = await read(
  path.join(
    serviceSource,
    "CtlFlow.Auth.Authd.Service.csproj"));
for (const property of [
  "<PublishAot>true</PublishAot>",
  "<PublishTrimmed>true</PublishTrimmed>",
  "<TrimMode>full</TrimMode>",
  "<SelfContained>true</SelfContained>",
  "<IsAotCompatible>true</IsAotCompatible>",
  "<EnableAotAnalyzer>true</EnableAotAnalyzer>",
  "<EnableTrimAnalyzer>true</EnableTrimAnalyzer>",
  "<IlcTreatWarningsAsErrors>true</IlcTreatWarningsAsErrors>"
]) {
  assert(
    serviceProject.includes(property),
    `Authd Service is missing NativeAOT property ${property}`);
}
assert(
  serviceProject.includes(
    "../CtlFlow.Auth.Authd.Domain/CtlFlow.Auth.Authd.Domain.csproj"),
  "Authd Service must reference Authd Domain");
assert(
  !/(?:EntityFramework|DbContext|SQLite|Sqlite)/u.test(serviceProject),
  "Stateless Authd must not reference a database provider");

const containerfile = await read(
  path.join(csharpRoot, "Containerfile"));
assert(
  containerfile.includes("tooling/native/gated-publish.mjs")
    && containerfile.includes(
      "services/authd/csharp/nativeaot-diagnostics.json")
    && containerfile.includes(
      'ENTRYPOINT ["/app/CtlFlow.Auth.Authd.Service"]'),
  "Authd Containerfile must package the gated NativeAOT executable");

const allServiceSource = await readSources(
  sourceFiles.filter((file) => file.endsWith(".cs")));
assert(
  !/(?:refresh_token|discovery|introspection|jwks|provider_catalog)/iu
    .test(allServiceSource),
  "Authd production source contains an unapproved provider capability");
assert(
  !allServiceSource.includes("ctlflow-invocation"),
  "Authd Identityd calls must omit the invocation JWT");

const runAuthd = await read(path.join(
  serviceSource,
  "Hosting/RunAuthd.cs"));
assertSame(
  [...allServiceSource.matchAll(
    /\bapplication\.(Map[A-Za-z0-9]+)\(/gu)]
    .map((match) => match[1]),
  ["MapMethods", "MapMethods", "MapMethods", "MapGet", "MapGet"],
  "shipping endpoint-mapping inventory");
const mappedRoutes = [
  ...runAuthd.matchAll(
    /application\.MapMethods\(\s*"([^"]+)",\s*\[HttpMethods\.([A-Za-z]+)\]/gu)
].map((match) => [
  match[2].toUpperCase(),
  match[1]
]);
assertSame(
  mappedRoutes,
  [
    ["POST", "/auth/v1/begin"],
    ["GET", "/auth/v1/callback"],
    ["POST", "/auth/v1/logout"]
  ],
  "shipping public route inventory");
assertSame(
  [...runAuthd.matchAll(
    /application\.MapGet\("([^"]+)"/gu)]
    .map((match) => match[1]),
  ["/healthz", "/readyz"],
  "probe route inventory");
assert(
  (allServiceSource.match(/\.SendAsync\(/gu) ?? []).length === 1
    && await hasPurposeBoundEgress(),
  "Provider HTTP must use only the purpose-bound Egressd hop");
assertSame(
  [...allServiceSource.matchAll(
    /\bclient\.(CreateSession|RevokeSession)Async\(/gu)]
    .map((match) => match[1]),
  ["CreateSession", "RevokeSession"],
  "Authd Identityd call inventory");
const telemetryConfiguration = await read(path.join(
  serviceSource,
  "Telemetry/ConfigureTelemetry.cs"));
assert(
  telemetryConfiguration.includes("options.IncludeScopes = false;")
    && !telemetryConfiguration.includes(
      "options.IncludeScopes = true;"),
  "Authd logs must not inherit request scopes");

const claimChecks = new Map([
  [
    "begin-unexpected-failure-500",
    await hasUnexpectedFailureMapping("Http/BeginAuthentication.cs")
  ],
  [
    "callback-unexpected-failure-500",
    await hasUnexpectedFailureMapping("Http/CompleteProviderCallback.cs")
  ],
  [
    "logout-unexpected-failure-500",
    await hasUnexpectedFailureMapping("Http/Logout.cs")
  ],
  [
    "bounded-in-process-state",
    await hasBoundedState()
  ]
]);
assertSame(
  [...claimChecks.keys()],
  architectureClaims,
  "architecture claim inventory");
for (const [claim, satisfied] of claimChecks) {
  assert(satisfied, `Architecture claim is not satisfied: ${claim}`);
}

await verifyKubernetesBase();
await verifyLineLimits();
process.stdout.write(
  "authd implementation architecture verified\n");

async function hasUnexpectedFailureMapping(relativePath) {
  const source = await read(path.join(serviceSource, relativePath));
  return /_ => \(StatusCodes\.Status500InternalServerError,\s*"internal"/u
    .test(source);
}

async function hasPurposeBoundEgress() {
  const request = await read(path.join(
    serviceSource,
    "Egress/SendEgressRequest.cs"));
  const provider = await read(path.join(
    serviceSource,
    "Configuration/ProviderRegistration.cs"));
  return request.includes(
    "provider.EgressOrigin.AbsoluteUri.TrimEnd('/')")
    && request.includes('"Proxy-Authorization"')
    && request.includes('"egressd"')
    && !request.includes("request.Headers.Host")
    && provider.includes(
      'new($"http://{EgressBinding}:8081/", UriKind.Absolute)');
}

async function hasBoundedState() {
  const state = await read(path.join(
    serviceSource,
    "State/AuthenticationAttemptStore.cs"));
  const admission = await read(path.join(
    serviceSource,
    "Admission/PublicAdmission.cs"));
  return state.includes("MaximumAttempts = 4_096")
    && state.includes("_attempts.Count >= MaximumAttempts")
    && state.includes("Status429TooManyRequests")
    && admission.includes("PublicCapacity = 128")
    && admission.includes("CallbackCapacity = 32")
    && admission.includes("new(20, 2)")
    && admission.includes("new(40, 4)");
}

async function verifyKubernetesBase() {
  const base = path.join(serviceRoot, "kubernetes/base");
  const files = (await readdir(base))
    .filter((file) => file.endsWith(".yaml"))
    .sort();
  assertSame(
    files,
    [
      "deployment.yaml",
      "kustomization.yaml",
      "probe-service.yaml",
      "service-account.yaml",
      "service.yaml"
    ],
    "Kubernetes base file inventory");
  const resources = [];
  for (const file of files) {
    const document = parseDocument(await read(path.join(base, file)), {
      strict: true,
      uniqueKeys: true
    });
    assert(
      document.errors.length === 0
        && document.warnings.length === 0,
      `Kubernetes YAML is invalid: ${file}`);
    resources.push(document.toJS({ maxAliasCount: 0 }));
  }
  assertSame(
    resources.map((item) => [item.kind, item.metadata?.name ?? ""]),
    [
      ["Deployment", "authd"],
      ["Kustomization", ""],
      ["Service", "authd-probe"],
      ["ServiceAccount", "authd"],
      ["Service", "authd"]
    ],
    "Kubernetes resource inventory");
  const deployment = resources[0];
  const pod = deployment.spec?.template?.spec;
  const container = pod?.containers?.[0];
  assert(
    deployment.spec?.replicas === 1
      && pod?.serviceAccountName === "authd"
      && pod?.securityContext?.fsGroup === 65_532
      && container?.ports?.some(
        (item) => item.name === "public"
          && item.containerPort === 8_081)
      && container?.ports?.some(
        (item) => item.name === "probe"
          && item.containerPort === 8_080),
    "Authd Deployment listener or workload identity is invalid");
  assertSame(
    pod.volumes.map((item) => item.name),
    [
      "provider-config",
      "provider-secrets",
      "trust",
      "workload-token",
      "tmp"
    ],
    "Authd Deployment volume inventory");
}

async function verifyLineLimits() {
  const roots = [
    serviceRoot,
    path.join(repositoryRoot, "services/egressd"),
    path.join(repositoryRoot, "testing/mesh/src/platforms/csharp")
  ];
  for (const root of roots) {
    for (const file of await walk(root)) {
      if (!/\.(?:cs|mjs|ts)$/u.test(file)
          || /[/\\](?:bin|dist|obj|\.generated)[/\\]/u.test(file)) {
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
      if (!["bin", "dist", "obj", ".generated"].includes(entry.name)) {
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
