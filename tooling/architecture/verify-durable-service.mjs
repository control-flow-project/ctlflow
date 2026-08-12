import {
  readdir,
  readFile
} from "node:fs/promises";
import path from "node:path";

const generatedDirectories = new Set([
  ".generated",
  "bin",
  "dist",
  "generated",
  "node_modules",
  "obj",
  "public",
  "resources"
]);

const nativeAotProperties = [
  "<PublishAot>true</PublishAot>",
  "<PublishTrimmed>true</PublishTrimmed>",
  "<TrimMode>full</TrimMode>",
  "<SelfContained>true</SelfContained>",
  "<IsAotCompatible>true</IsAotCompatible>",
  "<EnableAotAnalyzer>true</EnableAotAnalyzer>",
  "<EnableTrimAnalyzer>true</EnableTrimAnalyzer>",
  "<IlcTreatWarningsAsErrors>true</IlcTreatWarningsAsErrors>"
];

export async function verifyDurableService(serviceRoot) {
  const root = path.resolve(serviceRoot);
  const serviceName = path.basename(root);
  const sourceRoot = path.join(root, "csharp/src");
  const sourceFiles = await walk(sourceRoot);
  const projectFiles = sourceFiles.filter((file) => file.endsWith(".csproj"));
  const projects = classifyProjects(projectFiles, serviceName);

  await verifyDomain(projects.domain, sourceFiles, serviceName);
  await verifyDatabase(projects, sourceFiles, serviceName);
  await verifyService(projects, serviceName);
  await verifyContainer(root, projects.service, serviceName);
  await verifyMigrations(root, serviceName);
  await verifyLineLimits(root);

  process.stdout.write(`${serviceName} durable-service architecture verified\n`);
}

function classifyProjects(projectFiles, serviceName) {
  assert(
    projectFiles.length === 3,
    `${serviceName} must contain exactly Domain, Db, and Service projects`);
  const projects = {
    domain: projectFiles.find((file) => file.endsWith(".Domain.csproj")),
    database: projectFiles.find((file) => file.endsWith(".Db.csproj")),
    service: projectFiles.find((file) => file.endsWith(".Service.csproj"))
  };
  for (const [kind, file] of Object.entries(projects)) {
    assert(file !== undefined, `${serviceName} is missing its ${kind} project`);
  }
  return projects;
}

async function verifyDomain(projectFile, sourceFiles, serviceName) {
  const project = await read(projectFile);
  assert(
    !project.includes("PackageReference")
      && !project.includes("ProjectReference"),
    `${serviceName} Domain must remain BCL-only`);
  const sourceRoot = path.dirname(projectFile);
  const source = await readSources(sourceFiles, sourceRoot);
  const forbidden = [
    /Microsoft\.EntityFrameworkCore/u,
    /Microsoft\.AspNetCore/u,
    /Google\.Protobuf/u,
    /\bGrpc\./u,
    /\bDbContext\b/u,
    /\bDbSet\s*</u,
    /Environment\.GetEnvironmentVariable/u,
    /\busing\s+k8s(?:\.|;)/u,
    /\bIKubernetes\b/u
  ];
  for (const pattern of forbidden) {
    assert(
      !pattern.test(source),
      `${serviceName} Domain crosses an implementation boundary: ${pattern}`);
  }
}

async function verifyDatabase(projects, sourceFiles, serviceName) {
  const project = await read(projects.database);
  const references = projectReferences(project);
  assertSame(
    references,
    [path.basename(projects.domain)],
    `${serviceName} Db project references`);
  assert(
    !/(?:Google\.Protobuf|Grpc\.|Grpc<|Protobuf)/u.test(project),
    `${serviceName} Db project must not reference wire packages`);
  const sourceRoot = path.dirname(projects.database);
  const source = await readSources(sourceFiles, sourceRoot);
  const forbidden = [
    /Google\.Protobuf/u,
    /\bGrpc\./u,
    /Microsoft\.AspNetCore/u,
    /\.Service(?:\.|;)/u,
    /EnsureCreated(?:Async)?\s*\(/u,
    /\.Migrate(?:Async)?\s*\(/u
  ];
  for (const pattern of forbidden) {
    assert(
      !pattern.test(source),
      `${serviceName} Db crosses an ownership boundary: ${pattern}`);
  }
}

async function verifyService(projects, serviceName) {
  const project = await read(projects.service);
  assertSame(
    projectReferences(project),
    [
      path.basename(projects.domain),
      path.basename(projects.database)
    ].sort(),
    `${serviceName} Service project references`);
  for (const property of nativeAotProperties) {
    assert(
      project.includes(property),
      `${serviceName} Service is missing NativeAOT property ${property}`);
  }
  assert(
    !/(?:Microsoft\.EntityFrameworkCore\.(?:Sqlite|Design)|SQLitePCLRaw)/u
      .test(project),
    `${serviceName} Service must not own a database provider`);
}

async function verifyContainer(root, serviceProject, serviceName) {
  const source = await read(path.join(root, "csharp/Containerfile"));
  const diagnosticPath = `services/${serviceName}/csharp/nativeaot-diagnostics.json`;
  assert(
    source.includes("tooling/native/gated-publish.mjs")
      && source.includes(diagnosticPath)
      && source.includes(path.basename(serviceProject, ".csproj"))
      && source.includes("ENTRYPOINT"),
    `${serviceName} Containerfile must package its gated NativeAOT service`);
}

async function verifyMigrations(root, serviceName) {
  const migrationRoot = path.join(root, "migrations");
  const files = await walk(migrationRoot);
  const sources = files.filter((file) => file.endsWith(".ts"));
  assert(sources.length > 0, `${serviceName} must own TypeScript migrations`);
  const text = (await Promise.all(sources.map(read))).join("\n");
  assert(
    !/\b(?:create|drop)\s+trigger\b/iu.test(text)
      && !/\bcreate\s+(?:procedure|function)\b/iu.test(text),
    `${serviceName} migrations contain provider-resident behavior`);
}

async function verifyLineLimits(root) {
  for (const file of await walk(root)) {
    if (!/\.(?:cs|mjs|ts)$/u.test(file)) {
      continue;
    }
    const source = await read(file);
    const lines = source === ""
      ? 0
      : source.split(/\r?\n/u).length - (source.endsWith("\n") ? 1 : 0);
    assert(
      lines <= 600,
      `${path.relative(root, file)} has ${String(lines)} lines`);
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory() && !generatedDirectories.has(entry.name)) {
      files.push(...await walk(item));
    } else if (entry.isFile()) {
      files.push(item);
    }
  }
  return files.sort();
}

async function readSources(files, root) {
  const selected = files.filter((file) =>
    file.endsWith(".cs") && file.startsWith(`${root}${path.sep}`));
  return (await Promise.all(selected.map(read))).join("\n");
}

function projectReferences(project) {
  return [...project.matchAll(/<ProjectReference\s+Include="([^"]+)"/gu)]
    .map((match) => path.basename(match[1]))
    .sort();
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
