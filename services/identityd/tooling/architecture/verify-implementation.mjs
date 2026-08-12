import {
  readdir,
  readFile
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import {
  verifyDurableService
} from "../../../../tooling/architecture/verify-durable-service.mjs";

const serviceRoot = fileURLToPath(new URL("../../", import.meta.url));
await verifyDurableService(serviceRoot);
await verifyIdentityOwnership(serviceRoot);
process.stdout.write("identityd ownership architecture verified\n");

async function verifyIdentityOwnership(root) {
  const sourceRoot = path.join(root, "csharp/src");
  const domainRoot = path.join(
    sourceRoot,
    "CtlFlow.Identity.Identityd.Domain");
  const databaseRoot = path.join(
    sourceRoot,
    "CtlFlow.Identity.Identityd.Db");
  const domainFiles = await walk(domainRoot);
  const providerIds = domainFiles.filter((file) =>
    path.basename(file) === "ProviderId.cs");
  assertSame(
    providerIds.map((file) => path.relative(domainRoot, file)),
    ["Providers/ProviderId.cs"],
    "ProviderId ownership");

  const providerId = await read(providerIds[0]);
  assert(
    providerId.includes(
      "namespace CtlFlow.Identity.Identityd.Domain.Providers;"),
    "ProviderId must be owned by Domain/Providers");

  const databaseFiles = (await walk(databaseRoot))
    .filter((file) => file.endsWith(".cs"));
  const mutationFiles = [];
  for (const file of databaseFiles) {
    const source = await read(file);
    if (/\b(?:SaveChangesAsync|ExecuteUpdateAsync|ExecuteDeleteAsync)\s*\(/u
      .test(source)) {
      mutationFiles.push([file, source]);
    }
  }
  assert(mutationFiles.length > 0, "Identityd must contain database mutations");
  for (const [file, source] of mutationFiles) {
    assert(
      source.includes(".AcquireMutation(cancellation)"),
      `${path.relative(databaseRoot, file)} bypasses the mutation coordinator`);
  }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const item = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!["bin", "obj"].includes(entry.name)) {
        files.push(...await walk(item));
      }
    } else if (entry.isFile()) {
      files.push(item);
    }
  }
  return files.sort();
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
