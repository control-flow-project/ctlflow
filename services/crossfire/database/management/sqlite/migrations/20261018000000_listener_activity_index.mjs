export async function up(knex) {
  await knex.schema.alterTable('listener_run', table => table.index(
    ['agent_id', 'last_seen_at', 'id', 'active_ms', 'messages_delivered'], 'ix_listener_run_agent_totals'));
  await knex.raw('PRAGMA user_version=18');
}

export async function down() {
  throw new Error('Production data resets and destructive schema rollback are prohibited; use a reviewed forward migration');
}
