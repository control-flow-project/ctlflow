import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("package_generations", (table) => {
    table.string("package_id", 128).notNullable();
    table.bigInteger("generation").notNullable();
    table.string("version", 128).notNullable();
    table.string("source_uri", 2048).notNullable();
    table.string("source_digest", 71).notNullable();
    table.bigInteger("declared_at_unix_ms").notNullable();
    table.primary(["package_id", "generation"]);
    table.unique(["package_id", "version"]);
    table.check("length(package_id) BETWEEN 1 AND 128");
    table.check("generation > 0");
    table.check("length(version) BETWEEN 5 AND 128");
    table.check("length(source_uri) BETWEEN 1 AND 2048");
    table.check("length(source_digest) = 71");
    table.check("declared_at_unix_ms > 0");
  });

  await knex.schema.createTable("package_components", (table) => {
    table.string("package_id", 128).notNullable();
    table.bigInteger("generation").notNullable();
    table.string("component_id", 64).notNullable();
    table.string("repository", 255).notNullable();
    table.string("manifest_digest", 71).notNullable();
    table.primary(["package_id", "generation", "component_id"]);
    table.foreign(["package_id", "generation"])
      .references(["package_id", "generation"])
      .inTable("package_generations")
      .onDelete("RESTRICT");
    table.check("length(component_id) BETWEEN 1 AND 64");
    table.check("length(repository) BETWEEN 3 AND 255");
    table.check("length(manifest_digest) = 71");
  });

  await knex.schema.createTable("package_interfaces", (table) => {
    table.string("package_id", 128).notNullable();
    table.bigInteger("generation").notNullable();
    table.string("interface_id", 64).notNullable();
    table.string("component_id", 64).notNullable();
    table.integer("protocol").notNullable();
    table.string("contract_id", 128).notNullable();
    table.integer("port").notNullable();
    table.primary(["package_id", "generation", "interface_id"]);
    table.foreign(["package_id", "generation", "component_id"])
      .references(["package_id", "generation", "component_id"])
      .inTable("package_components")
      .onDelete("RESTRICT");
    table.index(["package_id", "generation", "component_id"]);
    table.check("length(interface_id) BETWEEN 1 AND 64");
    table.check("protocol BETWEEN 1 AND 2");
    table.check("length(contract_id) BETWEEN 1 AND 128");
    table.check("port BETWEEN 1 AND 65535");
  });

  await knex.schema.createTable("package_dependencies", (table) => {
    table.string("package_id", 128).notNullable();
    table.bigInteger("generation").notNullable();
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 400).notNullable();
    table.string("dependency_id", 64).nullable();
    table.string("dependency_type", 128).notNullable();
    table.primary([
      "package_id",
      "generation",
      "component_id",
      "dependency_name"
    ]);
    table.unique(["package_id", "generation", "dependency_id"]);
    table.foreign(["package_id", "generation", "component_id"])
      .references(["package_id", "generation", "component_id"])
      .inTable("package_components")
      .onDelete("RESTRICT");
    table.check("length(dependency_name) BETWEEN 1 AND 200");
    table.check(
      "dependency_id IS NULL OR length(dependency_id) BETWEEN 1 AND 64");
    table.check("length(dependency_type) BETWEEN 1 AND 128");
  });

  await knex.schema.createTable("package_dependency_options", (table) => {
    table.string("package_id", 128).notNullable();
    table.bigInteger("generation").notNullable();
    table.string("component_id", 64).notNullable();
    table.string("dependency_name", 400).notNullable();
    table.integer("format").notNullable();
    table.integer("byte_length").notNullable();
    table.string("digest", 71).notNullable();
    table.binary("canonical_json").notNullable();
    table.primary([
      "package_id",
      "generation",
      "component_id",
      "dependency_name"
    ]);
    table.foreign([
      "package_id",
      "generation",
      "component_id",
      "dependency_name"
    ])
      .references([
        "package_id",
        "generation",
        "component_id",
        "dependency_name"
      ])
      .inTable("package_dependencies")
      .onDelete("RESTRICT");
    table.check("format = 1");
    table.check("byte_length BETWEEN 2 AND 65536");
    table.check("length(digest) = 71");
    table.check("length(canonical_json) = byte_length");
  });

  await knex.schema.createTable("package_exposures", (table) => {
    table.string("package_id", 128).notNullable();
    table.bigInteger("generation").notNullable();
    table.string("exposure_id", 64).notNullable();
    table.string("interface_id", 64).notNullable();
    table.primary(["package_id", "generation", "exposure_id"]);
    table.unique(["package_id", "generation", "interface_id"]);
    table.foreign(["package_id", "generation", "interface_id"])
      .references(["package_id", "generation", "interface_id"])
      .inTable("package_interfaces")
      .onDelete("RESTRICT");
    table.check("length(exposure_id) BETWEEN 1 AND 64");
  });

  await knex.schema.createTable("apps", (table) => {
    table.string("app_id", 64).primary();
    table.integer("scope_kind").notNullable();
    table.string("tenant_id", 64).nullable();
    table.string("workspace_id", 64).nullable();
    table.string("account_principal_id", 256).nullable();
    table.string("placement_id", 64).notNullable();
    table.string("package_id", 128).notNullable();
    table.bigInteger("initial_package_generation").notNullable();
    table.bigInteger("desired_package_generation").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.foreign(["package_id", "initial_package_generation"])
      .references(["package_id", "generation"])
      .inTable("package_generations")
      .onDelete("RESTRICT");
    table.foreign(["package_id", "desired_package_generation"])
      .references(["package_id", "generation"])
      .inTable("package_generations")
      .onDelete("RESTRICT");
    table.index(["package_id", "initial_package_generation"]);
    table.index(["package_id", "desired_package_generation"]);
    table.check("length(app_id) BETWEEN 1 AND 64");
    table.check("scope_kind BETWEEN 1 AND 4");
    table.check(
      "(scope_kind = 1 AND tenant_id IS NULL AND workspace_id IS NULL "
      + "AND account_principal_id IS NULL) OR "
      + "(scope_kind = 2 AND tenant_id IS NOT NULL "
      + "AND workspace_id IS NULL AND account_principal_id IS NULL) OR "
      + "(scope_kind = 3 AND tenant_id IS NOT NULL "
      + "AND workspace_id IS NOT NULL AND account_principal_id IS NULL) OR "
      + "(scope_kind = 4 AND tenant_id IS NOT NULL "
      + "AND workspace_id IS NULL AND account_principal_id IS NOT NULL)");
    table.check("tenant_id IS NULL OR length(tenant_id) BETWEEN 1 AND 64");
    table.check(
      "workspace_id IS NULL OR length(workspace_id) BETWEEN 1 AND 64");
    table.check(
      "account_principal_id IS NULL "
      + "OR length(account_principal_id) BETWEEN 6 AND 256");
    table.check("length(placement_id) BETWEEN 1 AND 64");
    table.check("initial_package_generation > 0");
    table.check("desired_package_generation > 0");
    table.check("revision > 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("apps");
  await knex.schema.dropTableIfExists("package_exposures");
  await knex.schema.dropTableIfExists("package_dependency_options");
  await knex.schema.dropTableIfExists("package_dependencies");
  await knex.schema.dropTableIfExists("package_interfaces");
  await knex.schema.dropTableIfExists("package_components");
  await knex.schema.dropTableIfExists("package_generations");
}
