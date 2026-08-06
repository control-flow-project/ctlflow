import {
  readFileSync
} from "node:fs";
import path from "node:path";
import {
  fileURLToPath
} from "node:url";
import type {
  AccessGrantSeed,
  OwnerSeed,
  PolicySeed,
  RoleBindingSeed,
  RoleSeed,
  RuleSeed,
  SubjectSeed,
  TargetSeed
} from "./policy-seed.js";

// The one checked catalog source. The same file is projected into the
// Policyd runtime, which cross-checks it against the compiled catalog at
// startup, so seed validation, readiness, and runtime cannot drift.
const kernelOperationOwners = readOperationCatalog();

function readOperationCatalog(): ReadonlyMap<string, string> {
  const catalogPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../..",
    "catalog",
    "operation-owners.tsv");
  const entries = new Map<string, string>();
  for (const line of readFileSync(catalogPath, "utf8").split("\n")) {
    const row = line.trim();
    if (row.length === 0) {
      continue;
    }
    const [operation, principal] = row.split("\t");
    if (operation === undefined
        || principal === undefined
        || !principal.startsWith("SERVICE/")
        || entries.has(operation)) {
      throw new Error("The operation catalog is invalid");
    }
    entries.set(operation, principal.slice("SERVICE/".length));
  }
  if (entries.size === 0) {
    throw new Error("The operation catalog is empty");
  }
  return entries;
}

const operationPattern = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const ownerIdPattern = /^[a-z0-9][a-z0-9_.-]{0,127}$/;

// A kernel rule must name a catalog operation owned by the stated kernel
// service. A package rule is namespaced by its Package ID; only structure is
// validated here, because authority is resolved at decision time from Execd.
function validateOwner(rule: {
  readonly owner: OwnerSeed;
  readonly operation: string;
}): OwnerSeed {
  const owner = object(rule.owner, ["kind", "id"]);
  if (owner.kind !== "kernel" && owner.kind !== "package") {
    throw new Error("A policy rule owner kind must be kernel or package");
  }
  if (typeof owner.id !== "string" || !ownerIdPattern.test(owner.id)) {
    throw new Error("A policy rule owner ID is not canonical");
  }
  if (typeof rule.operation !== "string"
      || rule.operation.length > 128
      || !operationPattern.test(rule.operation)) {
    throw new Error("A policy rule operation is not canonical");
  }
  if (owner.kind === "kernel") {
    const expected = kernelOperationOwners.get(rule.operation);
    if (expected === undefined || expected !== owner.id) {
      throw new Error(
        "A kernel policy rule must name a catalog operation and its owner");
    }
  }
  return { kind: owner.kind, id: owner.id };
}


export function validatePolicySeed(value: unknown): PolicySeed {
  const root = object(value, ["roles", "roleBindings", "accessGrants"]);
  const roles = array(root.roles, "roles").map(validateRole);
  const roleBindings = array(
    root.roleBindings,
    "roleBindings").map(validateRoleBinding);
  const accessGrants = array(
    root.accessGrants,
    "accessGrants").map(validateAccessGrant);
  enforceMaximum(roles, 10_000, "roles");
  enforceMaximum(roleBindings, 100_000, "roleBindings");
  enforceMaximum(accessGrants, 100_000, "accessGrants");

  const roleIds = unique(
    roles.map((role) => role.roleId),
    "role IDs");
  for (const binding of roleBindings) {
    if (!roleIds.has(binding.roleId)) {
      throw new Error("A Role binding references an absent Role");
    }
  }
  unique(
    roleBindings.map((binding) =>
      `${binding.roleId}\u0000${binding.subject.kind}`
      + `\u0000${binding.subject.id}`),
    "Role bindings");
  unique(
    accessGrants.map((grant) =>
      `${targetKey(grant.target)}\u0000${grant.subject.kind}`
      + `\u0000${grant.subject.id}\u0000${ruleKey(grant)}`),
    "access grants");

  return { roles, roleBindings, accessGrants };
}

function validateRole(value: unknown): RoleSeed {
  const item = object(value, ["roleId", "target", "rules"]);
  const rules = array(item.rules, "Role rules").map(validateRule);
  if (rules.length < 1 || rules.length > 256) {
    throw new Error("A Role must contain between 1 and 256 rules");
  }
  unique(rules.map(ruleKey), "Role rules");
  return {
    roleId: identifier(item.roleId, 128, true),
    target: validateTarget(item.target),
    rules
  };
}

