export interface PolicySeed {
  readonly roles: readonly RoleSeed[];
  readonly roleBindings: readonly RoleBindingSeed[];
  readonly accessGrants: readonly AccessGrantSeed[];
}

export interface RoleSeed {
  readonly roleId: string;
  readonly target: TargetSeed;
  readonly rules: readonly RuleSeed[];
}

export interface RoleBindingSeed {
  readonly roleId: string;
  readonly subject: SubjectSeed;
}

export interface AccessGrantSeed extends RuleSeed {
  readonly target: TargetSeed;
  readonly subject: SubjectSeed;
}

export interface RuleSeed {
  readonly operation: string;
  readonly basePath: string;
  readonly match: "exact" | "subtree";
}

export interface TargetSeed {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

export interface SubjectSeed {
  readonly kind: "principal" | "group";
  readonly id: string;
}
