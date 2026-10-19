import type Database from 'better-sqlite3';
import { executeSelect, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '../../schema/tables.js';

export function pruneWorkflows(database: Database.Database, cutoff: number, limit: number): number[] {
  const parameters = { cutoff, limit };
  const audit = executeSelect(database, schema, (query, params) => query.from('audit_event').where(row => row.created_at < params.cutoff)
    .orderBy(row => row.created_at).thenBy(row => row.id).take(params.limit).select(row => ({ id: row.id })), parameters).map(row => row.id);
  if (audit.length) executeDelete(database, schema, (query, params) => query.deleteFrom('audit_event').where(row => params.ids.includes(row.id)), { ids: audit });
  const notices = executeSelect(database, schema, (query, params) => query.from('wake_notice')
    .where(row => row.status !== 'pending' && (row.sent_at ?? row.reserved_at) < params.cutoff)
    .orderBy(row => row.reserved_at).take(params.limit).select(row => ({ receiver: row.receiver_agent_id, room: row.room_id, event: row.event_id })), parameters);
  for (const notice of notices) executeDelete(database, schema, (query, params) => query.deleteFrom('wake_notice')
    .where(row => row.receiver_agent_id === params.receiver && row.room_id === params.room && row.event_id === params.event), notice);
  const wakes = executeSelect(database, schema, (query, params) => query.from('wake_delivery')
    .where(row => row.status !== 'pending' && (row.delivered_at ?? row.created_at) < params.cutoff)
    .orderBy(row => row.created_at).thenBy(row => row.id).take(params.limit).select(row => ({ id: row.id })), parameters).map(row => row.id);
  if (wakes.length) executeDelete(database, schema, (query, params) => query.deleteFrom('wake_delivery').where(row => params.ids.includes(row.id)), { ids: wakes });
  const messages = executeSelect(database, schema, (query, params) => query.from('fleet_message').where(row => row.expires_at < params.cutoff)
    .orderBy(row => row.expires_at).thenBy(row => row.id).take(params.limit).select(row => ({ id: row.id })), parameters).map(row => row.id);
  if (messages.length) executeDelete(database, schema, (query, params) => query.deleteFrom('fleet_message').where(row => params.ids.includes(row.id)), { ids: messages });
  const invitations = executeSelect(database, schema, (query, params) => query.from('member_invitation')
    .where(row => row.expires_at < params.cutoff && (row.consumed_by_member_id !== null || row.claim_backend_user_id === null))
    .orderBy(row => row.expires_at).thenBy(row => row.id).take(params.limit).select(row => ({ id: row.id })), parameters).map(row => row.id);
  if (invitations.length) executeDelete(database, schema, (query, params) => query.deleteFrom('member_invitation').where(row => params.ids.includes(row.id)), { ids: invitations });
  const rejected = executeSelect(database, schema, (query, params) => query.from('enrollment_request')
    .where(row => (row.status === 'rejected' || row.status === 'expired') && (row.decided_at ?? row.expires_at) < params.cutoff)
    .groupJoin(query.from('agent_name').where(row => row.request_id !== null), row => row.id, name => name.request_id,
      (row, names) => ({ row, names })).selectMany(value => value.names.defaultIfEmpty(), (value, name) => ({ row: value.row, name }))
    .where(value => value.name.request_id === null).orderBy(value => value.row.created_at)
    .select(value => ({ id: value.row.id })).take(params.limit), parameters).map(row => row.id);
  if (rejected.length) {
    const ids = { ids: rejected };
    executeDelete(database, schema, (query, params) => query.deleteFrom('enrollment_item_permission').where(row => params.ids.includes(row.request_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('enrollment_item_wake_sender').where(row => params.ids.includes(row.request_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('enrollment_item_policy').where(row => params.ids.includes(row.request_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('enrollment_controller_metadata').where(row => params.ids.includes(row.enrollment_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('enrollment_item').where(row => params.ids.includes(row.request_id)), ids);
    executeDelete(database, schema, (query, params) => query.deleteFrom('enrollment_request').where(row => params.ids.includes(row.id)), ids);
  }
  return [audit.length, notices.length, wakes.length, messages.length, invitations.length, rejected.length];
}
