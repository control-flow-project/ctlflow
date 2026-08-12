import assert from "node:assert/strict";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import {
  test
} from "node:test";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  verifyServiceInventory
} from "./verify-service-inventory.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const temporaryRoot = path.join(
  repositoryRoot,
  ".temp/tooling/spec-inventory");
const fixtureFiles = [
  "README.md",
  "spec/_index.md",
  "spec/apis/_index.md",
  "services/tenantd/api/proto/v1/tenantd.proto",
  "services/identityd/api/proto/v1/identityd.proto",
  "services/policyd/api/proto/v1/policyd.proto",
  "services/pkgd/api/proto/v1/pkgd.proto",
  "services/configd/api/proto/v1/configd.proto",
  "services/execd/api/proto/v1/execd.proto",
  "services/auditd/api/proto/v1/auditd.proto",
  "services/authd/api/http/v1/openapi.yaml",
  "services/edged/api/http/v1/openapi.yaml",
  "services/egressd/api/http/v1/openapi.yaml"
];

test("service inventory documentation matches owned contracts", async () => {
  await verifyServiceInventory(repositoryRoot);
});

test("service inventory rejects a stale service count", async () => {
  await withFixture(async (root) => {
    const file = path.join(root, "README.md");
    const source = await readFile(file, "utf8");
    await writeFile(
      file,
      source.replace("[34 unary RPCs]", "[33 unary RPCs]"));
    await assert.rejects(
      verifyServiceInventory(root),
      /README identityd count is stale/u);
  });
});

test("service inventory rejects a stale aggregate count", async () => {
  await withFixture(async (root) => {
    const file = path.join(root, "spec/apis/_index.md");
    const source = await readFile(file, "utf8");
    await writeFile(
      file,
      source.replace("69 unary RPCs", "68 unary RPCs"));
    await assert.rejects(
      verifyServiceInventory(root),
      /API inventory total is stale/u);
  });
});

async function withFixture(action) {
  await mkdir(temporaryRoot, { recursive: true });
  const root = await mkdtemp(path.join(temporaryRoot, "fixture-"));
  try {
    for (const relativePath of fixtureFiles) {
      const destination = path.join(root, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(
        path.join(repositoryRoot, relativePath),
        destination);
    }
    await action(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
