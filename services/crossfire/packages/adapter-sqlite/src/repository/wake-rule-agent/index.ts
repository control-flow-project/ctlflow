import type Database from 'better-sqlite3';
import { executeSelect, executeInsert, executeUpdate, executeDelete } from '@tinqerjs/better-sqlite3-adapter';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import type { WakeRuleAgent, WakeRuleAgentRepository } from '@ctlflow/crossfire-domain/wake-up/types';
import { schema, type Tables } from '../../schema/tables.js';
import { stored } from '../stored.js';
import { mapWakeRule } from '../wake-rule/map.js';

function mapAssignment(row: Tables['wake_rule_agent']): WakeRuleAgent {
  return { ruleId: row.rule_id, agentId: row.agent_id, nextDueAt: row.next_due_at, lastDeliveredAt: row.last_delivered_at };
}
export function createWakeRuleAgentRepository(database: Database.Database): WakeRuleAgentRepository {
  return {
    find(ruleId, agentId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('wake_rule_agent')
        .where(row => row.rule_id === params.ruleId && row.agent_id === params.agentId).firstOrDefault(), { ruleId, agentId });
      return success(row ? mapAssignment(row) : null);
    }); },
    forRules(ruleIds) { return stored(() => success(ruleIds.length ? executeSelect(database, schema, (query, params) => query.from('wake_rule_agent')
      .where(row => params.ruleIds.includes(row.rule_id)).orderBy(row => row.rule_id).thenBy(row => row.agent_id), { ruleIds }).map(mapAssignment) : [])); },
    insert(assignment) { return stored(() => {
      executeInsert(database, schema, (query, params) => query.insertInto('wake_rule_agent').values({ rule_id: params.ruleId, agent_id: params.agentId,
        next_due_at: params.nextDueAt, last_delivered_at: params.lastDeliveredAt }), assignment);
      return success(undefined);
    }); },
    update(assignment) { return stored(() => {
      const count = executeUpdate(database, schema, (query, params) => query.update('wake_rule_agent').set({
        next_due_at: params.nextDueAt, last_delivered_at: params.lastDeliveredAt,
      }).where(row => row.rule_id === params.ruleId && row.agent_id === params.agentId), assignment);
      return count === 1 ? success(undefined) : failure('missing', 'Wake-up agent not found');
    }); },
    remove(ruleId, agentId) { return stored(() => {
      executeDelete(database, schema, (query, params) => query.deleteFrom('wake_rule_agent')
        .where(row => row.rule_id === params.ruleId && row.agent_id === params.agentId), { ruleId, agentId });
      return success(undefined);
    }); },
    due(agentId, now) { return stored(() => {
      const rows = executeSelect(database, schema, (query, params) => query.from('wake_rule_agent').join(query.from('wake_rule'),
        assignment => assignment.rule_id, rule => rule.id, (assignment, rule) => ({ assignment, rule }))
        .where(row => row.assignment.agent_id === params.agentId && row.assignment.next_due_at <= params.now && row.rule.enabled === 1)
        .orderBy(row => row.assignment.next_due_at).thenBy(row => row.rule.id).take(100).select(row => ({
          id: row.rule.id, owner_id: row.rule.owner_id, configured_by_id: row.rule.configured_by_id, name: row.rule.name, message: row.rule.message,
          schedule_kind: row.rule.schedule_kind, interval_seconds: row.rule.interval_seconds, cron_expression: row.rule.cron_expression,
          time_zone: row.rule.time_zone, enabled: row.rule.enabled, revision: row.rule.revision, created_at: row.rule.created_at, updated_at: row.rule.updated_at,
          rule_id: row.assignment.rule_id, agent_id: row.assignment.agent_id, next_due_at: row.assignment.next_due_at, last_delivered_at: row.assignment.last_delivered_at,
        })), { agentId, now });
      return success(rows.map(row => ({ rule: mapWakeRule(row), assignment: mapAssignment(row) })));
    }); },
    nextDueAt(agentId) { return stored(() => {
      const row = executeSelect(database, schema, (query, params) => query.from('wake_rule_agent').join(query.from('wake_rule'),
        assignment => assignment.rule_id, rule => rule.id, (assignment, rule) => ({ assignment, rule }))
        .where(row => row.assignment.agent_id === params.agentId && row.rule.enabled === 1).orderBy(row => row.assignment.next_due_at)
        .select(row => ({ nextDueAt: row.assignment.next_due_at })).firstOrDefault(), { agentId });
      return success(row?.nextDueAt ?? null);
    }); },
  };
}
