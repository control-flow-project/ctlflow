import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import protobuf from "protobufjs";
import ts from "typescript";
import {
  verifyReleaseGates
} from "../../../../tooling/evidence/verify-release-gates.mjs";

const manifestService = "ctlflow.policy.v1.PolicyService";
const allowedStatuses = new Set([
  "CANCELLED",
  "DEADLINE_EXCEEDED",
  "INVALID_ARGUMENT",
  "NOT_FOUND",
  "PERMISSION_DENIED",
  "UNAUTHENTICATED",
  "UNAVAILABLE"
]);
const directory = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(directory, "../..");
const manifest = parseManifest(JSON.parse(await readFile(
  path.join(serviceRoot, "evidence-manifest.json"),
  "utf8")));
const methods = await readRpcMethods();
const operations = new Map();
const statuses = new Set();

for (const operation of manifest.operations) {
  if (operations.has(operation.name)) {
    throw new Error(`Duplicate evidence operation: ${operation.name}`);
  }
  operations.set(operation.name, operation);
  await verifyReferences(operation.success);
  for (const [status, references] of Object.entries(operation.results)) {
    statuses.add(status);
    await verifyReferences(references);
  }
}

assertSameValues(
  "RPC evidence",
  [...operations.keys()],
  methods);
assertSameValues(
  "documented gRPC status evidence",
  [...statuses],
  [
    "CANCELLED",
    "DEADLINE_EXCEEDED",
    "INVALID_ARGUMENT",
    "NOT_FOUND",
    "PERMISSION_DENIED",
    "UNAUTHENTICATED",
    "UNAVAILABLE"
  ]);
await verifyReferences(manifest.crossCutting);
process.stdout.write("policyd evidence manifest verified\n");

function parseManifest(value) {
  requireObject(value, "evidence manifest");
  assertKeys(
    value,
    ["schemaVersion", "service", "operations", "crossCutting", "releaseGates"],
    "evidence manifest");
  if (value.schemaVersion !== 1
      || value.service !== manifestService
      || !Array.isArray(value.operations)
      || value.operations.length === 0
      || !Array.isArray(value.crossCutting)
      || value.crossCutting.length === 0
      || !Array.isArray(value.releaseGates)
      || value.releaseGates.length === 0
      || !value.releaseGates.every(isNonemptyString)
      || new Set(value.releaseGates).size !== value.releaseGates.length) {
    throw new Error("Policyd evidence manifest shape is invalid");
  }
  verifyReleaseGates(value.releaseGates, "policyd", true);

  return {
    operations: value.operations.map(parseOperation),
    crossCutting: value.crossCutting.map(parseReference)
  };
}

function parseOperation(value) {
  requireObject(value, "operation evidence");
  assertKeys(value, ["name", "success", "results"], "operation evidence");
  requireNonemptyString(value.name, "operation name");
  if (!Array.isArray(value.success) || value.success.length === 0) {
    throw new Error(`${value.name} has no direct success evidence`);
  }
  requireObject(value.results, `${value.name} results`);
  const results = {};
  for (const [status, references] of Object.entries(value.results)) {
    if (!allowedStatuses.has(status)
        || !Array.isArray(references)
        || references.length === 0) {
      throw new Error(`${value.name} has invalid ${status} evidence`);
    }
    results[status] = references.map(parseReference);
  }
  if (Object.keys(results).length === 0) {
    throw new Error(`${value.name} has no result evidence`);
  }

  return {
    name: value.name,
    success: value.success.map(parseReference),
    results
  };
}

function parseReference(value) {
  requireObject(value, "test reference");
  assertKeys(value, ["file", "title"], "test reference");
  requireNonemptyString(value.file, "test file");
  requireNonemptyString(value.title, "test title");
  if (!/^tests\/integration\/[^/]+\.test\.ts$/u.test(value.file)) {
    throw new Error(`Evidence test path is invalid: ${value.file}`);
  }
  return {
    file: value.file,
    title: value.title
  };
}

async function readRpcMethods() {
  const source = await readFile(
    path.join(serviceRoot, "api/proto/v1/policyd.proto"),
    "utf8");
  const root = protobuf.parse(source).root;
  return Object.keys(
    root.lookupService(manifestService).methods);
}

async function verifyReferences(references) {
  const seen = new Set();
  for (const reference of references) {
    const identity = `${reference.file}\0${reference.title}`;
    if (seen.has(identity)) {
      throw new Error(
        `Duplicate evidence owner: ${reference.file} :: ${reference.title}`);
    }
    seen.add(identity);
    const titles = await readTestTitles(reference.file);
    if (!titles.has(reference.title)) {
      throw new Error(
        `Evidence test does not exist: ${reference.file} :: `
        + reference.title);
    }
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
      const title = node.arguments[0].text;
      if (titles.has(title)) {
        throw new Error(
          `Duplicate test title in ${relativePath}: ${title}`);
      }
      titles.add(title);
    }
    ts.forEachChild(node, visit);
  }
}

function assertSameValues(name, actual, expected) {
  const normalizedActual = [...actual].sort();
  const normalizedExpected = [...expected].sort();
  if (JSON.stringify(normalizedActual)
      !== JSON.stringify(normalizedExpected)) {
    throw new Error(
      `${name} mismatch: expected ${normalizedExpected.join(", ")}, got `
      + normalizedActual.join(", "));
  }
}

function assertKeys(value, expected, name) {
  assertSameValues(`${name} keys`, Object.keys(value), expected);
}

function requireObject(value, name) {
  if (typeof value !== "object"
      || value === null
      || Array.isArray(value)) {
    throw new Error(`${name} must be an object`);
  }
}

function requireNonemptyString(value, name) {
  if (!isNonemptyString(value)) {
    throw new Error(`${name} must be a nonempty string`);
  }
}

function isNonemptyString(value) {
  return typeof value === "string" && value.length > 0;
}
