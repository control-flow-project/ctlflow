import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const openApiPath = path.join(
  serviceRoot,
  "api/http/v1/openapi.yaml");
const bindingPath = path.join(
  serviceRoot,
  "api/config/v1/binding.schema.json");
const manifestPath = path.join(serviceRoot, "api-manifest.txt");
const operations = [
  ["GET", "/{path}", "proxyGet"],
  ["HEAD", "/{path}", "proxyHead"],
  ["POST", "/{path}", "proxyPost"],
  ["PUT", "/{path}", "proxyPut"],
  ["PATCH", "/{path}", "proxyPatch"],
  ["DELETE", "/{path}", "proxyDelete"],
  ["OPTIONS", "/{path}", "proxyOptions"]
];

const openApiSource = await readCanonical(openApiPath);
const bindingSource = await readCanonical(bindingPath);
const parsed = parseDocument(openApiSource, {
  strict: true,
  uniqueKeys: true
});
assert(
  parsed.errors.length === 0 && parsed.warnings.length === 0,
  "Strict OpenAPI YAML parse failed");
const openApi = parsed.toJS({ maxAliasCount: 0 });
assertRecord(openApi, "OpenAPI");
assert(openApi.openapi === "3.1.0", "OpenAPI version is invalid");
assertRecord(openApi.paths, "OpenAPI paths");
assertSame(Object.keys(openApi.paths), ["/{path}"], "OpenAPI paths");
const pathItem = openApi.paths["/{path}"];
assertRecord(pathItem, "catch-all path");
assert(
  pathItem["x-ctlflow-catch-all-includes-root"] === true,
  "catch-all must include root");
assertSame(
  Object.keys(pathItem).sort(),
  [
    "delete",
    "get",
    "head",
    "options",
    "parameters",
    "patch",
    "post",
    "put",
    "x-ctlflow-catch-all-includes-root"
  ],
  "catch-all keys");
for (const [method, , operationId] of operations) {
  const operation = pathItem[method.toLowerCase()];
  assertRecord(operation, `${method} operation`);
  assert(
    operation.operationId === operationId,
    `${method} operationId is invalid`);
  assertRecord(operation.responses, `${method} responses`);
  assert(
    Object.hasOwn(operation.responses, "default"),
    `${method} must declare its proxied response`);
}
validateLocalReferences(openApi, openApi);

let binding;
try {
  binding = JSON.parse(bindingSource);
} catch {
  throw new Error("Binding schema JSON is invalid");
}
assertRecord(binding, "binding schema");
assert(
  binding.$schema
    === "https://json-schema.org/draft/2020-12/schema",
  "binding schema dialect is invalid");
assert(binding.additionalProperties === false, "binding must be closed");
assertSame(
  binding.required,
  ["schema_version", "target", "upstream_port"],
  "binding required properties");
assert(
  binding.properties?.schema_version?.const === 1,
  "binding schema version is invalid");
assert(
  binding.properties?.target?.oneOf?.length === 2,
  "binding must declare Tenant and Workspace targets");
assert(
  binding.properties?.upstream_port?.minimum === 1
    && binding.properties?.upstream_port?.maximum === 65_535,
  "binding upstream port is invalid");
validateLocalReferences(binding, binding);

const manifest = [
  `config/v1/binding.schema.json\t${digest(bindingSource)}`,
  `http/v1/openapi.yaml\t${digest(openApiSource)}`,
  ...operations.map((operation) => operation.join("\t")),
  ""
].join("\n");
if (process.argv.length === 3 && process.argv[2] === "--write") {
  await writeFile(manifestPath, manifest, "utf8");
} else if (process.argv.length === 2) {
  assert(
    await readFile(manifestPath, "utf8") === manifest,
    "api-manifest.txt does not match the checked Edged contracts");
} else {
  throw new Error("Usage: verify-api-manifest.mjs [--write]");
}

process.stdout.write(
  operations
    .map(([method, route]) => `${method} ${route}`)
    .join("\n")
  + "\n");

async function readCanonical(file) {
  const source = await readFile(file, "utf8");
  assert(
    source.endsWith("\n") && !source.includes("\r"),
    `${path.relative(serviceRoot, file)} must use canonical LF text`);
  return source;
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
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
        && reference.startsWith("#/")
        && resolveReference(root, reference) !== undefined,
      `Unresolved or external reference: ${String(reference)}`);
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

function assertRecord(value, label) {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object`);
}

function assertSame(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} mismatch`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
