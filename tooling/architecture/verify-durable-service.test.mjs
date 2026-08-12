import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import {
  test
} from "node:test";
import {
  verifyDurableService
} from "./verify-durable-service.mjs";

const temporaryRoot = path.resolve(".temp/tooling/architecture");

test("accepts the canonical durable-service architecture", async () => {
  await withFixture(async (root) => {
    await verifyDurableService(root);
  });
});

test("rejects a Domain package dependency", async () => {
  await withFixture(async (root, projects) => {
    await writeFile(
      projects.domain,
      "<Project><ItemGroup><PackageReference Include=\"Unsafe\" />"
        + "</ItemGroup></Project>\n");
    await assert.rejects(
      verifyDurableService(root),
      /Domain must remain BCL-only/u);
  });
});

test("rejects a Db reference to Service", async () => {
  await withFixture(async (root, projects) => {
    await writeFile(
      projects.database,
      project([
        projects.domain,
        projects.service
      ]));
    await assert.rejects(
      verifyDurableService(root),
      /Db project references mismatch/u);
  });
});

test("rejects provider-resident migration behavior", async () => {
  await withFixture(async (root) => {
    await writeFile(
      path.join(root, "migrations/0001_create.ts"),
      "const sql = \"CREATE TRIGGER mutate AFTER UPDATE\";\n");
    await assert.rejects(
      verifyDurableService(root),
      /migrations contain provider-resident behavior/u);
  });
});

test("rejects hand-authored files over 600 lines", async () => {
  await withFixture(async (root, projects) => {
    await writeFile(
      path.join(path.dirname(projects.domain), "TooLarge.cs"),
      "namespace Example;\n".repeat(601));
    await assert.rejects(
      verifyDurableService(root),
      /TooLarge\.cs has 601 lines/u);
  });
});

async function withFixture(action) {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, "sampled-"));
  try {
    const projects = await createFixture(root);
    await action(root, projects);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function createFixture(root) {
  const serviceName = path.basename(root);
  const sourceRoot = path.join(root, "csharp/src");
  const domainRoot = path.join(sourceRoot, "Example.Sample.Domain");
  const databaseRoot = path.join(sourceRoot, "Example.Sample.Db");
  const serviceRoot = path.join(sourceRoot, "Example.Sample.Service");
  const projects = {
    domain: path.join(domainRoot, "Example.Sample.Domain.csproj"),
    database: path.join(databaseRoot, "Example.Sample.Db.csproj"),
    service: path.join(serviceRoot, "Example.Sample.Service.csproj")
  };
  await Promise.all([
    mkdir(domainRoot, { recursive: true }),
    mkdir(databaseRoot, { recursive: true }),
    mkdir(serviceRoot, { recursive: true }),
    mkdir(path.join(root, "migrations"), { recursive: true })
  ]);
  await Promise.all([
    writeFile(projects.domain, "<Project />\n"),
    writeFile(projects.database, project([projects.domain])),
    writeFile(
      projects.service,
      serviceProject(projects.domain, projects.database)),
    writeFile(path.join(domainRoot, "Value.cs"), "namespace Example;\n"),
    writeFile(path.join(databaseRoot, "Read.cs"), "namespace Example;\n"),
    writeFile(path.join(serviceRoot, "Run.cs"), "namespace Example;\n"),
    writeFile(
      path.join(root, "migrations/0001_create.ts"),
      "export async function up() {}\n"),
    writeFile(
      path.join(root, "csharp/Containerfile"),
      "RUN node tooling/native/gated-publish.mjs "
        + `services/${serviceName}/csharp/nativeaot-diagnostics.json `
        + "Example.Sample.Service\n"
        + "ENTRYPOINT [\"/app/Example.Sample.Service\"]\n")
  ]);
  return projects;
}

function project(references) {
  const items = references.map((file) =>
    `<ProjectReference Include=\"${path.relative(path.dirname(references[0]), file)}\" />`)
    .join("");
  return `<Project><ItemGroup>${items}</ItemGroup></Project>\n`;
}

function serviceProject(domain, database) {
  return `<Project><PropertyGroup>
<PublishAot>true</PublishAot>
<PublishTrimmed>true</PublishTrimmed>
<TrimMode>full</TrimMode>
<SelfContained>true</SelfContained>
<IsAotCompatible>true</IsAotCompatible>
<EnableAotAnalyzer>true</EnableAotAnalyzer>
<EnableTrimAnalyzer>true</EnableTrimAnalyzer>
<IlcTreatWarningsAsErrors>true</IlcTreatWarningsAsErrors>
</PropertyGroup><ItemGroup>
<ProjectReference Include=\"${domain}\" />
<ProjectReference Include=\"${database}\" />
</ItemGroup></Project>\n`;
}
