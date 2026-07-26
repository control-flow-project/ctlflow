import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("accounts", (table) => {
    table.string("account_id", 256).primary();
    table.integer("kind").notNullable();
    table.integer("enabled").notNullable();
    table.bigInteger("revision").notNullable();
    table.check("length(account_id) BETWEEN 6 AND 256");
    table.check("account_id NOT GLOB '*[^a-z0-9:_.-]*'");
    table.check(
      "length(account_id) - length(replace(account_id, ':', '')) = 1");
    table.check(
      "(kind = 1 AND account_id GLOB 'user:[a-z0-9]*') "
      + "OR (kind = 2 AND account_id GLOB 'service:[a-z0-9]*')");
    table.check("enabled IN (0, 1)");
    table.check("revision > 0");
  });

  await knex.schema.createTable("virtual_principals", (table) => {
    table.string("principal_id", 256).primary();
    table.string("subject_account_id", 256).notNullable()
      .references("account_id").inTable("accounts").onDelete("RESTRICT");
    table.integer("enabled").notNullable();
    table.bigInteger("revision").notNullable();
    table.string("tenant_fence_id", 64).notNullable();
    table.string("workspace_fence_id", 64).nullable();
    table.index(
      ["subject_account_id"],
      "virtual_principals_subject_account_idx");
    table.check("length(principal_id) BETWEEN 7 AND 256");
    table.check("principal_id GLOB 'agent:[a-z0-9]*'");
    table.check("principal_id NOT GLOB '*[^a-z0-9:_.-]*'");
    table.check(
      "length(principal_id) - length(replace(principal_id, ':', '')) = 1");
    table.check("principal_id <> subject_account_id");
    table.check("enabled IN (0, 1)");
    table.check("revision > 0");
    table.check("length(tenant_fence_id) BETWEEN 1 AND 64");
    table.check("tenant_fence_id GLOB '[a-z0-9]*'");
    table.check("tenant_fence_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check(
      "workspace_fence_id IS NULL "
      + "OR (length(workspace_fence_id) BETWEEN 1 AND 64 "
      + "AND workspace_fence_id GLOB '[a-z0-9]*' "
      + "AND workspace_fence_id NOT GLOB '*[^a-z0-9_-]*')");
  });

  await knex.schema.createTable("tenant_memberships", (table) => {
    table.string("account_id", 256).notNullable()
      .references("account_id").inTable("accounts").onDelete("RESTRICT");
    table.string("tenant_id", 64).notNullable();
    table.bigInteger("revision").notNullable();
    table.primary(["account_id", "tenant_id"]);
    table.index(
      ["tenant_id", "account_id"],
      "tenant_memberships_target_idx");
    table.check("length(tenant_id) BETWEEN 1 AND 64");
    table.check("tenant_id GLOB '[a-z0-9]*'");
    table.check("tenant_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("revision > 0");
  });

  await knex.schema.createTable("workspace_memberships", (table) => {
    table.string("account_id", 256).notNullable();
    table.string("tenant_id", 64).notNullable();
    table.string("workspace_id", 64).notNullable();
    table.bigInteger("revision").notNullable();
    table.primary(["account_id", "tenant_id", "workspace_id"]);
    table.foreign(["account_id", "tenant_id"])
      .references(["account_id", "tenant_id"])
      .inTable("tenant_memberships")
      .onDelete("RESTRICT");
    table.index(
      ["tenant_id", "workspace_id", "account_id"],
      "workspace_memberships_target_idx");
    table.check("length(tenant_id) BETWEEN 1 AND 64");
    table.check("tenant_id GLOB '[a-z0-9]*'");
    table.check("tenant_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("length(workspace_id) BETWEEN 1 AND 64");
    table.check("workspace_id GLOB '[a-z0-9]*'");
    table.check("workspace_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("revision > 0");
  });

  await knex.schema.createTable("groups", (table) => {
    table.string("group_id", 64).primary();
    table.string("tenant_id", 64).notNullable();
    table.string("workspace_id", 64).nullable();
    table.index(
      ["tenant_id", "workspace_id", "group_id"],
      "groups_target_page_idx");
    table.check("length(group_id) BETWEEN 1 AND 64");
    table.check("group_id GLOB '[a-z0-9]*'");
    table.check("group_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("length(tenant_id) BETWEEN 1 AND 64");
    table.check("tenant_id GLOB '[a-z0-9]*'");
    table.check("tenant_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check(
      "workspace_id IS NULL "
      + "OR (length(workspace_id) BETWEEN 1 AND 64 "
      + "AND workspace_id GLOB '[a-z0-9]*' "
      + "AND workspace_id NOT GLOB '*[^a-z0-9_-]*')");
  });

  await knex.schema.createTable("account_group_memberships", (table) => {
    table.string("account_id", 256).notNullable()
      .references("account_id").inTable("accounts").onDelete("RESTRICT");
    table.string("group_id", 64).notNullable()
      .references("group_id").inTable("groups").onDelete("RESTRICT");
    table.primary(["account_id", "group_id"]);
    table.index(
      ["group_id"],
      "account_group_memberships_group_idx");
  });

  await knex.schema.createTable(
    "virtual_principal_group_memberships",
    (table) => {
      table.string("principal_id", 256).notNullable()
        .references("principal_id")
        .inTable("virtual_principals")
        .onDelete("RESTRICT");
      table.string("group_id", 64).notNullable()
        .references("group_id").inTable("groups").onDelete("RESTRICT");
      table.primary(["principal_id", "group_id"]);
      table.index(
        ["group_id"],
        "virtual_principal_group_memberships_group_idx");
    });

  await knex.schema.createTable(
    "invocation_verification_keys",
    (table) => {
      table.string("key_id", 128).primary();
      table.string("algorithm", 8).notNullable();
      table.string("modulus_base64url", 1368).notNullable();
      table.string("exponent_base64url", 16).notNullable();
      table.integer("state").notNullable();
      table.bigInteger("revision").notNullable();
      table.index(
        ["state", "key_id"],
        "invocation_verification_keys_current_idx");
      table.check("length(key_id) BETWEEN 1 AND 128");
      table.check("key_id NOT GLOB '*[^ -~]*'");
      table.check("algorithm = 'RS256'");
      table.check("length(modulus_base64url) BETWEEN 171 AND 1368");
      table.check("modulus_base64url NOT GLOB '*[^A-Za-z0-9_-]*'");
      table.check("length(exponent_base64url) BETWEEN 2 AND 16");
      table.check("exponent_base64url NOT GLOB '*[^A-Za-z0-9_-]*'");
      table.check("state IN (1, 2)");
      table.check("revision > 0");
    });

  await knex.schema.createTable("external_identity_links", (table) => {
    table.string("tenant_id", 64).notNullable();
    table.string("provider_id", 64).notNullable();
    table.string("provider_subject", 512).notNullable();
    table.string("account_id", 256).notNullable();
    table.bigInteger("revision").notNullable();
    table.primary(["tenant_id", "provider_id", "provider_subject"]);
    table.foreign(["account_id", "tenant_id"])
      .references(["account_id", "tenant_id"])
      .inTable("tenant_memberships")
      .onDelete("RESTRICT");
    table.index(
      ["account_id", "tenant_id"],
      "external_identity_links_account_idx");
    table.check("length(tenant_id) BETWEEN 1 AND 64");
    table.check("tenant_id GLOB '[a-z0-9]*'");
    table.check("tenant_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("length(provider_id) BETWEEN 1 AND 64");
    table.check("provider_id GLOB '[a-z0-9]*'");
    table.check("provider_id NOT GLOB '*[^a-z0-9_-]*'");
    table.check("length(provider_subject) BETWEEN 1 AND 512");
    table.check("revision > 0");
  });

  await knex.schema.createTable("sessions", (table) => {
    table.string("session_id", 32).primary();
    table.string("credential_digest", 64).notNullable().unique();
    table.string("account_id", 256).notNullable();
    table.string("tenant_id", 64).notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("expires_at_unix_ms").notNullable();
    table.bigInteger("revoked_at_unix_ms").nullable();
    table.bigInteger("revision").notNullable();
    table.foreign(["account_id", "tenant_id"])
      .references(["account_id", "tenant_id"])
      .inTable("tenant_memberships")
      .onDelete("RESTRICT");
    table.index(
      ["account_id", "tenant_id"],
      "sessions_account_idx");
    table.check("length(session_id) = 32");
    table.check("session_id NOT GLOB '*[^a-f0-9]*'");
    table.check("length(credential_digest) = 64");
    table.check("credential_digest NOT GLOB '*[^a-f0-9]*'");
    table.check("created_at_unix_ms > 0");
    table.check("expires_at_unix_ms > created_at_unix_ms");
    table.check(
      "revoked_at_unix_ms IS NULL "
      + "OR revoked_at_unix_ms >= created_at_unix_ms");
    table.check("revision > 0");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("sessions");
  await knex.schema.dropTableIfExists("external_identity_links");
  await knex.schema.dropTableIfExists(
    "invocation_verification_keys");
  await knex.schema.dropTableIfExists(
    "virtual_principal_group_memberships");
  await knex.schema.dropTableIfExists(
    "account_group_memberships");
  await knex.schema.dropTableIfExists("groups");
  await knex.schema.dropTableIfExists("workspace_memberships");
  await knex.schema.dropTableIfExists("tenant_memberships");
  await knex.schema.dropTableIfExists("virtual_principals");
  await knex.schema.dropTableIfExists("accounts");
}
