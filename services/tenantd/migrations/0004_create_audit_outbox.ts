import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("audit_outbox_state", (table) => {
    table.integer("state_id").primary();
    table.integer("maximum_pending").notNullable();
    table.integer("pending_count").notNullable();
    table.integer("permanently_blocked").notNullable();
    table.bigInteger("revision").notNullable();
    table.check("state_id = 1");
    table.check("maximum_pending > 0");
    table.check(
      "pending_count >= 0 AND pending_count <= maximum_pending");
    table.check("permanently_blocked IN (0, 1)");
    table.check("revision > 0");
  });
  await knex("audit_outbox_state").insert({
    state_id: 1,
    maximum_pending: 10_000,
    pending_count: 0,
    permanently_blocked: 0,
    revision: 1
  });

  await knex.schema.createTable("audit_outbox", (table) => {
    table.string("outbox_id", 64).primary();
    table.string("source_event_id", 64).notNullable().unique();
    table.bigInteger("source_sequence").notNullable().unique()
      .references("event_sequence").inTable("resource_events")
      .onDelete("RESTRICT");
    table.string("operator_subject", 253).notNullable();
    table.string("immediate_caller", 253).nullable();
    table.string("operation_name", 64).notNullable();
    table.integer("resource_kind").notNullable();
    table.string("tenant_id", 64).notNullable();
    table.string("workspace_id", 64).nullable();
    table.string("resource_id", 64).notNullable();
    table.bigInteger("resource_revision").notNullable();
    table.string("idempotency_key", 128).notNullable();
    table.bigInteger("occurred_at_unix_ms").notNullable();
    table.string("trace_id", 32).notNullable();
    table.string("span_id", 16).notNullable();
    table.integer("delivery_state").notNullable();
    table.integer("delivery_attempts").notNullable();
    table.bigInteger("revision").notNullable();
    table.bigInteger("available_at_unix_ms").notNullable();
    table.string("lease_id", 64).nullable();
    table.bigInteger("lease_expires_at_unix_ms").nullable();
    table.integer("failure_code").nullable();
    table.index(
      ["delivery_state", "available_at_unix_ms", "source_sequence"],
      "audit_outbox_delivery_idx");
    table.check("resource_kind IN (1, 2)");
    table.check("source_sequence > 0");
    table.check("resource_revision > 0");
    table.check("occurred_at_unix_ms > 0");
    table.check("length(trace_id) = 32");
    table.check("length(span_id) = 16");
    table.check("delivery_state IN (1, 2, 3)");
    table.check("delivery_attempts >= 0");
    table.check("revision > 0");
    table.check("available_at_unix_ms >= occurred_at_unix_ms");
    table.check(
      "failure_code IS NULL OR failure_code IN (1, 2, 3, 4)");
    table.check(
      "(delivery_state = 1 AND lease_id IS NULL"
      + " AND lease_expires_at_unix_ms IS NULL AND failure_code IS NULL)"
      + " OR (delivery_state = 2 AND lease_id IS NOT NULL"
      + " AND lease_expires_at_unix_ms IS NOT NULL"
      + " AND failure_code IS NULL)"
      + " OR (delivery_state = 3 AND lease_id IS NULL"
      + " AND lease_expires_at_unix_ms IS NULL"
      + " AND failure_code IS NOT NULL)");
    table.check(
      "(resource_kind = 1 AND workspace_id IS NULL)"
      + " OR (resource_kind = 2 AND workspace_id IS NOT NULL)");
  });

  await knex.raw(`
    CREATE TRIGGER audit_outbox_admission
    BEFORE INSERT ON audit_outbox
    FOR EACH ROW
    BEGIN
      SELECT CASE
        WHEN (
          SELECT permanently_blocked
          FROM audit_outbox_state
          WHERE state_id = 1
        ) = 1
        THEN RAISE(ABORT, 'audit_outbox_blocked')
        WHEN (
          SELECT pending_count >= maximum_pending
          FROM audit_outbox_state
          WHERE state_id = 1
        )
        THEN RAISE(ABORT, 'audit_outbox_capacity_exhausted')
      END;
    END
  `);
  await knex.raw(`
    CREATE TRIGGER audit_outbox_count_insert
    AFTER INSERT ON audit_outbox
    FOR EACH ROW
    BEGIN
      UPDATE audit_outbox_state
      SET pending_count = pending_count + 1,
          revision = revision + 1
      WHERE state_id = 1;
    END
  `);
  await knex.raw(`
    CREATE TRIGGER audit_outbox_count_delete
    AFTER DELETE ON audit_outbox
    FOR EACH ROW
    BEGIN
      UPDATE audit_outbox_state
      SET pending_count = pending_count - 1,
          revision = revision + 1
      WHERE state_id = 1;
    END
  `);
  await knex.raw(`
    CREATE TRIGGER audit_outbox_block
    AFTER UPDATE OF delivery_state ON audit_outbox
    FOR EACH ROW
    WHEN OLD.delivery_state <> 3 AND NEW.delivery_state = 3
    BEGIN
      UPDATE audit_outbox_state
      SET permanently_blocked = 1,
          revision = revision + 1
      WHERE state_id = 1;
    END
  `);
  await knex.raw(`
    CREATE TRIGGER audit_outbox_envelope_is_immutable
    BEFORE UPDATE ON audit_outbox
    FOR EACH ROW
    WHEN OLD.outbox_id IS NOT NEW.outbox_id
      OR OLD.source_event_id IS NOT NEW.source_event_id
      OR OLD.source_sequence IS NOT NEW.source_sequence
      OR OLD.operator_subject IS NOT NEW.operator_subject
      OR OLD.immediate_caller IS NOT NEW.immediate_caller
      OR OLD.operation_name IS NOT NEW.operation_name
      OR OLD.resource_kind IS NOT NEW.resource_kind
      OR OLD.tenant_id IS NOT NEW.tenant_id
      OR OLD.workspace_id IS NOT NEW.workspace_id
      OR OLD.resource_id IS NOT NEW.resource_id
      OR OLD.resource_revision IS NOT NEW.resource_revision
      OR OLD.idempotency_key IS NOT NEW.idempotency_key
      OR OLD.occurred_at_unix_ms IS NOT NEW.occurred_at_unix_ms
      OR OLD.trace_id IS NOT NEW.trace_id
      OR OLD.span_id IS NOT NEW.span_id
    BEGIN
      SELECT RAISE(ABORT, 'audit_outbox_envelope_is_immutable');
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP TRIGGER IF EXISTS audit_outbox_envelope_is_immutable");
  await knex.raw("DROP TRIGGER IF EXISTS audit_outbox_block");
  await knex.raw("DROP TRIGGER IF EXISTS audit_outbox_count_delete");
  await knex.raw("DROP TRIGGER IF EXISTS audit_outbox_count_insert");
  await knex.raw("DROP TRIGGER IF EXISTS audit_outbox_admission");
  await knex.schema.dropTableIfExists("audit_outbox");
  await knex.schema.dropTableIfExists("audit_outbox_state");
}
