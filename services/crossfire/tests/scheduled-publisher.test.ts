import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { scheduledPublisher } from '@ctlflow/crossfire-agent-core/scheduled';
import { messageArtifacts } from '@ctlflow/crossfire-agent-core/message-artifacts';
import { nativeClock } from '@ctlflow/crossfire-adapter-runtime/clock';
import { nativeDelivery } from '@ctlflow/crossfire-adapter-runtime/delivery';
import { deliveryText } from '@ctlflow/crossfire-adapter-runtime/journal';
import { localState } from '@ctlflow/crossfire-adapter-filesystem/state';
import { createCoordination } from '@ctlflow/crossfire-adapter-crossfire/coordination';
import { createWakeRule, changeWakeRule } from '@ctlflow/crossfire-domain/wake-up/manage';
import { reportListener } from '@ctlflow/crossfire-domain/listener/report';
import { readWakeRule } from '@ctlflow/crossfire-domain/wake-up/read';
import * as check from '@ctlflow/crossfire-contracts/schema/validation';
import { applicationFixture, value } from './support/application.js';
import { httpFixture } from './support/http.js';
const nativeInput = check.object({ text: deliveryText, messageId: check.text(200), boundary: check.integer() });
const prepare = (text: string, messageId: string) => ({ text, messageId, boundary: 0 });

test('scheduled checkpoints recover only receipts before other input and retain unacknowledged delivery', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, http = await httpFixture(scope, fixture.application);
  const agent = await fixture.agent(admin.actor, 'ada'), runId = randomUUID(), ruleId = randomUUID();
  value(reportListener(services, agent.actor, agent.id, runId, { statistics: null, release: 'test', stopped: false, messagesDelivered: 0, controller: agent.controller }, 'test'));
  const configuration = { name: 'Fetch report', message: 'Exact configured message. '.repeat(250), schedule: { kind: 'interval' as const, seconds: 60 }, enabled: true, agentIds: [agent.id] };
  value(createWakeRule(services, admin.actor, ruleId, configuration, randomUUID())); fixture.advance(60000);
  mkdirSync('.temp', { recursive: true }); const directory = mkdtempSync(join(process.cwd(), '.temp/scheduled-'));
  let publications = 0, receipt = false;
  const inputs: string[] = [];
  const runtime = nativeDelivery({ sessionId: 'same-native-session', approval: 'none', signal: new AbortController().signal, verify: () => {},
    inspect: async () => ({ busy: false }), prepare, received: () => receipt,
    publish: input => { publications++; inputs.push(input.text); if (!receipt) throw new Error('Lost native publication response'); }, close: () => {} }, nativeInput,
  { journal: join(directory, 'native.json'), pollMs: 100, timeoutMs: 100 });
  cleanup(scope, () => runtime.close());
  const coordination = createCoordination({ origin: http.origin, token: agent.token }), file = join(directory, 'scheduled.json');
  const publisher = () => scheduledPublisher({ clock: nativeClock, coordination, storage: localState, file, runtime, agentId: agent.id, artifacts: messageArtifacts(localState, join(directory, 'messages'), Date.now), maximum: 4096,
    attachment: () => ({ runId, sessionId: runtime.sessionId }) });
  await assert.rejects(publisher().publish(runtime.signal), /Lost native publication response/);
  assert.equal(publications, 1); assert.equal(value(readWakeRule(services, admin.actor, ruleId)).lastDeliveredAt, null);
  assert(Buffer.byteLength(inputs[0]!) <= 4096);
  const pointer = JSON.parse(inputs[0]!.split('\n')[1]!) as { kind: string; file: string };
  assert.equal(pointer.kind, 'crossfire-input-file');
  const content = localState.read<{ text: string }>(pointer.file).text;
  assert.equal((JSON.parse(content.split('\n')[1]!) as { message: string }).message, configuration.message);
  await assert.rejects(publisher().recover(runtime.signal), /uncertain/); assert.equal(publications, 1);
  receipt = true;
  const acknowledge = coordination.acknowledgeWake; coordination.acknowledgeWake = async () => { throw new Error('Lost server receipt response'); };
  await assert.rejects(publisher().recover(runtime.signal), /Lost server receipt response/);
  assert.equal(localState.read<{ stage: string }>(file).stage, 'delivered');
  coordination.acknowledgeWake = acknowledge;
  assert.equal(await publisher().recover(runtime.signal), true);
  assert.equal(publications, 1); assert.equal(localState.exists(file), false);
  assert.equal(value(readWakeRule(services, admin.actor, ruleId)).lastDeliveredAt, fixture.now());
  await runtime.deliver('Separate urgent owner input.', 'owner-input'); assert.equal(publications, 2);
  runtime.acknowledge(['owner-input']);
  fixture.advance(60000); value(reportListener(services, agent.actor, agent.id, runId, { statistics: null, release: 'test', stopped: false, messagesDelivered: 0, controller: agent.controller }, 'test'));
  receipt = false; await assert.rejects(publisher().publish(runtime.signal), /Lost native publication response/);
  const saved = localState.read<{ command: { sessionId: string } }>(file); saved.command.sessionId = 'different-native-session'; localState.write(file, saved);
  await assert.rejects(publisher().recover(runtime.signal), /retargeted/); assert.equal(publications, 3);
});

