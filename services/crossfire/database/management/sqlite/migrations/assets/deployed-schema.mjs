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
  await executeSql(knex, `
INSERT INTO agent_next SELECT principal_id,principal_kind,owner_id,
 CASE WHEN wake_mode IN ('humans','everyone') THEN wake_mode ELSE 'selected' END FROM agent;
INSERT INTO agent_wake_sender_next SELECT sender.agent_id,sender.sender_principal_id,0
 FROM agent_wake_sender AS sender JOIN agent ON agent.principal_id=sender.agent_id WHERE agent.wake_mode='selected';
INSERT INTO agent_wake_sender_next SELECT principal_id,owner_id,CASE WHEN wake_mode='owner' THEN 0 ELSE 1 END
 FROM agent WHERE wake_mode IN ('owner','owner-agents','humans');
`);
  for (const [policy, sender, request] of [['enrollment_item_policy', 'enrollment_item_wake_sender', 'enrollment_request'],
    ['enrollment_archive_policy', 'enrollment_archive_wake_sender', 'enrollment_archive']])
    await executeSql(knex, `
INSERT INTO ${policy}_next SELECT request_id,instance_key,
 CASE WHEN wake_mode IN ('humans','everyone') THEN wake_mode ELSE 'selected' END,expected_agent_revision FROM ${policy};
INSERT INTO ${sender}_next SELECT sender.request_id,sender.instance_key,sender.sender_principal_id,0
 FROM ${sender} AS sender JOIN ${policy} AS policy ON policy.request_id=sender.request_id AND policy.instance_key=sender.instance_key
 WHERE policy.wake_mode='selected';
INSERT INTO ${sender}_next SELECT policy.request_id,policy.instance_key,request.owner_id,CASE WHEN policy.wake_mode='owner' THEN 0 ELSE 1 END
 FROM ${policy} AS policy JOIN ${request} AS request ON request.id=policy.request_id WHERE policy.wake_mode IN ('owner','owner-agents','humans');
`);
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
    await knex.raw('ALTER TABLE agent DROP COLUMN display_name_override');
    await replaceEnrollmentItems(knex, schema);
  }
  if (previous <= 14) await knex('principal_application').whereIn('principal_id', knex('agent').select('principal_id'))
    .update({ applied_intent_hash: null, next_check_at: 0 });
  if (previous <= 15) {
    for (const table of ['listener_stat_usage', 'runtime_usage_checkpoint']) {
      const definition = tableDefinition(schema.parts.statisticsSchema, table);
      await createReplacement(knex, definition);
      await knex.raw('INSERT INTO ?? SELECT * FROM ??', [table + '_next', table]);
      await installReplacement(knex, definition);
    }
  }
  for (const table of ['enrollment_archive', 'enrollment_archive_item', 'enrollment_archive_policy',
    'enrollment_archive_permission', 'enrollment_archive_wake_sender', 'enrollment_archive_metadata'])
    await knex.raw('DROP TRIGGER IF EXISTS ??', ['protect_' + table + '_delete']);
  await executeSql(knex, schema.parts.loggingSchema);
}
