export interface ExternalIdentityLink {
  readonly tenantId: string;
  readonly providerId: string;
  readonly providerSubject: string;
  readonly accountId: string;
  readonly revision: number;
}