function validateRoleBinding(value: unknown): RoleBindingSeed {
  const item = object(value, ["roleId", "subject"]);
  return {
    roleId: identifier(item.roleId, 128, true),
    subject: validateSubject(item.subject)
  };
}

function validateAccessGrant(value: unknown): AccessGrantSeed {
  const item = object(
    value,
    ["target", "subject", "owner", "operation", "basePath", "match"]);
  return {
    target: validateTarget(item.target),
    subject: validateSubject(item.subject),
    ...validateRule({
      owner: item.owner,
      operation: item.operation,
      basePath: item.basePath,
      match: item.match
    })
  };
}

function validateRule(value: unknown): RuleSeed {
  const item = object(value, ["owner", "operation", "basePath", "match"]);
  if (typeof item.operation !== "string") {
    throw new Error("A policy rule operation is required");
  }
  const owner = validateOwner({
    owner: item.owner as OwnerSeed,
    operation: item.operation
  });
  if (item.match !== "exact" && item.match !== "subtree") {
    throw new Error("A policy rule has an invalid match kind");
  }
  return {
    owner,
    operation: item.operation,
    basePath: resourcePath(item.basePath),
    match: item.match
  };
}

function validateTarget(value: unknown): TargetSeed {
  const item = optionalObject(
    value,
    ["tenantId"],
    ["workspaceId"]);
  const tenantId = identifier(item.tenantId, 64, false);
  return item.workspaceId === undefined
    ? { tenantId }
    : {
        tenantId,
        workspaceId: identifier(item.workspaceId, 64, false)
      };
}

function validateSubject(value: unknown): SubjectSeed {
  const item = object(value, ["kind", "id"]);
  if (item.kind === "group") {
    return {
      kind: item.kind,
      id: identifier(item.id, 64, false)
    };
  }
  if (item.kind !== "principal" || typeof item.id !== "string"
      || !/^(?:user|service|agent):[a-z0-9][a-z0-9._-]*$/u
        .test(item.id)
      || item.id.length > 256) {
    throw new Error("A policy subject is invalid");
  }
  return { kind: item.kind, id: item.id };
}

function resourcePath(value: unknown): string {
  if (typeof value !== "string" || value.length < 2
      || value.length > 512 || !value.startsWith("/")
      || value.endsWith("/") || value.includes("//")
      || /[%?#\\\u0000-\u001f\u007f-\u{10ffff}]/u.test(value)
      || value.split("/").slice(1).some(
        (segment) => segment === "." || segment === "..")) {
    throw new Error("A policy base path is invalid");
  }
  return value;
}

function identifier(
  value: unknown,
  maximum: number,
  allowDot: boolean
): string {
  const pattern = allowDot
    ? /^[a-z0-9][a-z0-9._-]*$/u
    : /^[a-z0-9][a-z0-9_-]*$/u;
  if (typeof value !== "string" || value.length > maximum
      || !pattern.test(value)) {
    throw new Error("A policy identifier is invalid");
  }
  return value;
}

function object(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> {
  return optionalObject(value, keys, []);
}

function optionalObject(
  value: unknown,
  required: readonly string[],
  optional: readonly string[]
): Record<string, unknown> {
  if (value === null || typeof value !== "object"
      || Array.isArray(value)) {
    throw new Error("A policy seed object is invalid");
  }
  const record = value as Record<string, unknown>;
  const admitted = new Set([...required, ...optional]);
  if (required.some((key) => !(key in record))
      || Object.keys(record).some((key) => !admitted.has(key))) {
    throw new Error("A policy seed object has invalid fields");
  }
  return record;
}

function array(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array`);
  }
  return value;
}

function enforceMaximum(
  values: readonly unknown[],
  maximum: number,
  name: string
): void {
  if (values.length > maximum) {
    throw new Error(`${name} exceeds its installation bound`);
  }
}

function unique(values: readonly string[], name: string): Set<string> {
  const set = new Set(values);
  if (set.size !== values.length) {
    throw new Error(`${name} must be unique`);
  }
  return set;
}

function targetKey(target: TargetSeed): string {
  return `${target.tenantId}\u0000${target.workspaceId ?? ""}`;
}

function ruleKey(rule: RuleSeed): string {
  return `${rule.owner.kind}\u0000${rule.owner.id}`
    + `\u0000${rule.operation}\u0000${rule.basePath}`
    + `\u0000${rule.match}`;
}