test('busy schedules make no claims or model submissions and a disabled queued input is not replayed', async scope => {
  const fixture = await applicationFixture(scope), { services, admin } = fixture, http = await httpFixture(scope, fixture.application);
  const agent = await fixture.agent(admin.actor, 'ada'), runId = randomUUID(), ruleId = randomUUID();
  const configuration = { name: 'Report', message: 'Scheduled report.', schedule: { kind: 'interval' as const, seconds: 60 }, enabled: true, agentIds: [agent.id] };
  value(createWakeRule(services, admin.actor, ruleId, configuration, randomUUID())); fixture.advance(60000);
  value(reportListener(services, agent.actor, agent.id, runId, { statistics: null, release: 'test', stopped: false, messagesDelivered: 0, controller: agent.controller }, 'test'));
  mkdirSync('.temp', { recursive: true }); const directory = mkdtempSync(join(process.cwd(), '.temp/scheduled-busy-'));
  let busy = true, published = 0;
  const cancel = new AbortController(), runtime = nativeDelivery({ sessionId: 'native-session', approval: 'none', signal: new AbortController().signal, verify: () => {},
    inspect: async () => ({ busy }), prepare, received: () => false, publish: () => { published++; cancel.abort(new Error('Owner pause')); },
    cancel: () => true, close: () => {} }, nativeInput, { journal: join(directory, 'native.json'), pollMs: 100 });
  cleanup(scope, () => runtime.close());
  const coordination = createCoordination({ origin: http.origin, token: agent.token });
  const publisher = () => scheduledPublisher({ clock: nativeClock, coordination, storage: localState, file: join(directory, 'scheduled.json'), runtime, artifacts: messageArtifacts(localState, join(directory, 'messages'), Date.now), maximum: 65536,
    agentId: agent.id, attachment: () => ({ runId, sessionId: runtime.sessionId }) });
  assert.equal(await publisher().publish(runtime.signal), false); assert.equal(published, 0);
  assert.equal(value(services.repositories.wakeDelivery.pending(agent.id)), null);
  busy = false; await assert.rejects(publisher().publish(cancel.signal), /Owner pause/);
  assert.equal(published, 1);
  assert.equal(await publisher().recover(runtime.signal), false, 'A proved cancelled native input returns to queued state without publication');
  value(changeWakeRule(services, admin.actor, ruleId, { ...configuration, expectedRevision: 0, enabled: false }, randomUUID()));
  assert.equal(await publisher().publish(runtime.signal), true);
  assert.equal(published, 1); assert.equal(value(readWakeRule(services, admin.actor, ruleId)).lastDeliveredAt, null);
});
