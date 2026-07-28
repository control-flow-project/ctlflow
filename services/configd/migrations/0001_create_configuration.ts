import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await createConfigurationTables(knex);
  await createSecretTables(knex);
  await createProjectionTables(knex);
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("projection_targets");
  await knex.schema.dropTableIfExists("projections");
  await knex.schema.dropTableIfExists("secret_versions");
  await knex.schema.dropTableIfExists("secrets");
  await knex.schema.dropTableIfExists("configuration_versions");
  await knex.schema.dropTableIfExists("configurations");
}

async function createConfigurationTables(knex: Knex): Promise<void> {
  await knex.schema.createTable("configurations", (table) => {
    table.string("configuration_id", 64).primary();
    addBinding(table);
    table.string("current_configuration_version_id", 64).notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    addCanonicalIdentifierCheck(table, "configuration_id");
    addCanonicalIdentifierCheck(
      table,
      "current_configuration_version_id");
    addBindingChecks(table);
    table.check("revision > 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.schema.createTable("configuration_versions", (table) => {
    table.string("configuration_version_id", 64).primary();
    table.string("configuration_id", 64).notNullable()
      .references("configuration_id")
      .inTable("configurations")
      .onDelete("RESTRICT");
    table.binary("content_json").notNullable();
    table.integer("content_length").notNullable();
    table.binary("content_sha256").notNullable();
    table.bigInteger("request_expected_revision").nullable();
    table.string("dependency_claim_id", 36).nullable();
    table.bigInteger("dependency_claim_revision").nullable();
    table.string("audit_event_id", 36).notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    addCanonicalIdentifierCheck(table, "configuration_version_id");
    addCanonicalIdentifierCheck(table, "configuration_id");
    table.check("content_length BETWEEN 1 AND 65536");
    table.check("length(content_json) = content_length");
    table.check("length(content_sha256) = 32");
    table.check(
      "request_expected_revision IS NULL OR request_expected_revision > 0");
    addClaimPairChecks(table);
    addAuditEventIdCheck(table);
    table.check("created_at_unix_ms > 0");
    table.index(
      ["configuration_id", "configuration_version_id"],
      "configuration_versions_parent_idx");
  });
}

async function createSecretTables(knex: Knex): Promise<void> {
  await knex.schema.createTable("secrets", (table) => {
    table.string("secret_id", 64).primary();
    addBinding(table);
    table.string("current_secret_version_id", 64).notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    addCanonicalIdentifierCheck(table, "secret_id");
    addCanonicalIdentifierCheck(table, "current_secret_version_id");
    addBindingChecks(table);
    table.check("revision > 0");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });

  await knex.schema.createTable("secret_versions", (table) => {
    table.string("secret_version_id", 64).primary();
    table.string("secret_id", 64).notNullable()
      .references("secret_id")
      .inTable("secrets")
      .onDelete("RESTRICT");
    table.binary("ciphertext").notNullable();
    table.integer("material_length").notNullable();
    table.binary("nonce").notNullable();
    table.binary("authentication_tag").notNullable();
    table.string("encryption_key_id", 64).notNullable();
    table.bigInteger("request_expected_revision").nullable();
    table.string("dependency_claim_id", 36).nullable();
    table.bigInteger("dependency_claim_revision").nullable();
    table.string("audit_event_id", 36).notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    addCanonicalIdentifierCheck(table, "secret_version_id");
    addCanonicalIdentifierCheck(table, "secret_id");
    addCanonicalIdentifierCheck(table, "encryption_key_id");
    table.check("material_length BETWEEN 1 AND 65536");
    table.check("length(ciphertext) = material_length");
    table.check("length(nonce) = 12");
    table.check("length(authentication_tag) = 16");
    table.check(
      "request_expected_revision IS NULL OR request_expected_revision > 0");
    addClaimPairChecks(table);
    addAuditEventIdCheck(table);
    table.check("created_at_unix_ms > 0");
    table.index(
      ["secret_id", "secret_version_id"],
      "secret_versions_parent_idx");
    table.index("encryption_key_id", "secret_versions_key_idx");
  });
}

async function createProjectionTables(knex: Knex): Promise<void> {
  await knex.schema.createTable("projections", (table) => {
    table.string("projection_id", 56).primary();
    table.integer("data_kind").notNullable();
    addBinding(table);
    table.string("target_identity_id", 64).notNullable();
    table.string("current_target_version_id", 64).notNullable();
    table.bigInteger("revision").notNullable();
    table.string("audit_event_id", 36).notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.check("length(projection_id) = 56");
    table.check("substr(projection_id, 1, 4) = 'prj_'");
    table.check(
      "substr(projection_id, 5) NOT GLOB '*[^a-z2-7]*'");
    table.check("data_kind IN (1, 2)");
    addBindingChecks(table);
    addCanonicalIdentifierCheck(table, "target_identity_id");
    addCanonicalIdentifierCheck(table, "current_target_version_id");
    table.check("revision > 0");
    addAuditEventIdCheck(table);
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
  });
  await knex.schema.createTable("projection_targets", (table) => {
    table.string("projection_id", 56).notNullable()
      .references("projection_id")
      .inTable("projections")
      .onDelete("RESTRICT");
    table.string("target_version_id", 64).notNullable();
    table.bigInteger("entered_at_revision").notNullable();
    table.primary(["projection_id", "target_version_id"]);
    addCanonicalIdentifierCheck(table, "target_version_id");
    table.check("entered_at_revision > 0");
  });
}

function addBinding(table: Knex.CreateTableBuilder): void {
  table.integer("scope_kind").notNullable();
  table.string("placement_id", 64).notNullable();
  table.string("tenant_id", 64).nullable();
  table.string("workspace_id", 64).nullable();
  table.string("account_principal_id", 256).nullable();
  table.string("consumer_id", 64).notNullable();
  table.string("purpose", 64).notNullable();
}

function addBindingChecks(table: Knex.CreateTableBuilder): void {
  table.check("scope_kind BETWEEN 1 AND 4");
  addCanonicalIdentifierCheck(table, "placement_id");
  table.check(
    "tenant_id IS NULL OR (length(tenant_id) BETWEEN 1 AND 64 "
    + "AND tenant_id GLOB '[a-z0-9]*' "
    + "AND tenant_id NOT GLOB '*[^a-z0-9_-]*')");
  table.check(
    "workspace_id IS NULL OR (length(workspace_id) BETWEEN 1 AND 64 "
    + "AND workspace_id GLOB '[a-z0-9]*' "
    + "AND workspace_id NOT GLOB '*[^a-z0-9_-]*')");
  table.check(
    "account_principal_id IS NULL OR "
    + "(length(account_principal_id) BETWEEN 3 AND 256 "
    + "AND (account_principal_id GLOB 'user:*' "
    + "OR account_principal_id GLOB 'service:*'))");
  addCanonicalIdentifierCheck(table, "consumer_id");
  table.check("length(purpose) BETWEEN 1 AND 64");
  table.check("purpose GLOB '[a-z]*'");
  table.check("purpose NOT GLOB '*[^a-z0-9_]*'");
  table.check("purpose NOT GLOB '*__*'");
  table.check("substr(purpose, -1) <> '_'");
  table.check(
    "(scope_kind = 1 AND tenant_id IS NULL "
    + "AND workspace_id IS NULL AND account_principal_id IS NULL) OR "
    + "(scope_kind = 2 AND tenant_id IS NOT NULL "
    + "AND workspace_id IS NULL AND account_principal_id IS NULL) OR "
    + "(scope_kind = 3 AND tenant_id IS NOT NULL "
    + "AND workspace_id IS NOT NULL "
    + "AND account_principal_id IS NULL) OR "
    + "(scope_kind = 4 AND tenant_id IS NOT NULL "
    + "AND workspace_id IS NULL "
    + "AND account_principal_id IS NOT NULL)");
}

function addAuditEventIdCheck(table: Knex.CreateTableBuilder): void {
  table.check("length(audit_event_id) = 36");
  table.check("substr(audit_event_id, 1, 4) = 'evt_'");
  table.check(
    "substr(audit_event_id, 5) NOT GLOB '*[^0-9a-f]*'");
}

function addClaimPairChecks(table: Knex.CreateTableBuilder): void {
  table.check(
    "(dependency_claim_id IS NULL "
    + "AND dependency_claim_revision IS NULL) OR "
    + "(dependency_claim_id IS NOT NULL "
    + "AND dependency_claim_revision > 0)");
  table.check(
    "dependency_claim_id IS NULL OR "
    + "(length(dependency_claim_id) = 36 "
    + "AND substr(dependency_claim_id, 1, 4) = 'dpc-' "
    + "AND substr(dependency_claim_id, 5) "
    + "NOT GLOB '*[^0-9a-f]*')");
}

function addCanonicalIdentifierCheck(
  table: Knex.CreateTableBuilder,
  column: string
): void {
  table.check(`length(${column}) BETWEEN 1 AND 64`);
  table.check(`${column} GLOB '[a-z0-9]*'`);
  table.check(`${column} NOT GLOB '*[^a-z0-9_-]*'`);
}
