import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { failure, success } from '@crossfire/kernel/result';
import type { WakeRuleRepository } from '@crossfire/domain/wake-up/types';
import { schema } from '../../schema/tables.js';
import { stored } from '../stored.js';
import { page } from '../directory/index.js';
import { mapWakeRule, wakeRuleRow } from './map.js';

export function createWakeRuleRepository(database: Database.Database): WakeRuleRepository {
  return {
    find(id) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('wake_rule').where(row => row.id === params.id).firstOrDefault(), { id });
      return success(row ? mapWakeRule(row) : null);
    }); },
    insert(rule) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('wake_rule').values({
        id: params.id, owner_id: params.owner_id, configured_by_id: params.configured_by_id, name: params.name, message: params.message,
        schedule_kind: params.schedule_kind, interval_seconds: params.interval_seconds, cron_expression: params.cron_expression,
        time_zone: params.time_zone, enabled: params.enabled, revision: params.revision, created_at: params.created_at, updated_at: params.updated_at,
      }), wakeRuleRow(rule));
      return success(undefined);
    }); },
    update(rule) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('wake_rule').set({
        configured_by_id: params.configured_by_id, name: params.name, message: params.message, schedule_kind: params.schedule_kind,
        interval_seconds: params.interval_seconds, cron_expression: params.cron_expression, time_zone: params.time_zone,
        enabled: params.enabled, revision: params.revision, updated_at: params.updated_at,
      }).where(row => row.id === params.id), wakeRuleRow(rule));
      return count === 1 ? success(undefined) : failure('missing', 'Wake-up not found');
    }); },
    remove(id) { return stored(() => {
      executeDelete(database, schema, (query, params) => query.deleteFrom('wake_rule').where(row => row.id === params.id), { id });
      return success(undefined);
    }); },
    page(input) { return stored(() => {
      const params = { ownerId: input.ownerId ?? '', search: input.search, offset: (input.page - 1) * input.pageSize, limit: input.pageSize };
      const total = input.ownerId === undefined
        ? executeSelect(database, schema, (query, params) => query.from('wake_rule').where(row => row.name.includes(params.search)).count(), params)
        : executeSelect(database, schema, (query, params) => query.from('wake_rule').where(row => row.owner_id === params.ownerId && row.name.includes(params.search)).count(), params);
      const rows = input.ownerId === undefined
        ? executeSelect(database, schema, (query, params) => query.from('wake_rule').where(row => row.name.includes(params.search))
          .orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), params)
        : executeSelect(database, schema, (query, params) => query.from('wake_rule').where(row => row.owner_id === params.ownerId && row.name.includes(params.search))
          .orderByDescending(row => row.created_at).thenBy(row => row.id).skip(params.offset).take(params.limit), params);
      return success(page(rows.map(mapWakeRule), total, input));
    }); },
  };
}
