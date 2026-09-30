import { createClient, type ClientOptions } from './client.js';
import { operations } from '@crossfire/contracts/rest/operations';
import type { Coordination } from '@crossfire/agent-core/coordination';
import { success, type Result } from '@crossfire/kernel/result';
import type { Response } from '@crossfire/contracts/rest/envelope';

async function data<Value>(response: Promise<Result<Response<Value>>>): Promise<Result<Value>> {
  const result = await response;
  return result.ok ? success(result.value.data) : result;
}
export function createCoordination(options: ClientOptions): Coordination {
  const client = createClient(options);
  return { origin: options.origin,
    release: signal => data(client.call(operations.release, {}, {}, undefined, signal)),
    delivery: (agentId, signal) => data(client.call(operations.deliveryPolicy, { agentId }, {}, undefined, signal)),
    identities: (matrixUserIds, signal) => data(client.call(operations.resolvePrincipals, {}, { matrixUserIds: [...matrixUserIds] }, undefined, signal)),
    report: (agentId, runId, input, signal) => data(client.call(operations.reportListener, { agentId, runId }, input, undefined, signal)),
    notice: (agentId, roomId, eventId, signal) => data(client.call(operations.wakeNotice, { agentId, eventId }, { roomId }, undefined, signal)),
  };
}
