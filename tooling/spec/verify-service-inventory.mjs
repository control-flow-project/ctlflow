import {
  readFile
} from "node:fs/promises";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const defaultRepositoryRoot = path.resolve(
  path.dirname(currentFile),
  "../..");

const contracts = [
  grpc("tenantd"),
  grpc("identityd"),
  grpc("policyd"),
  grpc("pkgd"),
  grpc("configd"),
  grpc("execd"),
  grpc("auditd"),
  http("authd", "routes"),
  http("edged", "methods"),
  http("egressd", "methods")
];

export async function verifyServiceInventory(
  repositoryRoot = defaultRepositoryRoot
) {
  const inventory = [];
  for (const contract of contracts) {
    const source = await readFile(
      path.join(repositoryRoot, contract.path),
      "utf8");
    const count = contract.protocol === "grpc"
      ? countMatches(source, /^\s*rpc\s+[A-Za-z][A-Za-z0-9]*\s*\(/gmu)
      : countMatches(source, /^\s+operationId:\s*\S+/gmu);
    assert(count > 0, `${contract.name} has no contract operations`);
    inventory.push({ ...contract, count });
  }

  const readme = await readFile(
    path.join(repositoryRoot, "README.md"),
    "utf8");
  const specification = await readFile(
    path.join(repositoryRoot, "spec/_index.md"),
    "utf8");
  const apiSpecification = await readFile(
    path.join(repositoryRoot, "spec/apis/_index.md"),
    "utf8");

  for (const item of inventory) {
    verifyOverviewRow(readme, item, "README", readmeLabel(item));
    verifyOverviewRow(
      specification,
      item,
      "specification index",
      specificationLabel(item));
    verifyApiRow(apiSpecification, item);
  }

  const grpcCount = inventory
    .filter((item) => item.protocol === "grpc")
    .reduce((total, item) => total + item.count, 0);
  const httpCount = inventory
    .filter((item) => item.protocol === "http")
    .reduce((total, item) => total + item.count, 0);
  const total = `The approved surface is ${String(grpcCount)} unary RPCs `
    + `and ${String(httpCount)} HTTP method/route combinations.`;
  assert(
    apiSpecification.includes(total),
    `API inventory total is stale; expected: ${total}`);
}

function grpc(name) {
  return {
    name,
    protocol: "grpc",
    path: `services/${name}/api/proto/v1/${name}.proto`
  };
}

function http(name, label) {
  return {
    name,
    protocol: "http",
    label,
    path: `services/${name}/api/http/v1/openapi.yaml`
  };
}

function verifyOverviewRow(source, item, document, expected) {
  const row = findServiceRow(source, item.name, document);
  const cells = readCells(row);
  assert(
    cells.at(-1)?.includes(`[${expected}]`) === true,
    `${document} ${item.name} count is stale; expected ${expected}`);
}

function verifyApiRow(source, item) {
  const row = findServiceRow(source, item.name, "API specification index");
  const cells = readCells(row);
  const expected = item.protocol === "grpc"
    ? String(item.count)
    : `${String(item.count)} ${item.label}`;
  assert(
    cells[2] === expected,
    `API specification ${item.name} count is stale; expected ${expected}`);
}

function findServiceRow(source, service, document) {
  const rows = source.split(/\r?\n/u).filter((line) =>
    line.startsWith("|")
      && isServiceCell(readCells(line)[0], service));
  assert(
    rows.length === 1,
    `${document} must contain exactly one ${service} inventory row`);
  return rows[0];
}

function isServiceCell(cell, service) {
  return cell === `\`${service}\``
    || cell.startsWith(`[\`${service}\`](`);
}

function readCells(row) {
  return row.split("|").slice(1, -1).map((cell) => cell.trim());
}

function readmeLabel(item) {
  if (item.protocol === "grpc") {
    return `${String(item.count)} unary RPC${item.count === 1 ? "" : "s"}`;
  }
  return `${String(item.count)} HTTP ${item.label}`;
}

function specificationLabel(item) {
  if (item.protocol === "grpc") {
    return `${String(item.count)} gRPC method${item.count === 1 ? "" : "s"}`;
  }
  return `${String(item.count)} HTTP ${item.label}`;
}

function countMatches(source, expression) {
  return [...source.matchAll(expression)].length;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

if (process.argv[1] !== undefined
    && path.resolve(process.argv[1]) === currentFile) {
  await verifyServiceInventory();
  process.stdout.write("service inventory verified\n");
}
