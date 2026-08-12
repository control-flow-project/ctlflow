import type { Knex } from "knex";
import type {
  TenancySnapshot,
  TenantdResourceState
} from "./tenancy-snapshot.js";

export async function replaceTenancy(
  database: Knex,
  snapshot: TenancySnapshot
): Promise<void> {
  const now = Date.now();
  await database.transaction(async (transaction) => {
    await transaction("workspaces").delete();
    await transaction("tenants").delete();
    if (snapshot.tenants.length > 0) {
      await transaction("tenants").insert(
        snapshot.tenants.map((tenant) => ({
          tenant_id: tenant.tenantId,
          address: tenant.address,
          display_name: tenant.displayName,
          state: mapState(tenant.state),
          revision: tenant.revision,
          created_at_unix_ms: now,
          updated_at_unix_ms: now
        })));
    }
    if (snapshot.workspaces.length > 0) {
      await transaction("workspaces").insert(
        snapshot.workspaces.map((workspace) => ({
          workspace_id: workspace.workspaceId,
          tenant_id: workspace.tenantId,
          address: workspace.address,
          display_name: workspace.displayName,
          state: mapState(workspace.state),
          revision: workspace.revision,
          created_at_unix_ms: now,
          updated_at_unix_ms: now
        })));
    }
  });
}

function mapState(state: TenantdResourceState): number {
  switch (state) {
    case "active":
      return 1;
    case "suspended":
      return 2;
    case "deleted":
      return 3;
  }
}
