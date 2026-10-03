import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { openStore } from '@crossfire/adapter-sqlite/open-store';
import { cleanup } from '@crossfire/test-support/cleanup';
import { join } from 'node:path';
import { mkdtempSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { listenerStatistics } from '@crossfire/agent-core/statistics';
import { eventView } from '@crossfire/agent-core/receive';
import { codexUsage } from '@crossfire/adapter-codex/usage';
import { nativeClock } from '@crossfire/adapter-runtime/clock';
import { statisticsBatch, statisticsQuery, STATISTICS_LIMITS, type UsageSample } from '@crossfire/contracts/statistics';
import { reportListener } from '@crossfire/domain/listener/report';
import { applicationFixture, value } from './support/application.js';
import { message, OBSERVER, ROOM } from '../scripts/test-support/listener.js';

const sample = (sessionId: string, input = 100, output = 20): UsageSample => ({ runtime: 'codex', sessionId,
  tokens: { input, cachedInput: input / 2, cacheWriteInput: null, output, reasoningOutput: output / 2, total: input + output } });
async function fixtureStore(scope: TestContext) {
  const file = join(mkdtempSync(join(process.cwd(), '.temp/statistics-')), 'management.sqlite'), database = openStore(file);
  cleanup(scope, () => database.close());
  return { ...await applicationFixture(scope, file), database };
}

test('persisted listener time uses integer UTC milliseconds rather than process-relative uptime', () => {
  const before = Date.now(), now = nativeClock.now(), after = Date.now();
  assert(Number.isSafeInteger(now)); assert(now >= before && now <= after);
  const statistics = listenerStatistics('@self:test.localhost', nativeClock.now);
  statistics.observed([eventView(message('$utc', OBSERVER), ROOM)]);
  const batch = statistics.batch(true)!; assert(statisticsBatch(batch).ok); assert(batch.startedAt >= before);
});

test('bounded traffic collection deduplicates observations, excludes self and notices, and retains exact batches until acknowledgment', () => {
  let now = 1000;
  const statistics = listenerStatistics('@self:test.localhost', () => now);
  const events = [eventView(message('$one', OBSERVER, '😀'), ROOM), eventView(message('$self', '@self:test.localhost'), ROOM)];
  statistics.observed(events); statistics.observed(events); statistics.delivered(events); statistics.delivered(events);
  assert.equal(statistics.batch(), null);
  now += 300000;
  const batch = statistics.batch()!; assert(statisticsBatch(batch).ok);
  assert.equal(batch.flows.length, 1); assert.equal(batch.flows[0]!.observed, 1); assert.equal(batch.flows[0]!.delivered, 1);
  assert.equal(batch.flows[0]!.contentBytes, Buffer.byteLength(JSON.stringify(events[0]!.content)));
  statistics.observed([eventView(message('$next', OBSERVER), ROOM)]);
  assert.equal(statistics.batch(), batch); statistics.acknowledge({ ...batch }); assert.equal(statistics.batch(), batch);
  statistics.acknowledge(batch); assert.equal(statistics.batch(true)!.flows[0]!.observed, 1);
});

test('collection overflow is observable and native token hooks reject corrupt, foreign and incomplete counters', () => {
  const statistics = listenerStatistics('@self:test.localhost', () => 1000);
  statistics.observed(Array.from({ length: STATISTICS_LIMITS.flows + 4 }, (_, index) => eventView(message('$' + index), '!room-' + index + ':test.localhost')));
  const batch = statistics.batch(true)!; assert.equal(batch.flows.length, 256); assert.equal(batch.dropped, 4);
  const total = { inputTokens: 100, cachedInputTokens: 50, outputTokens: 20, reasoningOutputTokens: 10, totalTokens: 120 };
  const event = { method: 'thread/tokenUsage/updated', params: { threadId: 'session', tokenUsage: { total } } };
  assert.deepEqual(codexUsage(event, 'session'), sample('session')); assert.equal(codexUsage(event, 'foreign'), null);
  assert.equal(codexUsage({ ...event, params: { threadId: 'session', tokenUsage: { total: { ...total, cachedInputTokens: 101 } } } }, 'session'), null);
  assert.equal(codexUsage({ ...event, params: { threadId: 'session', tokenUsage: {} } }, 'session'), null);
  for (const query of ['hours=24&page=2&pageSize=10', '']) assert(statisticsQuery(new URLSearchParams(query)).ok);
  for (const query of ['hours=0', 'hours=24&hours=24', 'page=1e2', 'page=01', 'agentPage=2', 'pageSize=101']) assert(!statisticsQuery(new URLSearchParams(query)).ok);
});

test('hourly normalized summaries are idempotent, paginated in SQL, token-baselined across restarts and retained for thirty days', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'stats'), other = await fixture.agent(fixture.admin.actor, 'other');
  const run = randomUUID(), session = randomUUID(), collected = listenerStatistics(agent.matrixUserId, fixture.now);
  const heartbeat = (statistics: ReturnType<typeof collected.batch>, runId = run) => value(reportListener(fixture.services, agent.actor, agent.id, runId,
    { release: 'fixture', messagesDelivered: 2, stopped: false, controllerBound: true, statistics }, 'fixture'));
  collected.observed([eventView(message('$first', OBSERVER), ROOM)]); collected.usage(sample(session));
  fixture.advance(300000); const first = collected.batch()!; assert(heartbeat(first).statisticsAccepted); assert(heartbeat(first).statisticsAccepted);
  const read = () => value(fixture.services.statistics.read([agent.id], fixture.now() - 3600000, 1, 1));
  assert.equal(read().totals.observed, 1); assert.equal(read().tokens!.input, 0);
  collected.acknowledge(first);
  collected.observed([eventView(message('$second', OBSERVER), '!second:test.localhost')]); collected.usage(sample(session, 160, 40));
  fixture.advance(300000); const second = collected.batch()!; assert(heartbeat(second).statisticsAccepted);
  assert.equal(read().totals.observed, 2); assert.equal(read().totalFlows, 2); assert.equal(read().flows.length, 1);
  assert.equal(read().tokens!.input, 60); assert.equal(read().tokens!.cachedInput, 30); assert.equal(read().tokens!.output, 20); assert.equal(read().tokens!.cacheWriteInput, null);
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 2, 1)).flows.length, 1);
  assert.equal(value(fixture.services.statistics.read([other.id], 0, 1, 20)).totals.observed, 0);
  assert.equal(heartbeat({ ...second, dropped: second.dropped + 1 }).statisticsAccepted, false);
  assert.equal(read().totals.observed, 2, 'Changed retries do not duplicate traffic');
  const restarted = randomUUID(); assert(heartbeat({ ...second, sequence: 1, flows: [], usage: [sample(session, 200, 50)] }, restarted).statisticsAccepted);
  assert.equal(read().tokens!.input, 100, 'A new reporting run retains the original native session counter');
  const database = fixture.database;
  assert.deepEqual(database.pragma('foreign_key_check'), []);
  const plan = database.prepare('EXPLAIN QUERY PLAN SELECT * FROM listener_stat_interval WHERE agent_id = ? AND captured_at >= ?').all(agent.id, 0) as { detail: string }[];
  assert(plan.some(row => row.detail.includes('ix_listener_stat_interval_agent_captured')));
  fixture.advance(31 * 86400000);
  assert(heartbeat({ ...second, sequence: 2, flows: [], usage: [sample(session, 200, 50)] }, restarted).statisticsAccepted);
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 1, 20)).totals.observed, 0);
});

test('statistics transaction failure never cancels the independently committed listener heartbeat', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'heartbeat');
  const run = randomUUID();
  fixture.database.exec("CREATE TRIGGER reject_statistics BEFORE INSERT ON listener_stat_interval BEGIN SELECT RAISE(ABORT, 'fixture statistics failure'); END");
  const result = value(reportListener(fixture.services, agent.actor, agent.id, run, { release: 'fixture', messagesDelivered: 1, stopped: false, controllerBound: false,
    statistics: { sequence: 1, startedAt: fixture.now(), endedAt: fixture.now(), dropped: 0, flows: [], usage: [] } }, 'fixture'));
  assert.equal(result.statisticsAccepted, false); assert.equal(result.disconnect, false);
  assert(value(fixture.services.repositories.listenerRun.find({ id: run })));
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 1, 20)).intervals, 0);
});
