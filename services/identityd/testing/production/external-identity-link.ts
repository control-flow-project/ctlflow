export interface ExternalIdentityLink {
  readonly externalLinkId: string;
  readonly tenantId: string;
  readonly providerId: string;
  readonly providerSubject: string;
  readonly accountId: string;
  readonly revision: number;
}
