import * as sqliteMetadata from '@ctlflow/crossfire-adapter-sqlite/schema/metadata';
import { openTestStore } from './support/storage.js';
import assert from 'node:assert/strict';
import { defineSelect } from '@tinqerjs/tinqer';
import { toSql } from '@tinqerjs/better-sqlite3-adapter';
import { schema } from '@ctlflow/crossfire-adapter-sqlite/schema/tables';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import type { TestContext } from 'node:test';
import { listenerStatistics } from '@ctlflow/crossfire-agent-core/statistics';
import { eventView } from '@ctlflow/crossfire-agent-core/receive';
import { codexUsage } from '@ctlflow/crossfire-adapter-codex/usage';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';
import { statisticsBatch, statisticsQuery, STATISTICS_LIMITS, type UsageSample } from '@ctlflow/crossfire-contracts/statistics';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { maintainLogging } from '@ctlflow/crossfire-domain/maintenance/logging';
import { applicationFixture, value } from './support/application.js';
import { message, OBSERVER, ROOM } from '../scripts/test-support/listener.js';

const sample = (sessionId: string, input = 100, output = 20): UsageSample => ({ runtime: 'codex', sessionId,
  tokens: { input, cachedInput: input / 2, cacheWriteInput: null, output, reasoningOutput: output / 2, total: input + output } });
async function fixtureStore(scope: TestContext) {
  const directory = mkdtempSync(join(process.cwd(), '.temp/statistics-'));
  cleanup(scope, () => rmSync(directory, { recursive: true }));
  const file = join(directory, 'management.sqlite'), database = openTestStore(file);
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

test('summary labels stay bounded Unicode and usage stays adapter-neutral without invalid wire batches', () => {
  const statistics = listenerStatistics('@self:test.localhost', () => 1000);
  const labels = ['a'.repeat(99) + '😀suffix', '😀'.repeat(51), '', '\n'];
  statistics.delivered(labels.map((label, index) => {
    const event = message('$bounded-' + index, OBSERVER); event.content.msgtype = label; return eventView(event, ROOM);
  }));
  const usage = { ...sample('😀'.repeat(127) + 'a'), runtime: 'custom-adapter' };
  statistics.usage(usage); statistics.usage({ ...usage, sessionId: '😀'.repeat(128) }); statistics.usage({ ...usage, runtime: 'invalid\n' });
  const batch = statistics.batch(true)!;
  assert(statisticsBatch(batch).ok); assert.equal(batch.dropped, 2); assert.equal(batch.usage.length, 1);
  assert.equal(batch.usage[0]!.runtime, 'custom-adapter');
  assert.deepEqual(batch.flows.map(flow => [flow.messageType, flow.delivered]), [['a'.repeat(99), 1], ['😀'.repeat(50), 1], ['unknown', 2]]);
});

test('counter overflow drops only that sample and preserves the last valid summary', () => {
  const statistics = listenerStatistics('@self:test.localhost', () => 1000);
  const events = [Number.MAX_SAFE_INTEGER, 1].map((size, index) => {
    const event = message('$count-' + index, OBSERVER); event.content.info = { size }; return eventView(event, ROOM);
  });
  statistics.delivered(events);
  const batch = statistics.batch(true)!;
  assert(statisticsBatch(batch).ok); assert.equal(batch.dropped, 1);
  assert.equal(batch.flows[0]!.observed, 1); assert.equal(batch.flows[0]!.delivered, 1);
  assert.equal(batch.flows[0]!.attachmentBytes, Number.MAX_SAFE_INTEGER);
});

test('hourly normalized summaries are idempotent, paginated in SQL, token-baselined across restarts and cleaned by shared retention', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'stats'), other = await fixture.agent(fixture.admin.actor, 'other');
  const run = randomUUID(), session = randomUUID(), collected = listenerStatistics(agent.matrixUserId, fixture.now);
  const heartbeat = (statistics: ReturnType<typeof collected.batch>, runId = run) => value(reportListener(fixture.services, agent.actor, agent.id, runId,
    { release: 'fixture', messagesDelivered: 2, stopped: false, controller: agent.controller, statistics }, 'fixture'));
  collected.observed([eventView(message('$first', OBSERVER), ROOM)]); collected.usage(sample(session));
  fixture.advanceConnected(300000, agent.controller); const first = collected.batch()!; assert(heartbeat(first).statisticsAccepted); assert(heartbeat(first).statisticsAccepted);
  const read = () => value(fixture.services.statistics.read([agent.id], fixture.now() - 3600000, 1, 1));
  assert.equal(read().totals.observed, 1); assert.equal(read().tokens!.input, 0);
  collected.acknowledge(first);
  collected.observed([eventView(message('$second', OBSERVER), '!second:test.localhost')]); collected.usage(sample(session, 160, 40));
  fixture.advanceConnected(300000, agent.controller); const second = collected.batch()!; assert(heartbeat(second).statisticsAccepted);
  assert.equal(read().totals.observed, 2); assert.equal(read().totalFlows, 2); assert.equal(read().flows.length, 1);
  assert.equal(read().tokens!.input, 60); assert.equal(read().tokens!.cachedInput, 30); assert.equal(read().tokens!.output, 20); assert.equal(read().tokens!.cacheWriteInput, null);
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 2, 1)).flows.length, 1);
  assert.equal(value(fixture.services.statistics.read([other.id], 0, 1, 20)).totals.observed, 0);
  assert.equal(heartbeat({ ...second, dropped: second.dropped + 1 }).statisticsAccepted, false);
  assert.equal(read().totals.observed, 2, 'Changed retries do not duplicate traffic');
  const restarted = randomUUID(); assert(heartbeat({ ...second, sequence: 1, flows: [], usage: [sample(session, 200, 50)] }, restarted).statisticsAccepted);
  assert.equal(read().tokens!.input, 100, 'A new reporting run retains the original native session counter');
  const database = fixture.database;
  assert.deepEqual(sqliteMetadata.foreignKeyViolations(database), []);
  const generated = toSql(defineSelect(schema, (query, params: { agentId: string; cutoff: number }) => query.from('listener_stat_interval')
    .where(row => row.agent_id === params.agentId && row.captured_at >= params.cutoff)), { agentId: agent.id, cutoff: 0 });
  const plan = database.prepare<[Record<string, unknown>], { detail: string }>('EXPLAIN QUERY PLAN ' + generated.sql).all(generated.params);
  assert(plan.some(row => row.detail.includes('ix_listener_stat_interval_agent_captured')));
  fixture.advance(8 * 86400000); value(maintainLogging(fixture.services)); fixture.renewController(agent.controller);
  assert(heartbeat({ ...second, sequence: 2, flows: [], usage: [sample(session, 200, 50)] }, randomUUID()).statisticsAccepted);
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 1, 20)).totals.observed, 0);
});

