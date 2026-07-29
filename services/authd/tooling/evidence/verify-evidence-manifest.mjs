import {
  readFile
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import ts from "typescript";
import {
  verifyReleaseGates
} from "../../../../tooling/evidence/verify-release-gates.mjs";
import {
  parseDocument
} from "yaml";
import {
  architectureClaims
} from "../architecture/architecture-claims.mjs";

const serviceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..");
const manifest = parseManifest(JSON.parse(await readFile(
  path.join(serviceRoot, "evidence-manifest.json"),
  "utf8")));
const openApi = parseOpenApi(await readFile(
  path.join(serviceRoot, "api/http/v1/openapi.yaml"),
  "utf8"));
const usedClaims = new Set();

assertSame(
  manifest.operations.map((operation) => [
    operation.method,
    operation.path,
    operation.operationId
  ]),
  openApi.map((operation) => [
    operation.method,
    operation.path,
    operation.operationId
  ]),
  "HTTP operation evidence");
for (const operation of manifest.operations) {
  const declared = openApi.find((item) =>
    item.method === operation.method
      && item.path === operation.path);
  assert(declared !== undefined, "Evidence operation is undeclared");
  assertSame(
    Object.keys(operation.statuses),
    declared.statuses,
    `${operation.method} ${operation.path} status evidence`);
  for (const references of Object.values(operation.statuses)) {
    await verifyReferences(references);
  }
}
await verifyReferences(manifest.crossCutting);
assertSame(
  [...usedClaims].sort(),
  [...architectureClaims].sort(),
  "architecture evidence claims");
process.stdout.write("authd evidence manifest verified\n");

function parseManifest(value) {
  requireObject(value, "evidence manifest");
  assertKeys(
    value,
    [
      "schemaVersion",
      "service",
      "operations",
      "crossCutting",
      "releaseGates"
    ],
    "evidence manifest");
  assert(
    value.schemaVersion === 1
      && value.service === "authd.http.v1"
      && Array.isArray(value.operations)
      && value.operations.length === 3
      && Array.isArray(value.crossCutting)
      && value.crossCutting.length > 0
      && Array.isArray(value.releaseGates)
      && value.releaseGates.length > 0
      && value.releaseGates.every(isNonemptyString)
      && new Set(value.releaseGates).size === value.releaseGates.length,
    "Authd evidence manifest shape is invalid");
  verifyReleaseGates(value.releaseGates, "authd", false);
  return {
    operations: value.operations.map(parseOperation),
    crossCutting: value.crossCutting.map(parseReference)
  };
}

function parseOperation(value) {
  requireObject(value, "operation evidence");
  assertKeys(
    value,
    ["method", "path", "operationId", "statuses"],
    "operation evidence");
  for (const [name, field] of [
    ["method", value.method],
    ["path", value.path],
    ["operationId", value.operationId]
  ]) {
    assert(isNonemptyString(field), `Operation ${name} is invalid`);
  }
  requireObject(value.statuses, "operation statuses");
  const statuses = {};
  for (const [status, references] of Object.entries(value.statuses)) {
    assert(
      /^[1-5][0-9]{2}$/u.test(status)
        && Array.isArray(references)
        && references.length > 0,
      `Operation status evidence is invalid: ${status}`);
    statuses[status] = references.map(parseReference);
  }
  return {
    method: value.method,
    path: value.path,
    operationId: value.operationId,
    statuses
  };
}

function parseReference(value) {
  requireObject(value, "evidence reference");
  if (Object.hasOwn(value, "architectureClaim")) {
    assertKeys(
      value,
      ["architectureClaim"],
      "architecture evidence reference");
    assert(
      architectureClaims.includes(value.architectureClaim),
      `Unknown architecture evidence claim: ${
        String(value.architectureClaim)}`);
    return { architectureClaim: value.architectureClaim };
  }
  assertKeys(value, ["file", "title"], "test evidence reference");
  assert(
    /^tests\/integration\/[^/]+\.test\.ts$/u.test(value.file)
      && isNonemptyString(value.title),
    "Test evidence reference is invalid");
  return { file: value.file, title: value.title };
}

function parseOpenApi(source) {
  const document = parseDocument(source, {
    strict: true,
    uniqueKeys: true
  });
  assert(
    document.errors.length === 0
      && document.warnings.length === 0,
    "OpenAPI does not parse strictly");
  const value = document.toJS({ maxAliasCount: 0 });
  requireObject(value.paths, "OpenAPI paths");
  const operations = [];
  for (const [routePath, pathItem] of Object.entries(value.paths)) {
    requireObject(pathItem, `OpenAPI path ${routePath}`);
    for (const [method, operation] of Object.entries(pathItem)) {
      requireObject(operation, `OpenAPI operation ${method} ${routePath}`);
      requireObject(
        operation.responses,
        `OpenAPI responses ${method} ${routePath}`);
      operations.push({
        method: method.toUpperCase(),
        path: routePath,
        operationId: operation.operationId,
        statuses: Object.keys(operation.responses)
      });
    }
  }
  return operations;
}

async function verifyReferences(references) {
  const seen = new Set();
  for (const reference of references) {
    if (reference.architectureClaim !== undefined) {
      assert(
        !usedClaims.has(reference.architectureClaim),
        `Duplicate architecture evidence claim: ${
          reference.architectureClaim}`);
      usedClaims.add(reference.architectureClaim);
      continue;
    }
    const identity = `${reference.file}\0${reference.title}`;
    assert(
      !seen.has(identity),
      `Duplicate test evidence reference: ${identity}`);
    seen.add(identity);
    const titles = await readTestTitles(reference.file);
    assert(
      titles.has(reference.title),
      `Evidence test does not exist: ${reference.file} :: `
        + reference.title);
  }
}

async function readTestTitles(relativePath) {
  const source = await readFile(
    path.join(serviceRoot, relativePath),
    "utf8");
  const file = ts.createSourceFile(
    relativePath,
    source,
    ts.ScriptTarget.ESNext,
    false,
    ts.ScriptKind.TS);
  const titles = new Set();
  visit(file);
  return titles;

  function visit(node) {
    if (ts.isCallExpression(node)
        && ts.isIdentifier(node.expression)
        && node.expression.text === "test"
        && node.arguments.length > 0
        && ts.isStringLiteral(node.arguments[0])) {
      assert(
        !titles.has(node.arguments[0].text),
        `Duplicate test title in ${relativePath}: ${
          node.arguments[0].text}`);
      titles.add(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  }
}

function assertKeys(value, expected, label) {
  assertSame(Object.keys(value).sort(), [...expected].sort(), `${label} keys`);
}

function assertSame(actual, expected, label) {
  assert(
    JSON.stringify(actual) === JSON.stringify(expected),
    `${label} mismatch: expected ${JSON.stringify(expected)}, `
      + `found ${JSON.stringify(actual)}`);
}

function requireObject(value, label) {
  assert(
    value !== null
      && typeof value === "object"
      && !Array.isArray(value),
    `${label} must be an object`);
}

function isNonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
