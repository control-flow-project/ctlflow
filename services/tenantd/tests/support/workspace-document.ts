export interface WorkspaceDocument {
  readonly apiVersion: "tenancy.ctlflow.com/v1alpha1";
  readonly kind: "Workspace";
  readonly metadata: {
    readonly name: string;
    readonly resourceVersion: string;
    readonly creationTimestamp: string;
  };
  readonly spec: {
    readonly tenantId: string;
    readonly displayName: string;
    readonly workspaceAddress: string;
    readonly initialMemberships: readonly {
      readonly userId: string;
      readonly standing: string;
    }[];
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
