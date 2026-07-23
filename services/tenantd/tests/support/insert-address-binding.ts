import type { Knex } from "knex";

export interface InsertAddressBindingOptions {
  readonly id: string;
  readonly tenantId: string;
  readonly authority: string;
  readonly pathPrefix: string;
  readonly generation?: number;
  readonly active?: boolean;
}

export async function insertAddressBinding(
  database: Knex,
  options: InsertAddressBindingOptions
): Promise<void> {
  const now = Date.now();

  await database("tenant_address_bindings").insert({
    address_binding_id: options.id,
    tenant_id: options.tenantId,
    authority: options.authority,
    path_prefix: options.pathPrefix,
    binding_generation: options.generation ?? 1,
    is_active: options.active === false ? 0 : 1,
    created_at_unix_ms: now,
    updated_at_unix_ms: now
  });
}
