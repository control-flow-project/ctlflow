import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const apiPath = path.join(serviceRoot, "api/http/v1/openapi.yaml");
const manifestPath = path.join(serviceRoot, "api-manifest.txt");
const routes = [
  ["POST", "/auth/v1/begin", "beginAuthentication"],
  ["GET", "/auth/v1/callback", "completeProviderCallback"],
  ["POST", "/auth/v1/logout", "logout"]
];

const source = await readFile(apiPath, "utf8");
assert(
  source.endsWith("\n") && !source.includes("\r"),
  "openapi.yaml must use LF and end with one newline");

const document = parseDocument(source, {
  strict: true,
  uniqueKeys: true
});
const diagnostics = [...document.errors, ...document.warnings];
assert(
  diagnostics.length === 0,
  `Strict OpenAPI YAML parse failed:\n${
    diagnostics.map((item) => item.message).join("\n")}`);

const api = document.toJS({ maxAliasCount: 0 });
assertRecord(api, "OpenAPI document");
assertEqual(api.openapi, "3.1.0", "OpenAPI version");
assertRecord(api.info, "OpenAPI info");
assertEqual(api.info.version, "1.0.0", "API version");
assertRecord(api.paths, "OpenAPI paths");
assertKeys(
  api.paths,
  routes.map(([, routePath]) => routePath),
  "OpenAPI paths");

for (const [method, routePath, operationId] of routes) {
  const pathItem = api.paths[routePath];
  assertRecord(pathItem, routePath);
  assertKeys(pathItem, [method.toLowerCase()], routePath);

  const operation = pathItem[method.toLowerCase()];
  assertRecord(operation, `${method} ${routePath}`);
  assertEqual(
    operation.operationId,
    operationId,
    `${method} ${routePath} operationId`);
  assertRecord(operation.responses, `${method} ${routePath} responses`);
  assert(
    Object.hasOwn(operation.responses, "303"),
    `${method} ${routePath} must declare 303`);
}

validateLocalReferences(api, api);

const digest = createHash("sha256").update(source).digest("hex");
const manifest = [
  `http/v1/openapi.yaml\t${digest}`,
  ...routes.map((route) => route.join("\t")),
  ""
].join("\n");

if (process.argv.length === 3 && process.argv[2] === "--write") {
  await writeFile(manifestPath, manifest, "utf8");
} else if (process.argv.length === 2) {
  const checkedManifest = await readFile(manifestPath, "utf8");
  assert(
    manifest === checkedManifest,
    "api-manifest.txt does not match the checked OpenAPI contract; "
      + "run npm run update:api-manifest --workspace @ctlflow/authd");
} else {
  throw new Error("Usage: verify-api-manifest.mjs [--write]");
}

console.log(routes
  .map(([method, routePath]) => `${method} ${routePath}`)
  .join("\n"));

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertRecord(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`);
}

function assertEqual(actual, expected, label) {
  assert(
    actual === expected,
    `${label} must be ${JSON.stringify(expected)}; `
      + `found ${JSON.stringify(actual)}`);
}

function assertKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(
    JSON.stringify(actual) === JSON.stringify(wanted),
    `${label} must contain exactly ${wanted.join(", ")}; `
      + `found ${actual.join(", ")}`);
}

function validateLocalReferences(value, root) {
  if (Array.isArray(value)) {
    for (const item of value) {
      validateLocalReferences(item, root);
    }
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  if (Object.hasOwn(value, "$ref")) {
    const reference = value.$ref;
    assert(
      typeof reference === "string"
        && reference.startsWith("#/components/")
        && resolveReference(root, reference) !== undefined,
      `Unresolved or external OpenAPI reference: ${String(reference)}`);
  }
  for (const nested of Object.values(value)) {
    validateLocalReferences(nested, root);
  }
}

function resolveReference(root, reference) {
  return reference
    .slice(2)
    .split("/")
    .reduce((current, segment) => current?.[segment], root);
}
