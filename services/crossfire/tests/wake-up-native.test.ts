import { cleanup } from '@crossfire/test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { connectCodex } from '@crossfire/adapter-codex/connection';
import { createCoordination } from '@crossfire/adapter-crossfire/coordination';
import { listen } from '@crossfire/adapter-crossfire/listener';
import { changeWakePolicy } from '@crossfire/domain/wake/change-policy';
import { createWakeRule, changeWakeRule } from '@crossfire/domain/wake-up/manage';
import { readWakeRule } from '@crossfire/domain/wake-up/read';
import { nativeProvider } from '@crossfire/test-support/native-provider';
import { nativeEngine, materialize } from '../scripts/test-support/native-engine.js';
import { testClock } from '../scripts/test-support/clock.js';
import { nativeServer } from './support/native-server.js';
import { releaseFixture } from './release-fixture.js';
import { value } from './support/application.js';

test('real Conduit and stock Codex deliver idle-only scheduled input without creating chats under Nobody authority', { timeout: 120000 }, async scope => {
  const release = await releaseFixture(), fixture = await nativeServer(scope, release), { services, admin, origin } = fixture;
  const agent = await fixture.agent(admin.actor, 'scheduled'), ruleId = randomUUID();
  value(changeWakePolicy(services, admin.actor, agent.id, { expectedRevision: 0, mode: 'nobody', senderIds: [] }, randomUUID()));
  const directory = mkdtempSync(join(process.cwd(), '.temp/wake-native-')), home = join(directory, 'home'), workspace = join(directory, 'project');
  mkdirSync(home, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
  const provider = await nativeProvider(scope, home), engine = await nativeEngine(scope, home, workspace);
  await materialize(engine, provider);
  const clock = testClock(scope);
  scope.mock.method(services.clock, 'now', clock.wallNow);
  const configuration = { name: 'Fetch fixture data', message: 'Scheduled fixture task; no paid provider.', schedule: { kind: 'interval' as const, seconds: 1 }, enabled: true, agentIds: [agent.id] };
  value(createWakeRule(services, admin.actor, ruleId, configuration, randomUUID()));
  const stop = new AbortController(); let ended: unknown, ready = false;
  const receiver = listen({ binding: 'fixture', clock, coordination: createCoordination({ origin, token: agent.token }), settings: {
    instance: 'tests', server_name: 'architecture.localhost', homeserver: origin, owner: admin.member.principal.matrixUserId, max_upload_bytes: 1024 },
    account: { user_id: agent.matrixUserId, access_token: agent.token, device_id: 'CROSSFIRE_AGENT' }, id: agent.id,
    release: release.manifest,
    cursorFile: join(directory, 'cursor.json'), limit: 100, pollMs: 100, debounceMs: 0, reconcileMs: 10000,
    ready: () => { ready = true; }, runtime: (signal, pollMs, hooks) => connectCodex({ ...engine, pollMs, timeoutMs: 10000,
      hooks: hooks ?? { requestDecision: async () => { throw new Error('Unexpected fixture permission'); } } }, signal),
  }, stop.signal).catch(error => { ended = error; });
  cleanup(scope, async () => { stop.abort(); await clock.complete(receiver); });
  const inputs = () => engine.notifications.filter(notice => notice.method === 'item/completed'
    && JSON.stringify(notice.params).includes('crossfire-wake-'));
  await clock.until(() => ready || ended !== undefined, 'Scheduled listener did not become ready', 30000); assert.equal(ended, undefined);
  await clock.until(() => inputs().length === 1 || ended !== undefined, 'First scheduled input was not published', 30000); assert.equal(ended, undefined);
  await clock.until(() => value(readWakeRule(services, admin.actor, ruleId)).lastDeliveredAt !== null || ended !== undefined, 'Exact scheduled receipt was not recorded', 10000);
  await clock.until(() => provider.held() !== undefined || ended !== undefined, 'Scheduled task did not reach inert provider');
  assert.equal(ended, undefined); assert.equal(provider.requests.length, 1);
  assert(JSON.stringify(inputs()[0]).includes(configuration.message));
  assert(JSON.stringify(inputs()[0]).includes('scheduled-wake'));
  const grants = value(services.collection.roomGrants({ agentId: agent.id }));
  assert.deepEqual(grants, []);
  assert.equal(value(services.repositories.ownerConversation.find({ agentId: agent.id })), null);
  await clock.advance(2600); assert.equal(inputs().length, 1, 'Busy native work is not interrupted or queued once per missed interval');
  provider.finish(); provider.hold();
  await clock.until(() => inputs().length === 2 || ended !== undefined, 'Coalesced wake-up was not delivered after native idle', 10000);
  await clock.until(() => provider.held() !== undefined || ended !== undefined, 'Second native task did not reach inert provider');
  assert.equal(ended, undefined); assert.equal(provider.requests.length, 2);
  value(changeWakeRule(services, admin.actor, ruleId, { ...configuration, expectedRevision: 0, enabled: false }, randomUUID()));
  provider.finish(); await clock.advance(2200);
  assert.equal(ended, undefined); assert.equal(inputs().length, 2, 'Disabled schedules never submit subsequent native input');
  const runs = value(services.listenerRead.active([agent.id], Date.now() - 90000)); assert.equal(runs.length, 1);
  assert.equal(runs[0]!.messagesDelivered, 0, 'Scheduled inputs do not impersonate delivered Matrix chat');
  stop.abort(); await clock.complete(receiver);
  assert(value(services.repositories.listenerRun.find({ id: runs[0]!.id }))?.stoppedAt);
});
