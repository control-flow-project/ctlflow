export interface TenantDocument {
  readonly apiVersion: "tenancy.ctlflow.com/v1alpha1";
  readonly kind: "Tenant";
  readonly metadata: {
    readonly name: string;
    readonly resourceVersion: string;
    readonly creationTimestamp: string;
  };
  readonly spec: {
    readonly displayName: string;
    readonly address: {
      readonly authority: string;
      readonly pathPrefix: string;
    };
    readonly initialAdministrator: {
      readonly displayName: string;
      readonly loginIdentifier: string;
      readonly identityLink?: {
        readonly providerId: string;
        readonly providerSubject: string;
      };
    };
    readonly baselinePackages: readonly {
      readonly packageId: string;
      readonly packageVersion: string;
    }[];
  };
  readonly status: {
    readonly lifecycle: string;
    readonly revision: number;
    readonly provisioningGeneration: number;
    readonly currentOperation?: {
      readonly id: string;
      readonly kind: string;
    };
    readonly conditions: readonly {
      readonly owner: string;
      readonly state: string;
      readonly ownerRevision?: number;
      readonly reason?: string;
      readonly lastTransitionTime: string;
    }[];
  };
}
