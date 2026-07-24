import type { Knex } from "knex";

export interface InsertWorkspaceOptions {
  readonly id: string;
  readonly tenantId: string;
  readonly lifecycle: number;
  readonly revision?: number;
}

export async function insertWorkspace(
  database: Knex,
  options: InsertWorkspaceOptions
): Promise<void> {
  const now = Date.now();

  await database("workspaces").insert({
    workspace_id: options.id,
    tenant_id: options.tenantId,
    display_name: `Workspace ${options.id}`,
    lifecycle_state: options.lifecycle,
    revision: options.revision ?? 1,
    provisioning_generation: 1,
    created_at_unix_ms: now,
    updated_at_unix_ms: now
  });
}
