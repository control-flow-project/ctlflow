export interface PolicyGrant {
  readonly subjectId: string;
  readonly operation: string;
  readonly resourcePath: string;
  readonly match: "exact" | "subtree";
}
