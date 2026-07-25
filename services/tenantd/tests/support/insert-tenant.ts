import type { Knex } from "knex";

export interface InsertTenantOptions {
  readonly id: string;
  readonly lifecycle: number;
  readonly revision?: number;
  readonly lastEventSequence?: number;
}

export async function insertTenant(
  database: Knex,
  options: InsertTenantOptions
): Promise<void> {
  const now = Date.now();

  await database("tenants").insert({
    tenant_id: options.id,
    display_name: `Tenant ${options.id}`,
    lifecycle_state: options.lifecycle,
    revision: options.revision ?? 1,
    provisioning_generation: 1,
    last_event_sequence: options.lastEventSequence ?? 1,
    created_at_unix_ms: now,
    updated_at_unix_ms: now
  });
}
