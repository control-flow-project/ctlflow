import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tenants", (table) => {
    table.string("tenant_id", 64).primary();
    table.string("address", 63).notNullable().unique();
    table.string("display_name", 200).notNullable();
    table.integer("state").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.check("length(tenant_id) BETWEEN 1 AND 64");
    table.check("tenant_id GLOB '[a-z0-9]*'");
    table.check("tenant_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("length(address) BETWEEN 1 AND 63");
    table.check("address NOT GLOB '*[^-a-z0-9._~]*'");
    table.check("address NOT IN ('.', '..')");
    table.check("length(display_name) BETWEEN 1 AND 200");
    table.check("length(trim(display_name)) > 0");
    table.check("state BETWEEN 1 AND 3");
    table.check("revision > 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.schema.createTable("workspaces", (table) => {
    table.string("workspace_id", 64).primary();
    table.string("tenant_id", 64).notNullable()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("address", 63).notNullable();
    table.string("display_name", 200).notNullable();
    table.integer("state").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.unique(["tenant_id", "address"]);
    table.index(
      ["tenant_id", "workspace_id"],
      "workspaces_tenant_id_page_idx");
    table.check("length(workspace_id) BETWEEN 1 AND 64");
    table.check("workspace_id GLOB '[a-z0-9]*'");
    table.check("workspace_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("length(address) BETWEEN 1 AND 63");
    table.check("address NOT GLOB '*[^-a-z0-9._~]*'");
    table.check("address NOT IN ('.', '..')");
    table.check("length(display_name) BETWEEN 1 AND 200");
    table.check("length(trim(display_name)) > 0");
    table.check("state BETWEEN 1 AND 3");
    table.check("revision > 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("workspaces");
  await knex.schema.dropTableIfExists("tenants");
}
