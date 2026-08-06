// The tagged operation owner: kernel rules name the owning kernel service,
// package rules name the owning Package ID.
export interface PolicyRuleOwner {
  readonly kind: "kernel" | "package";
  readonly id: string;
}

export interface PolicyRule {
  readonly owner: PolicyRuleOwner;
  readonly operation: string;
  readonly basePath: string;
  readonly match: "exact" | "subtree";
}
