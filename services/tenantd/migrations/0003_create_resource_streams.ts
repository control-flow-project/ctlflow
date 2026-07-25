import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("resource_event_sequences", (table) => {
    table.integer("sequence_id").primary();
    table.bigInteger("current_sequence").notNullable();
    table.bigInteger("retained_from_sequence").notNullable();
    table.check("sequence_id = 1");
    table.check("current_sequence >= 0");
    table.check("retained_from_sequence > 0");
    table.check("retained_from_sequence <= current_sequence + 1");
  });
  await knex("resource_event_sequences").insert({
    sequence_id: 1,
    current_sequence: 0,
    retained_from_sequence: 1
  });

  await knex.schema.createTable("resource_events", (table) => {
    table.bigInteger("event_sequence").primary();
    table.integer("resource_kind").notNullable();
    table.integer("event_kind").notNullable();
    table.string("tenant_id", 64).notNullable()
      .references("tenant_id").inTable("tenants").onDelete("RESTRICT");
    table.string("workspace_id", 64).nullable()
      .references("workspace_id").inTable("workspaces").onDelete("RESTRICT");
    table.string("display_name", 200).notNullable();
    table.integer("lifecycle_state").notNullable();
    table.bigInteger("resource_revision").notNullable();
    table.bigInteger("provisioning_generation").notNullable();
    table.string("current_operation_id", 64).nullable();
    table.bigInteger("event_at_unix_ms").notNullable();
    table.index(
      ["resource_kind", "event_sequence"],
      "resource_events_kind_sequence_idx");
    table.index(
      ["tenant_id", "resource_kind", "event_sequence"],
      "resource_events_tenant_sequence_idx");
    table.index(["workspace_id"], "resource_events_workspace_idx");
    table.check("event_sequence > 0");
    table.check("resource_kind IN (1, 2)");
    table.check("event_kind IN (1, 2)");
    table.check("lifecycle_state BETWEEN 1 AND 8");
    table.check("resource_revision > 0");
    table.check("provisioning_generation > 0");
    table.check("event_at_unix_ms > 0");
    table.check(
      "(resource_kind = 1 AND workspace_id IS NULL)"
      + " OR (resource_kind = 2 AND workspace_id IS NOT NULL)");
  });

  await knex.schema.createTable("resource_event_conditions", (table) => {
    table.bigInteger("event_sequence").notNullable()
      .references("event_sequence").inTable("resource_events")
      .onDelete("RESTRICT");
    table.integer("step_key").notNullable();
    table.integer("step_state").notNullable();
    table.bigInteger("owner_revision").nullable();
    table.string("blocked_reason", 200).nullable();
    table.bigInteger("updated_at_unix_ms").notNullable();
    table.primary(["event_sequence", "step_key"]);
    table.check("event_sequence > 0");
    table.check("step_key BETWEEN 1 AND 4");
    table.check("step_state IN (1, 2)");
    table.check("owner_revision IS NULL OR owner_revision > 0");
    table.check(
      "(step_state = 2 AND blocked_reason IS NOT NULL)"
      + " OR (step_state = 1 AND blocked_reason IS NULL)");
    table.check("updated_at_unix_ms > 0");
  });

  await knex.schema.createTable("page_cursors", (table) => {
    table.string("page_token", 128).primary();
    table.integer("resource_kind").notNullable();
    table.string("request_actor", 253).notNullable();
    table.string("visibility_hash", 64).notNullable();
    table.string("tenant_filter", 64).nullable();
    table.string("last_resource_id", 64).notNullable();
    table.bigInteger("snapshot_sequence").notNullable();
    table.bigInteger("expires_at_unix_ms").notNullable();
    table.index(["expires_at_unix_ms"], "page_cursors_expiry_idx");
    table.check("resource_kind IN (1, 2)");
    table.check("length(visibility_hash) = 64");
    table.check("snapshot_sequence > 0");
    table.check("expires_at_unix_ms > 0");
    table.check(
      "(resource_kind = 1 AND tenant_filter IS NULL)"
      + " OR (resource_kind = 2 AND tenant_filter IS NOT NULL)");
  });

  await knex.raw(`
    CREATE TRIGGER resource_event_target_matches
    BEFORE INSERT ON resource_events
    WHEN NEW.resource_kind = 2
      AND NEW.tenant_id <> (
        SELECT tenant_id
        FROM workspaces
        WHERE workspace_id = NEW.workspace_id
      )
    BEGIN
      SELECT RAISE(ABORT, 'Resource event Tenant must own the Workspace');
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP TRIGGER IF EXISTS resource_event_target_matches");
  await knex.schema.dropTableIfExists("page_cursors");
  await knex.schema.dropTableIfExists("resource_event_conditions");
  await knex.schema.dropTableIfExists("resource_events");
  await knex.schema.dropTableIfExists("resource_event_sequences");
}
