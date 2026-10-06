import type { TestContext } from 'node:test';
import { randomUUID } from 'node:crypto';
import { cleanup } from '@ctlflow/crossfire-test-support/cleanup';
import { createClient } from '@ctlflow/crossfire-adapter-crossfire/client';
import { createFleetControlConnection } from '@ctlflow/crossfire-adapter-crossfire/fleet-control';
import type { FleetRuntimeExecutor } from '@ctlflow/crossfire-adapter-crossfire/fleet-runtime';
import type { ControllerProof } from '@ctlflow/crossfire-domain/listener/controller';
import { operations } from '@ctlflow/crossfire-contracts/rest/operations';
import { failure, success } from '@ctlflow/crossfire-kernel/result';
import { until } from '../../scripts/test-support/listener.js';
import { value } from './application.js';

export async function browserController(scope: TestContext, options: {
  origin: string; owner: string; controller: ControllerProof; execute: FleetRuntimeExecutor;
}) {
  const { origin, owner, controller, execute } = options;
  value(await createClient({ origin, token: controller.credential }).call(operations.reportFleetConnection,
    { fleetId: controller.fleetId, connectionId: controller.connectionId }, { stopped: true }));
  const connection = createFleetControlConnection({ origin, owner, fleetId: controller.fleetId,
    credential: controller.credential, signal: new AbortController().signal, acknowledged: () => success(undefined), execute });
  cleanup(scope, () => connection.close());
  await until(() => connection.status().connected, 'The owner-approved browser controller did not obtain a live lease');
  return connection;
}

export async function browserPublisher(scope: TestContext, options: {
  origin: string; owner: string; release: string; agent: { id: string; token: string; controller: ControllerProof };
}) {
  const { origin, owner, release, agent } = options;
  const controller = await browserController(scope, { origin, owner, controller: agent.controller,
    execute: async () => failure('unavailable', 'This publication fixture has no native lifecycle executor') });
  const binding = controller.listener(agent.id), proof = binding.control.binding(); binding.close();
  const client = createClient({ origin, token: agent.token }), runId = randomUUID();
  const report = { controller: proof, release, messagesDelivered: 0, statistics: null };
  value(await client.call(operations.reportListener, { agentId: agent.id, runId }, { ...report, stopped: false }));
  cleanup(scope, async () => { value(await client.call(operations.reportListener, { agentId: agent.id, runId }, { ...report, stopped: true })); });
  return client;
}
