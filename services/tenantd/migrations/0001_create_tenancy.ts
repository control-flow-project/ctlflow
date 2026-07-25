import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("tenants", (table) => {
    table.string("tenant_id", 64).primary();
    table.string("display_name", 200).notNullable();
    table.integer("lifecycle_state").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("provisioning_generation").notNullable();
    table.string("current_operation_id", 64).nullable();
    table.bigInteger("last_event_sequence").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.check("lifecycle_state BETWEEN 1 AND 8");
    table.check("revision > 0");
    table.check("provisioning_generation > 0");
    table.check("last_event_sequence > 0");
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
    table.unique(
      ["tenant_id"],
      { indexName: "tenant_address_bindings_tenant_uq" });
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

  await knex.schema.createTable("workspaces", (table) => {
    table.string("workspace_id", 64).primary();
    table.string("tenant_id", 64).notNullable()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("display_name", 200).notNullable();
    table.integer("lifecycle_state").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("provisioning_generation").notNullable();
    table.string("current_operation_id", 64).nullable();
    table.bigInteger("last_event_sequence").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.index(["tenant_id"], "workspaces_tenant_idx");
    table.check("lifecycle_state BETWEEN 1 AND 8");
    table.check("revision > 0");
    table.check("provisioning_generation > 0");
    table.check("last_event_sequence > 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.schema.createTable("workspace_address_bindings", (table) => {
    table.string("address_binding_id", 64).primary();
    table.string("tenant_id", 64).notNullable()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("workspace_id", 64).notNullable()
      .references("workspace_id").inTable("workspaces").onDelete("RESTRICT");
    table.string("workspace_address", 63).notNullable();
    table.bigInteger("binding_generation").notNullable();
    table.integer("is_active").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.unique(["tenant_id", "workspace_address"]);
    table.unique(
      ["workspace_id"],
      { indexName: "workspace_address_bindings_workspace_uq" });
    table.check("binding_generation > 0");
    table.check("is_active IN (0, 1)");
    table.check("length(workspace_address) BETWEEN 1 AND 63");
    table.check("instr(workspace_address, '/') = 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.schema.createTable("tenant_initial_administrators", (table) => {
    table.string("tenant_id", 64).primary()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("display_name", 200).notNullable();
    table.string("login_identifier", 320).notNullable();
    table.string("provider_id", 64).nullable();
    table.string("provider_subject", 512).nullable();
    table.check("length(trim(display_name)) BETWEEN 1 AND 200");
    table.check("length(trim(login_identifier)) BETWEEN 1 AND 320");
    table.check(
      "(provider_id IS NULL AND provider_subject IS NULL)"
      + " OR (provider_id IS NOT NULL AND provider_subject IS NOT NULL)");
  });

  await knex.schema.createTable("tenant_baseline_packages", (table) => {
    table.string("tenant_id", 64).notNullable()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("package_id", 64).notNullable();
    table.string("package_version", 128).notNullable();
    table.primary(["tenant_id", "package_id", "package_version"]);
  });

  await knex.schema.createTable("workspace_initial_memberships", (table) => {
    table.string("workspace_id", 64).notNullable()
      .references("workspace_id").inTable("workspaces").onDelete("RESTRICT");
    table.string("user_id", 64).notNullable();
    table.integer("standing").notNullable();
    table.primary(["workspace_id", "user_id"]);
    table.check("standing IN (1, 2)");
  });

  await knex.schema.createTable("workspace_baseline_packages", (table) => {
    table.string("workspace_id", 64).notNullable()
      .references("workspace_id").inTable("workspaces").onDelete("RESTRICT");
    table.string("package_id", 64).notNullable();
    table.string("package_version", 128).notNullable();
    table.primary(["workspace_id", "package_id", "package_version"]);
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

  await knex.raw(`
    CREATE TRIGGER workspaces_are_permanent
    BEFORE DELETE ON workspaces
    BEGIN
      SELECT RAISE(ABORT, 'Workspace tombstones are permanent');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER workspace_address_bindings_are_permanent
    BEFORE DELETE ON workspace_address_bindings
    BEGIN
      SELECT RAISE(ABORT, 'Workspace address bindings are permanent');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER workspace_address_binding_owner_is_immutable
    BEFORE UPDATE OF tenant_id, workspace_id, workspace_address
    ON workspace_address_bindings
    BEGIN
      SELECT RAISE(ABORT, 'Workspace address ownership is immutable');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER retired_workspace_address_bindings_stay_retired
    BEFORE UPDATE OF is_active ON workspace_address_bindings
    WHEN OLD.is_active = 0 AND NEW.is_active = 1
    BEGIN
      SELECT RAISE(ABORT, 'Retired Workspace addresses cannot be reactivated');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER workspace_parent_is_immutable
    BEFORE UPDATE OF tenant_id, workspace_id ON workspaces
    BEGIN
      SELECT RAISE(ABORT, 'Workspace identity and parent Tenant are immutable');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER workspace_address_binding_tenant_matches
    BEFORE INSERT ON workspace_address_bindings
    WHEN NEW.tenant_id <> (
      SELECT tenant_id FROM workspaces WHERE workspace_id = NEW.workspace_id
    )
    BEGIN
      SELECT RAISE(ABORT, 'Workspace address binding Tenant must own the Workspace');
    END
  `);

  for (const [trigger, table] of [
    ["tenant_initial_administrator_is_immutable", "tenant_initial_administrators"],
    ["tenant_baseline_packages_are_immutable", "tenant_baseline_packages"],
    ["workspace_initial_memberships_are_immutable", "workspace_initial_memberships"],
    ["workspace_baseline_packages_are_immutable", "workspace_baseline_packages"]
  ] as const) {
    await knex.raw(`
      CREATE TRIGGER ${trigger}_update
      BEFORE UPDATE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, 'Provisioning intent is immutable');
      END
    `);
    await knex.raw(`
      CREATE TRIGGER ${trigger}_delete
      BEFORE DELETE ON ${table}
      BEGIN
        SELECT RAISE(ABORT, 'Provisioning intent is permanent');
      END
    `);
  }
}

export async function down(knex: Knex): Promise<void> {
  for (const trigger of [
    "workspace_baseline_packages_are_immutable_delete",
    "workspace_baseline_packages_are_immutable_update",
    "workspace_initial_memberships_are_immutable_delete",
    "workspace_initial_memberships_are_immutable_update",
    "tenant_baseline_packages_are_immutable_delete",
    "tenant_baseline_packages_are_immutable_update",
    "tenant_initial_administrator_is_immutable_delete",
    "tenant_initial_administrator_is_immutable_update"
  ]) {
    await knex.raw(`DROP TRIGGER IF EXISTS ${trigger}`);
  }
  await knex.raw(
    "DROP TRIGGER IF EXISTS workspace_address_binding_tenant_matches");
  await knex.raw("DROP TRIGGER IF EXISTS workspace_parent_is_immutable");
  await knex.raw(
    "DROP TRIGGER IF EXISTS retired_workspace_address_bindings_stay_retired");
  await knex.raw(
    "DROP TRIGGER IF EXISTS workspace_address_binding_owner_is_immutable");
  await knex.raw(
    "DROP TRIGGER IF EXISTS workspace_address_bindings_are_permanent");
  await knex.raw("DROP TRIGGER IF EXISTS workspaces_are_permanent");
  await knex.raw("DROP TRIGGER IF EXISTS tenant_address_roots_do_not_overlap_on_insert");
  await knex.raw("DROP TRIGGER IF EXISTS retired_tenant_address_bindings_stay_retired");
  await knex.raw("DROP TRIGGER IF EXISTS tenant_address_binding_owner_is_immutable");
  await knex.raw("DROP TRIGGER IF EXISTS tenant_address_bindings_are_permanent");
  await knex.raw("DROP TRIGGER IF EXISTS tenants_are_permanent");
  await knex.schema.dropTableIfExists("workspace_baseline_packages");
  await knex.schema.dropTableIfExists("workspace_initial_memberships");
  await knex.schema.dropTableIfExists("tenant_baseline_packages");
  await knex.schema.dropTableIfExists("tenant_initial_administrators");
  await knex.schema.dropTableIfExists("workspace_address_bindings");
  await knex.schema.dropTableIfExists("workspaces");
  await knex.schema.dropTableIfExists("tenant_address_bindings");
  await knex.schema.dropTableIfExists("tenants");
}
