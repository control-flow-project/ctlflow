import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("lifecycle_delivery_sequences", (table) => {
    table.integer("sequence_id").primary();
    table.bigInteger("current_sequence").notNullable();
    table.check("sequence_id = 1");
    table.check("current_sequence >= 0");
  });
  await knex("lifecycle_delivery_sequences").insert({
    sequence_id: 1,
    current_sequence: 0
  });

  await knex.schema.createTable("lifecycle_operations", (table) => {
    table.string("operation_id", 64).primary();
    table.integer("target_kind").notNullable();
    table.string("tenant_id", 64).notNullable()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("workspace_id", 64).nullable()
      .references("workspace_id").inTable("workspaces").onDelete("RESTRICT");
    table.integer("operation_kind").notNullable();
    table.integer("desired_lifecycle_state").notNullable();
    table.bigInteger("provisioning_generation").notNullable();
    table.integer("operation_state").notNullable();
    table.string("request_actor", 253).notNullable();
    table.string("idempotency_key", 128).notNullable();
    table.string("request_hash", 64).notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.unique(
      ["request_actor", "operation_kind", "idempotency_key"],
      { indexName: "lifecycle_operations_idempotency_uq" });
    table.index(
      ["tenant_id", "workspace_id", "operation_state"],
      "lifecycle_operations_target_idx");
    table.index(
      ["workspace_id"],
      "lifecycle_operations_workspace_idx");
    table.check("target_kind IN (1, 2)");
    table.check("operation_kind BETWEEN 1 AND 4");
    table.check("desired_lifecycle_state IN (2, 4, 8)");
    table.check("provisioning_generation > 0");
    table.check("operation_state BETWEEN 1 AND 3");
    table.check("length(request_hash) = 64");
    table.check("created_at_unix_ms > 0");
    table.check("updated_at_unix_ms >= created_at_unix_ms");
    table.check(
      "(target_kind = 1 AND workspace_id IS NULL)"
      + " OR (target_kind = 2 AND workspace_id IS NOT NULL)");
  });

  await knex.schema.createTable("lifecycle_steps", (table) => {
    table.string("operation_id", 64).notNullable()
      .references("operation_id").inTable("lifecycle_operations")
      .onDelete("RESTRICT");
    table.integer("step_key").notNullable();
    table.integer("step_state").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("delivery_sequence").notNullable();
    table.bigInteger("owner_revision").nullable();
    table.string("blocked_reason", 200).nullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.primary(["operation_id", "step_key"]);
    table.index(
      ["step_key", "step_state", "delivery_sequence"],
      "lifecycle_steps_owner_work_idx");
    table.check("step_key BETWEEN 1 AND 4");
    table.check("step_state BETWEEN 1 AND 3");
    table.check("revision > 0");
    table.check("delivery_sequence > 0");
    table.check("owner_revision IS NULL OR owner_revision > 0");
    table.check(
      "(step_state = 2 AND blocked_reason IS NOT NULL)"
      + " OR (step_state <> 2 AND blocked_reason IS NULL)");
    table.check("updated_at_unix_ms > 0");
  });

  await knex.schema.createTable("lifecycle_deliveries", (table) => {
    table.bigInteger("delivery_sequence").primary();
    table.string("operation_id", 64).notNullable();
    table.integer("step_key").notNullable();
    table.bigInteger("step_revision").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.foreign(["operation_id", "step_key"])
      .references(["operation_id", "step_key"])
      .inTable("lifecycle_steps")
      .onDelete("RESTRICT");
    table.foreign("operation_id")
      .references("operation_id")
      .inTable("lifecycle_operations")
      .onDelete("RESTRICT");
    table.index(
      ["step_key", "delivery_sequence"],
      "lifecycle_deliveries_owner_idx");
    table.index(
      ["operation_id", "step_key"],
      "lifecycle_deliveries_step_idx");
    table.check("step_key BETWEEN 1 AND 4");
    table.check("step_revision > 0");
    table.check("created_at_unix_ms > 0");
  });

  await knex.schema.createTable("lifecycle_page_cursors", (table) => {
    table.string("page_token", 128).primary();
    table.integer("step_key").notNullable();
    table.string("request_actor", 253).notNullable();
    table.bigInteger("last_delivery_sequence").notNullable();
    table.bigInteger("snapshot_sequence").notNullable();
    table.bigInteger("expires_at_unix_ms").notNullable();
    table.index(
      ["expires_at_unix_ms"],
      "lifecycle_page_cursors_expiry_idx");
    table.check("step_key BETWEEN 1 AND 4");
    table.check("last_delivery_sequence >= 0");
    table.check("snapshot_sequence >= last_delivery_sequence");
    table.check("expires_at_unix_ms > 0");
  });

  await knex.schema.createTable("idempotency_records", (table) => {
    table.string("idempotency_record_id", 64).primary();
    table.string("request_actor", 253).notNullable();
    table.string("operation_name", 64).notNullable();
    table.string("idempotency_key", 128).notNullable();
    table.string("request_hash", 64).notNullable();
    table.integer("resource_kind").notNullable();
    table.string("resource_id", 64).notNullable();
    table.string("lifecycle_operation_id", 64).nullable();
    table.bigInteger("result_resource_revision").notNullable();
    table.integer("result_lifecycle_state").notNullable();
    table.bigInteger("result_provisioning_generation").notNullable();
    table.bigInteger("result_step_revision").nullable();
    table.integer("result_step_state").nullable();
    table.bigInteger("result_event_sequence").notNullable();
    table.bigInteger("created_at_unix_ms").notNullable();
    table.unique(
      ["request_actor", "operation_name", "idempotency_key"],
      { indexName: "idempotency_records_request_uq" });
    table.check("length(request_hash) = 64");
    table.check("resource_kind IN (1, 2)");
    table.check("result_resource_revision > 0");
    table.check("result_lifecycle_state BETWEEN 1 AND 8");
    table.check("result_provisioning_generation > 0");
    table.check("result_step_revision IS NULL OR result_step_revision > 0");
    table.check(
      "(result_step_revision IS NULL AND result_step_state IS NULL)"
      + " OR (result_step_revision IS NOT NULL"
      + " AND result_step_state IN (1, 2, 3))");
    table.check("result_event_sequence > 0");
    table.check("created_at_unix_ms > 0");
  });

  await knex.raw(`
    CREATE TRIGGER lifecycle_operation_target_matches
    BEFORE INSERT ON lifecycle_operations
    WHEN NEW.target_kind = 2
      AND NEW.tenant_id <> (
        SELECT tenant_id
        FROM workspaces
        WHERE workspace_id = NEW.workspace_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Lifecycle target Tenant must own the Workspace');
    END
  `);

  await knex.raw(`
    CREATE TRIGGER lifecycle_operation_identity_is_immutable
    BEFORE UPDATE OF
      operation_id,
      target_kind,
      tenant_id,
      workspace_id,
      operation_kind,
      desired_lifecycle_state,
      provisioning_generation,
      request_actor,
      idempotency_key,
      request_hash
    ON lifecycle_operations
    BEGIN
      SELECT RAISE(ABORT, 'Lifecycle operation identity is immutable');
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw(
    "DROP TRIGGER IF EXISTS lifecycle_operation_identity_is_immutable");
  await knex.raw("DROP TRIGGER IF EXISTS lifecycle_operation_target_matches");
  await knex.schema.dropTableIfExists("idempotency_records");
  await knex.schema.dropTableIfExists("lifecycle_page_cursors");
  await knex.schema.dropTableIfExists("lifecycle_deliveries");
  await knex.schema.dropTableIfExists("lifecycle_steps");
  await knex.schema.dropTableIfExists("lifecycle_operations");
  await knex.schema.dropTableIfExists("lifecycle_delivery_sequences");
}
