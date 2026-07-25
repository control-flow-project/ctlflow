import type { Knex } from "knex";

export interface InsertWorkspaceAddressBindingOptions {
  readonly id: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly workspaceAddress: string;
  readonly generation?: number;
  readonly active?: boolean;
}

export async function insertWorkspaceAddressBinding(
  database: Knex,
  options: InsertWorkspaceAddressBindingOptions
): Promise<void> {
  const now = Date.now();

  await database("workspace_address_bindings").insert({
    address_binding_id: options.id,
    tenant_id: options.tenantId,
    workspace_id: options.workspaceId,
    workspace_address: options.workspaceAddress,
    binding_generation: options.generation ?? 1,
    is_active: options.active === false ? 0 : 1,
    created_at_unix_ms: now,
    updated_at_unix_ms: now
  });
}
