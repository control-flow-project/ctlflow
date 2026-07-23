import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tenants", (table) => {
    table.string("tenant_id", 64).primary();
    table.string("display_name", 200).notNullable();
    table.integer("lifecycle_state").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("provisioning_generation").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.check("lifecycle_state BETWEEN 1 AND 6");
    table.check("revision > 0");
    table.check("provisioning_generation > 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.schema.createTable("tenant_address_bindings", (table) => {
    table.string("address_binding_id", 64).primary();
    table.string("tenant_id", 64).notNullable()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("authority", 253).notNullable();
    table.string("path_prefix", 72).notNullable();
    table.bigInteger("binding_generation").notNullable();
    table.integer("is_active").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.unique(["authority", "path_prefix"]);
    table.index(["tenant_id"], "tenant_address_bindings_tenant_idx");
    table.check("binding_generation > 0");
    table.check("is_active IN (0, 1)");
    table.check(
      "path_prefix = '/' OR path_prefix LIKE '/tenants/%'");
    table.check(
      "path_prefix = '/' OR instr(substr(path_prefix, 10), '/') = 0");
    table.check(
      "path_prefix = '/' OR length(substr(path_prefix, 10)) BETWEEN 1 AND 63");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.raw(`
    CREATE TRIGGER tenants_are_permanent
    BEFORE DELETE ON tenants
    BEGIN
      SELECT RAISE(ABORT, 'Tenant tombstones are permanent');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER tenant_address_bindings_are_permanent
    BEFORE DELETE ON tenant_address_bindings
    BEGIN
      SELECT RAISE(ABORT, 'Tenant address bindings are permanent');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER tenant_address_binding_owner_is_immutable
    BEFORE UPDATE OF tenant_id, authority, path_prefix
    ON tenant_address_bindings
    BEGIN
      SELECT RAISE(ABORT, 'Tenant address ownership is immutable');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER retired_tenant_address_bindings_stay_retired
    BEFORE UPDATE OF is_active ON tenant_address_bindings
    WHEN OLD.is_active = 0 AND NEW.is_active = 1
    BEGIN
      SELECT RAISE(ABORT, 'Retired Tenant addresses cannot be reactivated');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER tenant_address_roots_do_not_overlap_on_insert
    BEFORE INSERT ON tenant_address_bindings
    WHEN EXISTS (
      SELECT 1
      FROM tenant_address_bindings AS existing
      WHERE existing.authority = NEW.authority
        AND (
          existing.path_prefix = '/'
          OR NEW.path_prefix = '/'
        )
    )
    BEGIN
      SELECT RAISE(ABORT, 'Tenant address roots cannot overlap');
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP TRIGGER IF EXISTS tenant_address_roots_do_not_overlap_on_insert");
  await knex.raw("DROP TRIGGER IF EXISTS retired_tenant_address_bindings_stay_retired");
  await knex.raw("DROP TRIGGER IF EXISTS tenant_address_binding_owner_is_immutable");
  await knex.raw("DROP TRIGGER IF EXISTS tenant_address_bindings_are_permanent");
  await knex.raw("DROP TRIGGER IF EXISTS tenants_are_permanent");
  await knex.schema.dropTableIfExists("tenant_address_bindings");
  await knex.schema.dropTableIfExists("tenants");
}
