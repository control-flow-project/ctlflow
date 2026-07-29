import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const contracts = [
  "config/v1/binding.schema.json",
  "config/v1/secrets.schema.json",
  "http/v1/openapi.yaml"
];
const operations = [
  ["GET", "/{path}", "forwardGet"],
  ["HEAD", "/{path}", "forwardHead"],
  ["POST", "/{path}", "forwardPost"],
  ["PUT", "/{path}", "forwardPut"],
  ["PATCH", "/{path}", "forwardPatch"],
  ["DELETE", "/{path}", "forwardDelete"],
  ["OPTIONS", "/{path}", "forwardOptions"]
];
const sources = new Map();
for (const contract of contracts) {
  sources.set(
    contract,
    await readCanonical(path.join(serviceRoot, "api", contract)));
}

const openApiSource = sources.get("http/v1/openapi.yaml");
assert(openApiSource !== undefined, "OpenAPI source is missing");
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
  assertSame(
    Object.keys(operation.responses),
    ["default"],
    `${method} responses`);
}
validateLocalReferences(openApi, openApi);
const workloadAuthentication =
  openApi.components?.parameters?.WorkloadAuthentication;
assertRecord(workloadAuthentication, "workload authentication");
assert(
  workloadAuthentication.schema?.pattern
    === "^[Bb][Ee][Aa][Rr][Ee][Rr] "
      + "[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$",
  "workload authentication pattern is invalid");
const mediatedResponse = openApi.components?.responses?.Mediated;
assertRecord(mediatedResponse, "mediated response");
assert(
  typeof mediatedResponse.description === "string"
    && mediatedResponse.description.includes(
      "400, 404, 405, 407, 413, 414, 429, 431, 502, or 504")
    && !mediatedResponse.description.includes("403"),
  "boundary status inventory is invalid");

const binding = parseJsonContract(
  sources.get("config/v1/binding.schema.json"),
  "binding schema");
assertClosedSchema(binding, "binding schema");
assertSame(
  binding.required,
  ["schema_version", "binding_id", "caller", "origin", "rules"],
  "binding required properties");
assert(
  binding.properties?.schema_version?.const === 1,
  "binding schema version is invalid");
assert(
  binding.properties?.rules?.minItems === 1
    && binding.properties?.rules?.maxItems === 256,
  "binding rule bounds are invalid");
assert(
  binding.$defs?.path?.pattern
    === "^/(?!\\.{1,2}(?:/|$))(?!.*\\/\\.{1,2}(?:/|$))"
      + "(?!.*[?%#\\\\])(?:[\\x21-\\x7E]*"
      + "[\\x21-\\x2E\\x30-\\x7E])?$",
  "binding path language is invalid");
assert(
  binding.$defs?.rule?.properties?.maximum_request_body_bytes
    ?.maximum === 67_108_864
    && binding.$defs?.rule?.properties?.maximum_response_body_bytes
      ?.maximum === 67_108_864,
  "binding body bounds are invalid");
validateLocalReferences(binding, binding);

const secrets = parseJsonContract(
  sources.get("config/v1/secrets.schema.json"),
  "secrets schema");
assertClosedSchema(secrets, "secrets schema");
assertSame(
  secrets.required,
  ["schema_version", "values"],
  "secrets required properties");
assert(
  secrets.properties?.schema_version?.const === 1
    && secrets.properties?.values?.maxItems === 256,
  "secret document bounds are invalid");
validateLocalReferences(secrets, secrets);

const manifest = [
  ...contracts.map((contract) =>
    `${contract}\t${digest(sources.get(contract) ?? "")}`),
  ...operations.map((operation) => operation.join("\t")),
  ""
].join("\n");
const manifestPath = path.join(serviceRoot, "api-manifest.txt");
if (process.argv.length === 3 && process.argv[2] === "--write") {
  await writeFile(manifestPath, manifest, "utf8");
} else if (process.argv.length === 2) {
  assert(
    await readFile(manifestPath, "utf8") === manifest,
    "api-manifest.txt does not match the checked Egressd contracts");
} else {
  throw new Error("Usage: verify-api-manifest.mjs [--write]");
}
process.stdout.write(
  operations.map(([method, route]) => `${method} ${route}`).join("\n")
  + "\n");

async function readCanonical(file) {
  const source = await readFile(file, "utf8");
  assert(
    source.endsWith("\n") && !source.includes("\r"),
    `${path.relative(serviceRoot, file)} must use canonical LF text`);
  return source;
}

function parseJsonContract(source, label) {
  assert(source !== undefined, `${label} source is missing`);
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    throw new Error(`${label} JSON is invalid`);
  }
  assertRecord(value, label);
  return value;
}

function assertClosedSchema(value, label) {
  assert(
    value.$schema === "https://json-schema.org/draft/2020-12/schema"
      && value.additionalProperties === false,
    `${label} must be a closed draft-2020-12 schema`);
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
