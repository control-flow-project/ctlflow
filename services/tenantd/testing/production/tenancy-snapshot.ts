export type TenantdResourceState = "active" | "suspended" | "deleted";

export interface TenantdTenantRecord {
  readonly tenantId: string;
  readonly address: string;
  readonly displayName: string;
  readonly state: TenantdResourceState;
  readonly revision: number;
}

export interface TenantdWorkspaceRecord {
  readonly workspaceId: string;
  readonly tenantId: string;
  readonly address: string;
  readonly displayName: string;
  readonly state: TenantdResourceState;
  readonly revision: number;
}

export interface TenancySnapshot {
  readonly tenants: readonly TenantdTenantRecord[];
  readonly workspaces: readonly TenantdWorkspaceRecord[];
}
