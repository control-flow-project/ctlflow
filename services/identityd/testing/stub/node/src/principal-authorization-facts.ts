export type PrincipalAuthorizationKind =
  | "human"
  | "service"
  | "virtual";

export interface PrincipalAuthorizationFacts {
  readonly principalId: string;
  readonly tenantId: string;
  readonly workspaceId?: string;
  readonly principalKind: PrincipalAuthorizationKind;
  readonly principalEnabled: boolean;
  readonly principalRevision: number;
  readonly subjectAccountId: string;
  readonly subjectAccountEnabled: boolean;
  readonly subjectAccountRevision: number;
  readonly membershipRevision: number;
  readonly groupIds: readonly string[];
}
