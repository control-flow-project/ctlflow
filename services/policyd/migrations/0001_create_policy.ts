import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("roles", (table) => {
    table.string("role_id", 128).primary();
    table.integer("target_kind").notNullable();
    table.string("tenant_id", 64).notNullable();
    table.string("workspace_id", 64).nullable();
    table.check("length(role_id) BETWEEN 1 AND 128");
    table.check("role_id GLOB '[a-z0-9]*'");
    table.check("role_id NOT GLOB '*[^a-z0-9._-]*'");
    addTargetChecks(table);
  });

  await knex.schema.createTable("role_rules", (table) => {
    table.string("role_id", 128).notNullable()
      .references("role_id").inTable("roles").onDelete("RESTRICT");
    table.integer("operation_owner_kind").notNullable();
    table.string("operation_owner_id", 128).notNullable();
    table.string("operation", 128).notNullable();
    table.string("base_path", 512).notNullable();
    table.integer("match_kind").notNullable();
    table.primary([
      "role_id",
      "operation_owner_kind",
      "operation_owner_id",
      "operation",
      "base_path",
      "match_kind"
    ]);
    table.index(
      ["operation_owner_kind", "operation_owner_id", "operation", "role_id"],
      "role_rules_operation_role_idx");
    addOperationChecks(table);
    addPathChecks(table);
    table.check("match_kind IN (1, 2)");
  });

  await knex.schema.createTable("role_bindings", (table) => {
    table.string("role_id", 128).notNullable()
      .references("role_id").inTable("roles").onDelete("RESTRICT");
    table.integer("subject_kind").notNullable();
    table.string("subject_id", 256).notNullable();
    table.primary(["role_id", "subject_kind", "subject_id"]);
    table.index(
      ["subject_kind", "subject_id", "role_id"],
      "role_bindings_subject_role_idx");
    addSubjectChecks(table);
  });

  await knex.schema.createTable("access_grants", (table) => {
    table.increments("access_grant_id").primary();
    table.integer("target_kind").notNullable();
    table.string("tenant_id", 64).notNullable();
    table.string("workspace_id", 64).nullable();
    table.integer("subject_kind").notNullable();
    table.string("subject_id", 256).notNullable();
    table.integer("operation_owner_kind").notNullable();
    table.string("operation_owner_id", 128).notNullable();
    table.string("operation", 128).notNullable();
    table.string("base_path", 512).notNullable();
    table.integer("match_kind").notNullable();
    table.index(
      [
        "target_kind",
        "tenant_id",
        "workspace_id",
        "operation_owner_kind",
        "operation_owner_id",
        "operation",
        "subject_kind",
        "subject_id"
      ],
      "access_grants_decision_idx");
    addTargetChecks(table);
    addSubjectChecks(table);
    addOperationChecks(table);
    addPathChecks(table);
    table.check("match_kind IN (1, 2)");
  });

  await knex.raw(`
    CREATE UNIQUE INDEX access_grants_tenant_unique_idx
    ON access_grants (
      tenant_id,
      subject_kind,
      subject_id,
      operation_owner_kind,
      operation_owner_id,
      operation,
      base_path,
      match_kind
    )
    WHERE target_kind = 1
  `);
  await knex.raw(`
    CREATE UNIQUE INDEX access_grants_workspace_unique_idx
    ON access_grants (
      tenant_id,
      workspace_id,
      subject_kind,
      subject_id,
      operation_owner_kind,
      operation_owner_id,
      operation,
      base_path,
      match_kind
    )
    WHERE target_kind = 2
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("access_grants");
  await knex.schema.dropTableIfExists("role_bindings");
  await knex.schema.dropTableIfExists("role_rules");
  await knex.schema.dropTableIfExists("roles");
}

function addTargetChecks(table: Knex.CreateTableBuilder): void {
  table.check("target_kind IN (1, 2)");
  table.check("length(tenant_id) BETWEEN 1 AND 64");
  table.check("tenant_id GLOB '[a-z0-9]*'");
  table.check("tenant_id NOT GLOB '*[^a-z0-9_-]*'");
  table.check(
    "(target_kind = 1 AND workspace_id IS NULL) "
    + "OR (target_kind = 2 AND workspace_id IS NOT NULL)");
  table.check(
    "workspace_id IS NULL "
    + "OR (length(workspace_id) BETWEEN 1 AND 64 "
    + "AND workspace_id GLOB '[a-z0-9]*' "
    + "AND workspace_id NOT GLOB '*[^a-z0-9_-]*')");
}

function addSubjectChecks(table: Knex.CreateTableBuilder): void {
  table.check("subject_kind IN (1, 2)");
  table.check("length(subject_id) BETWEEN 1 AND 256");
  table.check(
    "(subject_kind = 1 "
    + "AND (subject_id GLOB 'user:[a-z0-9]*' "
    + "OR subject_id GLOB 'service:[a-z0-9]*' "
    + "OR subject_id GLOB 'agent:[a-z0-9]*') "
    + "AND substr(subject_id, instr(subject_id, ':') + 1) "
    + "NOT GLOB '*[^a-z0-9._-]*') "
    + "OR (subject_kind = 2 "
    + "AND length(subject_id) <= 64 "
    + "AND subject_id GLOB '[a-z0-9]*' "
    + "AND subject_id NOT GLOB '*[^a-z0-9_-]*')");
}

function addOperationChecks(table: Knex.CreateTableBuilder): void {
  // Closed owner-kind union: 1 = kernel, 2 = package. Every field is non-empty;
  // there is no sentinel value.
  table.check("operation_owner_kind IN (1, 2)");
  table.check("length(operation_owner_id) BETWEEN 1 AND 128");
  table.check("operation_owner_id GLOB '[a-z0-9]*'");
  table.check("operation_owner_id NOT GLOB '*[^a-z0-9_.-]*'");
  table.check("length(operation) BETWEEN 3 AND 128");
  table.check("operation NOT GLOB '*[^a-z0-9_.]*'");
  table.check(
    "length(operation) - length(replace(operation, '.', '')) = 1");
  table.check("operation NOT GLOB '.*'");
  table.check("operation NOT GLOB '*.'");
}

function addPathChecks(table: Knex.CreateTableBuilder): void {
  table.check("length(base_path) BETWEEN 2 AND 512");
  table.check("substr(base_path, 1, 1) = '/'");
  table.check("substr(base_path, -1, 1) <> '/'");
  table.check("base_path NOT LIKE '%//%'");
  table.check("base_path NOT GLOB '*[^ -~]*'");
  table.check("base_path NOT GLOB '*[%?#\\\\]*'");
  table.check("base_path NOT LIKE '%/./%'");
  table.check("base_path NOT LIKE '%/../%'");
  table.check("base_path NOT LIKE '%/.'");
  table.check("base_path NOT LIKE '%/..'");
}
