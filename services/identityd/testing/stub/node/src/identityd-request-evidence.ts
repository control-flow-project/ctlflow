export interface IdentitydRequestEvidence {
  readonly operation:
    | "GetInvocationVerificationKeys"
    | "ResolvePrincipal"
    | "ListPrincipalGroups";
  readonly principalId?: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly receivedInvocation: boolean;
  readonly receivedTraceparent?: string;
}
