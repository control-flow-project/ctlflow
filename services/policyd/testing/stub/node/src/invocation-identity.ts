export interface InvocationIdentity {
  readonly subjectAccountId: string;
  readonly actorId: string;
  readonly tenantId?: string;
  readonly workspaceId?: string;
}
