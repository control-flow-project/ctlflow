export interface PolicyRequestEvidence {
  readonly operation: string;
  readonly resourcePath: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly actorId?: string;
  readonly subjectAccountId?: string;
  readonly receivedInvocation: boolean;
  readonly receivedTraceparent?: string;
}