test('statistics transaction failure never cancels the independently committed listener heartbeat', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'heartbeat');
  const run = randomUUID();
  fixture.database.exec("CREATE TRIGGER reject_statistics BEFORE INSERT ON listener_stat_interval BEGIN SELECT RAISE(ABORT, 'fixture statistics failure'); END");
  const result = value(reportListener(fixture.services, agent.actor, agent.id, run, { release: 'fixture', messagesDelivered: 1, stopped: false, controller: agent.controller,
    statistics: { sequence: 1, startedAt: fixture.now(), endedAt: fixture.now(), dropped: 0, flows: [], usage: [] } }, 'fixture'));
  assert.equal(result.statisticsAccepted, false); assert.equal(result.disconnect, false);
  assert(value(fixture.services.repositories.listenerRun.find({ id: run })));
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 1, 20)).intervals, 0);
});

test('unknown reasoning remains unknown in mixed-runtime interval and fleet summaries', async scope => {
  const fixture = await fixtureStore(scope), agent = await fixture.agent(fixture.admin.actor, 'pi-stats');
  const runId = randomUUID(), sessionId = randomUUID();
  const report = (sequence: number, input: number, reasoningOutput: number | null) => value(reportListener(fixture.services, agent.actor, agent.id, runId,
    { release: 'fixture', stopped: false, messagesDelivered: 0, controller: agent.controller,
      statistics: { sequence, startedAt: fixture.now(), endedAt: fixture.now(), dropped: 0, flows: [],
        usage: [{ runtime: 'pi', sessionId, tokens: { input, cachedInput: 0, cacheWriteInput: 0, output: 20, reasoningOutput, total: input + 20 } }] } }, 'fixture'));
  assert(report(1, 100, null).statisticsAccepted); assert(report(2, 160, null).statisticsAccepted);
  const data = value(fixture.services.statistics.read([agent.id], 0, 1, 20));
  assert.equal(data.tokens?.input, 60); assert.equal(data.tokens?.reasoningOutput, null); assert.equal(data.agents[0]?.tokens?.reasoningOutput, null);
  assert(report(3, 200, 5).statisticsAccepted);
  assert.equal(value(fixture.services.statistics.read([agent.id], 0, 1, 20)).tokens?.reasoningOutput, null, 'Later known values cannot fill an unknown earlier interval');
});
