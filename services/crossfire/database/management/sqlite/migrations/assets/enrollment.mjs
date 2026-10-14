import { createHash, randomUUID } from 'node:crypto';
import { executeSql, tableDefinition } from './sqlite.mjs';

export async function archiveLabels(knex) {
  const labels = await knex('agent').select('principal_id', 'owner_id', 'display_name_override').whereNotNull('display_name_override');
  const now = Date.now();
  for (const label of labels) await knex('audit_event').insert({
    id: randomUUID(), request_id: 'schema-15-agent-names', actor_kind: 'system', owner_id: label.owner_id,
    target_kind: 'agent', target_id: label.principal_id, action: 'agent.name.canonicalized', outcome: 'applied',
    message: JSON.stringify({ retiredDisplayName: label.display_name_override }), created_at: now,
  });
}

const relations = [
  ['enrollment_item', 'enrollment_archive_item', 'request_id'],
  ['enrollment_item_policy', 'enrollment_archive_policy', 'request_id'],
  ['enrollment_item_permission', 'enrollment_archive_permission', 'request_id'],
  ['enrollment_item_wake_sender', 'enrollment_archive_wake_sender', 'request_id'],
  ['enrollment_controller_metadata', 'enrollment_archive_metadata', 'enrollment_id'],
];

async function archivePartialRosters(knex) {
  const failed = await knex('enrollment_item').select('request_id').where('outcome', 'failed').distinct();
  for (const item of failed) {
    const requestId = item.request_id;
    const request = await knex('enrollment_request').where('id', requestId).first();
    await knex('enrollment_archive').insert(request);
    for (const [source, target, key] of relations) {
      const rows = await knex(source).where(key, requestId).select('*');
      if (rows.length) await knex(target).insert(rows);
    }
    await knex('agent_name').where('request_id', requestId).del();
    for (const [source, , key] of [relations[2], relations[3], relations[1], relations[4], relations[0]])
      await knex(source).where(key, requestId).del();
    await knex('enrollment_request').where('id', requestId).del();
  }
}

export async function replaceEnrollmentItems(knex, schema) {
  await archivePartialRosters(knex);
  const definition = tableDefinition(schema.parts.enrollmentSchema, 'enrollment_item');
  await executeSql(knex, definition.replace('CREATE TABLE enrollment_item', 'CREATE TABLE enrollment_item_next')
    .replace('ON enrollment_item(', 'ON enrollment_item_next(').replace('ix_enrollment_item_agent', 'ix_enrollment_item_agent_next'));
  const rows = await knex('enrollment_item').select('*');
  for (const row of rows) {
    if (row.outcome === 'failed' || row.failure_code !== null) throw new Error('A partially admitted roster was not archived');
    await knex('enrollment_item_next').insert({ request_id: row.request_id, instance_key: row.instance_key,
      requested_name: row.requested_name, outcome: row.outcome, agent_id: row.agent_id });
  }
  await executeSql(knex, 'DROP TABLE enrollment_item; ALTER TABLE enrollment_item_next RENAME TO enrollment_item; DROP INDEX ix_enrollment_item_agent_next;');
  await executeSql(knex, definition.slice(definition.indexOf('CREATE INDEX')));
}

export async function updatePendingDigests(knex) {
  const ordering = new Intl.Collator('en-US');
  const requests = await knex('enrollment_request').where('status', 'pending').select('*');
  for (const request of requests) {
    const principal = await knex('principal').where('id', request.owner_id).first();
    const items = await knex('enrollment_item').where('request_id', request.id).select('*');
    const policies = await knex('enrollment_item_policy').where('request_id', request.id).select('*');
    const permissions = await knex('enrollment_item_permission').where('request_id', request.id).select('*');
    const senders = await knex('enrollment_item_wake_sender as sender').join('principal', 'principal.id', 'sender.sender_principal_id')
      .where('sender.request_id', request.id).select('sender.instance_key', 'sender.include_agents', 'principal.matrix_user_id');
    const metadata = await knex('enrollment_controller_metadata').where('enrollment_id', request.id).select('key', 'value');
    if (policies.length !== items.length) throw new Error('Pending enrollment has incomplete wake authority');
    const roster = JSON.stringify({ owner: principal.matrix_user_id, fleet: request.fleet_key,
      controller: { name: request.controller_name, metadata: metadata.map(row => [row.key, row.value])
        .sort(([left], [right]) => ordering.compare(left, right)) },
      items: items.map(item => {
        const policy = policies.find(row => row.instance_key === item.instance_key);
        if (!policy) throw new Error('Pending enrollment policy is missing');
        return [item.instance_key, item.requested_name, item.outcome === 'existing' ? item.agent_id : null, {
          wakeMode: policy.wake_mode,
          senders: senders.filter(row => row.instance_key === item.instance_key)
            .map(row => ({ matrixUserId: row.matrix_user_id, includeAgents: row.include_agents === 1 }))
            .sort((left, right) => ordering.compare(left.matrixUserId, right.matrixUserId)),
          permissions: permissions.filter(row => row.instance_key === item.instance_key).map(row => row.permission_code).sort(),
        }];
      }).sort((left, right) => ordering.compare(left[0], right[0])),
    });
    await knex('enrollment_request').where('id', request.id).update({ roster_digest: createHash('sha256').update(roster).digest('hex') });
  }
}
