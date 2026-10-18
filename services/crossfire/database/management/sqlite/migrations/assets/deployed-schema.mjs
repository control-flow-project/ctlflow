import { archiveLabels, replaceEnrollmentItems, updatePendingDigests } from './enrollment.mjs';
import { createReplacement, executeSql, installReplacement, tableDefinition } from './sqlite.mjs';

async function convertWakeAuthority(knex, schema) {
  await archiveLabels(knex);
  for (const table of ['enrollment_archive_policy', 'enrollment_archive_wake_sender'])
    await executeSql(knex, 'DROP TRIGGER protect_' + table + '_update; DROP TRIGGER protect_' + table + '_delete;');
  const definitions = [tableDefinition(schema.parts.identitySchema, 'agent'), tableDefinition(schema.parts.roomAccessSchema, 'agent_wake_sender'),
    tableDefinition(schema.parts.fleetPolicySchema, 'enrollment_item_policy'), tableDefinition(schema.parts.fleetPolicySchema, 'enrollment_item_wake_sender'),
    tableDefinition(schema.parts.enrollmentArchiveSchema, 'enrollment_archive_policy'), tableDefinition(schema.parts.enrollmentArchiveSchema, 'enrollment_archive_wake_sender')];
  for (const definition of definitions) await createReplacement(knex, definition);
  const agents = await knex('agent').select('principal_id', 'principal_kind', 'owner_id', 'wake_mode');
  await insertRows(knex, 'agent_next', agents.map(row => ({ principal_id: row.principal_id, principal_kind: row.principal_kind,
    owner_id: row.owner_id, wake_mode: ['humans', 'everyone'].includes(row.wake_mode) ? row.wake_mode : 'selected' })));
  const selected = await knex('agent_wake_sender as sender').join('agent', 'agent.principal_id', 'sender.agent_id')
    .where('agent.wake_mode', 'selected').select('sender.agent_id', 'sender.sender_principal_id');
  await insertRows(knex, 'agent_wake_sender_next', selected.map(row => ({ ...row, include_agents: 0 })));
  await insertRows(knex, 'agent_wake_sender_next', agents.filter(row => ['owner', 'owner-agents', 'humans'].includes(row.wake_mode))
    .map(row => ({ agent_id: row.principal_id, sender_principal_id: row.owner_id, include_agents: row.wake_mode === 'owner' ? 0 : 1 })));
  for (const [policy, sender, request] of [['enrollment_item_policy', 'enrollment_item_wake_sender', 'enrollment_request'],
    ['enrollment_archive_policy', 'enrollment_archive_wake_sender', 'enrollment_archive']]) {
    const policies = await knex(policy).select('request_id', 'instance_key', 'wake_mode', 'expected_agent_revision');
    await insertRows(knex, policy + '_next', policies.map(row => ({ ...row,
      wake_mode: ['humans', 'everyone'].includes(row.wake_mode) ? row.wake_mode : 'selected' })));
    const senders = await knex(sender + ' as sender').join(policy + ' as policy', function () {
      this.on('policy.request_id', 'sender.request_id').andOn('policy.instance_key', 'sender.instance_key');
    }).where('policy.wake_mode', 'selected').select('sender.request_id', 'sender.instance_key', 'sender.sender_principal_id');
    await insertRows(knex, sender + '_next', senders.map(row => ({ ...row, include_agents: 0 })));
    const owners = await knex(policy + ' as policy').join(request + ' as request', 'request.id', 'policy.request_id')
      .whereIn('policy.wake_mode', ['owner', 'owner-agents', 'humans'])
      .select('policy.request_id', 'policy.instance_key', 'policy.wake_mode', 'request.owner_id');
    await insertRows(knex, sender + '_next', owners.map(row => ({ request_id: row.request_id, instance_key: row.instance_key,
      sender_principal_id: row.owner_id, include_agents: row.wake_mode === 'owner' ? 0 : 1 })));
  }
  for (const definition of definitions) await installReplacement(knex, definition);
  await executeSql(knex, schema.parts.enrollmentArchiveGuards.split('CREATE TRIGGER')
    .filter(fragment => /^ protect_enrollment_archive_(policy|wake_sender)_/u.test(fragment))
    .map(fragment => 'CREATE TRIGGER' + fragment).join(''));
  await replaceEnrollmentItems(knex, schema);
  await updatePendingDigests(knex);
}

export async function advanceDeployedSchema(knex, previous, schema) {
  if (previous === 13) await convertWakeAuthority(knex, schema);
  if (previous === 14) {
    await archiveLabels(knex);
    const definition = tableDefinition(schema.parts.identitySchema, 'agent');
    await createReplacement(knex, definition);
    await knex('agent_next').insert(knex('agent').select('principal_id', 'principal_kind', 'owner_id', 'wake_mode'));
    await installReplacement(knex, definition);
    await replaceEnrollmentItems(knex, schema);
  }
  if (previous <= 14) await knex('principal_application').whereIn('principal_id', knex('agent').select('principal_id'))
    .update({ applied_intent_hash: null, next_check_at: 0 });
  if (previous <= 15) {
    for (const table of ['listener_stat_usage', 'runtime_usage_checkpoint']) {
      const definition = tableDefinition(schema.parts.statisticsSchema, table);
      await createReplacement(knex, definition);
      await knex(table + '_next').insert(knex(table).select('*'));
      await installReplacement(knex, definition);
    }
  }
  for (const table of ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy',
    'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'])
    await knex.raw('DROP TRIGGER IF EXISTS ??', ['protect_' + table + '_delete']);
  await executeSql(knex, schema.parts.loggingSchema);
}

async function insertRows(knex, table, rows) {
  for (let offset = 0; offset < rows.length; offset += 100) await knex(table).insert(rows.slice(offset, offset + 100));
}
