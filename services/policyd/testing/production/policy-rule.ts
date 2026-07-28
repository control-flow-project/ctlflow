export interface PolicyRule {
  readonly operation: string;
  readonly basePath: string;
  readonly match: "exact" | "subtree";
}
