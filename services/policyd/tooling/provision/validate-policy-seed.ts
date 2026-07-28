import type {
  AccessGrantSeed,
  PolicySeed,
  RoleBindingSeed,
  RoleSeed,
  RuleSeed,
  SubjectSeed,
  TargetSeed
} from "./policy-seed.js";

const operations = new Set([
  "tenants.read",
  "tenants.update_display_name",
  "workspaces.create",
  "workspaces.read",
  "workspaces.update_display_name",
  "workspaces.suspend",
  "workspaces.resume",
  "workspaces.delete",
  "apps.create",
  "apps.read",
  "apps.set_package_generation",
  "configurations.publish",
  "configurations.read",
  "secrets.publish",
  "secrets.read_metadata",
  "placements.declare",
  "placements.read",
  "workloads.declare",
  "workloads.read",
  "runs.create",
  "runs.read",
  "runs.cancel"
]);

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
    ["target", "subject", "operation", "basePath", "match"]);
  return {
    target: validateTarget(item.target),
    subject: validateSubject(item.subject),
    ...validateRule(item)
  };
}

function validateRule(value: unknown): RuleSeed {
  const item = object(value, ["operation", "basePath", "match"]);
  if (typeof item.operation !== "string"
      || !operations.has(item.operation)) {
    throw new Error("A policy rule names an unknown operation");
  }
  if (item.match !== "exact" && item.match !== "subtree") {
    throw new Error("A policy rule has an invalid match kind");
  }
  return {
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
  return `${rule.operation}\u0000${rule.basePath}\u0000${rule.match}`;
}
