import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import Database from 'better-sqlite3';
import { createSchema } from '@crossfire/adapter-sqlite/schema/create-schema';
import { createRepositories } from '@crossfire/adapter-sqlite/create-repositories';
import { value } from './support/application.js';

test('actual Tinqer Wake-up pages, deadlines and pending claims seek normalized indexes', scope => {
  let statements: string[] = [];
  const database = new Database(':memory:', { verbose(statement) { if (typeof statement === 'string' && statement.startsWith('SELECT')) statements.push(statement); } });
  cleanup(scope, () => database.close()); database.pragma('foreign_keys = ON'); createSchema(database);
  const repositories = createRepositories(database);
  database.transaction(() => {
    for (let ownerIndex = 0; ownerIndex < 2; ownerIndex++) {
      const ownerId = 'owner-' + ownerIndex, agentId = 'agent-' + ownerIndex;
      value(repositories.principal.insert({ id: ownerId, matrixUserId: '@' + ownerId + ':test', kind: 'human', status: 'active', revision: 0, createdAt: 1 }));
      value(repositories.member.insert({ principalId: ownerId, principalKind: 'human', displayName: ownerId }));
      value(repositories.principal.insert({ id: agentId, matrixUserId: '@' + agentId + ':test', kind: 'agent', status: 'active', revision: 0, createdAt: 1 }));
      value(repositories.agent.insert({ principalId: agentId, principalKind: 'agent', ownerId, displayNameOverride: null, wakeMode: 'owner' }));
      value(repositories.listenerRun.insert({ id: 'run-' + ownerIndex, agentId, release: 'proof', controllerBound: false, startedAt: 1, lastSeenAt: 1,
        activeMs: 0, messagesDelivered: 0, stoppedAt: null, disconnectRequestedAt: null }));
      for (let index = 0; index < 1000; index++) {
        const ruleId = ownerId + '-rule-' + index;
        value(repositories.wakeRule.insert({ id: ruleId, ownerId, configuredById: ownerId, name: 'Rule ' + index, message: 'Fetch a report.',
          schedule: { kind: 'interval', seconds: 60 }, enabled: true, revision: 0, createdAt: index, updatedAt: index }));
        value(repositories.wakeRuleAgent.insert({ ruleId, agentId, nextDueAt: index * 1000 + 1000, lastDeliveredAt: null }));
        if (index < 200) value(repositories.wakeDelivery.insert({ id: ruleId + '-delivery', ruleId, agentId, ruleRevision: 0, runId: 'run-' + ownerIndex,
          sessionId: 'native-session', scheduledAt: 1, createdAt: 1, status: index === 0 ? 'pending' : 'delivered', deliveredAt: index === 0 ? null : 1 }));
      }
    }
  })(); database.exec('ANALYZE');
  const plan = (statement: string) => (database.prepare('EXPLAIN QUERY PLAN ' + statement).all() as { detail: string }[]).map(row => row.detail).join('\n');
  for (const pageSize of [1, 20, 100]) {
    statements = [];
    const page = value(repositories.wakeRule.page({ ownerId: 'owner-1', search: '', page: 2, pageSize }));
    assert.equal(page.totalItems, 1000); assert.equal(page.items.length, pageSize); assert.equal(statements.length, 2);
    for (const statement of statements) assert.match(plan(statement), /SEARCH .*ix_wake_rule_owner_created.*owner_id=/u);
    assert.equal(value(repositories.wakeRuleAgent.forRules(page.items.map(rule => rule.id))).length, pageSize);
    assert.equal(statements.length, 3, 'Page assignments hydrate in one batch, not per rule');
    assert.match(plan(statements[2]!), /SEARCH .*sqlite_autoindex_wake_rule_agent.*rule_id=/u);
  }
  statements = []; assert.equal(value(repositories.wakeRuleAgent.due('agent-1', 10000)).length, 10);
  assert.equal(statements.length, 1); assert.match(plan(statements[0]!), /SEARCH .*ix_wake_rule_agent_due.*agent_id=/u);
  statements = []; assert.equal(value(repositories.wakeRuleAgent.nextDueAt('agent-1')), 1000);
  assert.match(plan(statements[0]!), /SEARCH .*ix_wake_rule_agent_due.*agent_id=/u);
  statements = []; assert.equal(value(repositories.wakeDelivery.pending('agent-1'))?.id, 'owner-1-rule-0-delivery');
  assert.match(plan(statements[0]!), /SEARCH .*uq_wake_delivery_pending_agent.*agent_id=/u);
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  scope.diagnostic('2,000 rules and assignments; owner pages use two queries plus one batched assignment read; due and pending reads are indexed.');
});
