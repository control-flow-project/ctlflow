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
  readonly owner: OwnerSeed;
  readonly operation: string;
  readonly basePath: string;
  readonly match: "exact" | "subtree";
}

// The tagged operation owner. Kernel rules name the owning kernel service;
// package rules name the owning Package ID.
export interface OwnerSeed {
  readonly kind: "kernel" | "package";
  readonly id: string;
}

export interface TargetSeed {
  readonly tenantId: string;
  readonly workspaceId?: string;
}

export interface SubjectSeed {
  readonly kind: "principal" | "group";
  readonly id: string;
}
