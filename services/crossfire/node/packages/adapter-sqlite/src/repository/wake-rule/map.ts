import type { WakeRule } from '@ctlflow/crossfire-domain/wake-up/types';
import type { Tables } from '../../schema/tables.js';

export function mapWakeRule(row: Tables['wake_rule']): WakeRule {
  if (row.schedule_kind === 'interval' && row.interval_seconds === null
    || row.schedule_kind === 'cron' && (row.cron_expression === null || row.time_zone === null)) throw new Error('Invalid stored wake schedule');
  return { id: row.id, ownerId: row.owner_id, configuredById: row.configured_by_id, name: row.name, message: row.message,
    schedule: row.schedule_kind === 'interval' ? { kind: 'interval', seconds: row.interval_seconds! }
      : { kind: 'cron', expression: row.cron_expression!, timeZone: row.time_zone! },
    enabled: row.enabled === 1, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}
export function wakeRuleRow(rule: WakeRule): Tables['wake_rule'] {
  return { id: rule.id, owner_id: rule.ownerId, configured_by_id: rule.configuredById, name: rule.name, message: rule.message,
    schedule_kind: rule.schedule.kind, interval_seconds: rule.schedule.kind === 'interval' ? rule.schedule.seconds : null,
    cron_expression: rule.schedule.kind === 'cron' ? rule.schedule.expression : null,
    time_zone: rule.schedule.kind === 'cron' ? rule.schedule.timeZone : null,
    enabled: rule.enabled ? 1 : 0, revision: rule.revision, created_at: rule.createdAt, updated_at: rule.updatedAt };
}
